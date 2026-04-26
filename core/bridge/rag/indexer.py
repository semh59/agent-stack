"""
RAG Document Indexer — LanceDB + nomic-embed-text.

LanceDB: lightweight, single-file vector DB (like SQLite for vectors).
Deduplication: SHA-256 hash per file — only re-index if content changed.
Chunking: paragraph-first, then fixed word windows.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path
from typing import Any

import httpx
from astchunk import ASTChunkBuilder

from config import Settings
from rag.contextual_embedder import ContextualEmbedder

logger = logging.getLogger(__name__)


class DocumentIndexer:

    TABLE_NAME = "documents"
    CHUNK_SIZE = 500    # words
    OVERLAP = 50        # word overlap between chunks

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._db: Any = None
        self._table: Any = None
        self._file_hashes: dict[str, str] = {}  # path → content hash
        self._table_lock = asyncio.Lock()
        
        # RAG 2.0 Components
        self.contextualizer = ContextualEmbedder(settings)

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------

    async def _get_table(self) -> Any:
        # M7 fix: double-checked locking prevents concurrent table creation.
        if self._table is not None:
            return self._table
        async with self._table_lock:
            if self._table is not None:  # re-check after acquiring lock
                return self._table

            try:
                import lancedb
            except ImportError as exc:
                raise RuntimeError(f"lancedb yüklü değil: {exc}  — pip install lancedb") from exc

            db_path = str(self.settings.data_dir / "lancedb")
            self._db = await asyncio.to_thread(lancedb.connect, db_path)

            try:
                self._table = await asyncio.to_thread(
                    self._db.open_table, self.TABLE_NAME
                )
            except Exception:
                # Table doesn't exist — create with schema
                import pyarrow as pa

                sample_embedding = await self._embed("init")
                embed_dim = len(sample_embedding)

                schema = pa.schema([
                    pa.field("id", pa.string()),
                    pa.field("path", pa.string()),
                    pa.field("chunk", pa.string()),
                    pa.field("chunk_index", pa.int32()),
                    pa.field("file_hash", pa.string()),
                    pa.field("embedding", pa.list_(pa.float32(), embed_dim)),
                ])
                self._table = await asyncio.to_thread(
                    self._db.create_table, self.TABLE_NAME, schema=schema
                )

        return self._table

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------

    async def _embed(self, text: str) -> list[float]:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    f"{self.settings.ollama_url}/api/embeddings",
                    json={"model": self.settings.ollama_embed_model, "prompt": text},
                )
                r.raise_for_status()
                embedding = r.json()["embedding"]
                return list(embedding)
        except Exception as exc:
            logger.error(f"Embedding failed: {exc}")
            return [0.0] * 1024 # Fallback dimension (mxbai-embed-large style)

    # ------------------------------------------------------------------
    # Indexing
    # ------------------------------------------------------------------

    async def index(self, content: str, path: str) -> dict[str, Any]:
        """
        Index a document. Skips if content hasn't changed (hash check).

        Returns: {"success": bool, "chunks_indexed": int, "cached": bool}
        """
        # ── Path traversal protection (defense-in-depth) ──────────
        if ".." in path or path.startswith("/") or path.startswith("\\"):
            return {"success": False, "error": "Invalid document path", "path": path}
        # Normalize separators
        path = path.replace("\\", "/").lstrip("/")

        file_hash = hashlib.sha256(content.encode()).hexdigest()

        if self._file_hashes.get(path) == file_hash:
            return {"success": True, "chunks_indexed": 0, "cached": True, "path": path}

        table = await self._get_table()
        
        # 1. Chunking (AST-aware if possible)
        chunks = self._chunk_document(content, path)
        
        # 2. Contextualization (RAG 2.0)
        contextualized_chunks = await self.contextualizer.contextualize_chunks(content, chunks, path)

        # 3. Embedding
        sem = asyncio.Semaphore(10)
        async def sem_embed(chunk_text: str) -> list[float]:
            async with sem:
                return await self._embed(chunk_text)

        embeddings = await asyncio.gather(*[sem_embed(chunk) for chunk in contextualized_chunks])

        records: list[dict[str, Any]] = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
            # Use string slice correctly
            preview = chunk[0:50] if isinstance(chunk, str) else ""
            chunk_id = hashlib.sha256(f"{path}:{i}:{preview}".encode()).hexdigest()[:16]
            records.append({
                "id": chunk_id,
                "path": path,
                "chunk": chunk,
                "chunk_index": i,
                "file_hash": file_hash,
                "embedding": embedding,
            })

        # Delete old records for this path
        try:
            await asyncio.to_thread(
                table.delete, f"path = '{path.replace(chr(39), chr(39)*2)}'"
            )
        except Exception:
            pass

        if records:
            await asyncio.to_thread(table.add, records)

        self._file_hashes[path] = file_hash
        return {"success": True, "chunks_indexed": len(chunks), "cached": False, "path": path}

    async def index_file(self, file_path: str) -> dict[str, Any]:
        """Convenience: read file from disk and index."""
        try:
            content = Path(file_path).read_text(encoding="utf-8", errors="ignore")
            return await self.index(content, file_path)
        except OSError as exc:
            return {"success": False, "error": str(exc), "path": file_path}

    # ------------------------------------------------------------------
    # Chunking
    # ------------------------------------------------------------------

    def _chunk_document(self, content: str, path: str = "") -> list[str]:
        """AST-aware chunking with paragraph/window fallback."""
        ext = Path(path).suffix.lower().lstrip(".")
        
        # Supported languages for astchunk
        supported = {"py": "python", "js": "javascript", "ts": "typescript"}
        
        if ext in supported:
            try:
                # Use ASTChunkBuilder as discovered in 2026-spec astchunk
                chunker = ASTChunkBuilder(language=supported[ext], max_chunk_size=self.CHUNK_SIZE * 4) # approx chars
                chunks: list[str] = chunker.chunk(content)
                if chunks:
                    return chunks
            except Exception as exc:
                logger.warning(f"AST chunking failed for {path}, falling back: {exc}")

        # Fallback 1: Paragraph split
        paragraphs = [p.strip() for p in content.split("\n\n") if len(p.strip()) > 50]
        if len(paragraphs) >= 3:
            return self._merge_paragraphs(paragraphs)

        # Fallback 2: Fixed word window
        words = content.split()
        if not words:
            return []
        size = self.CHUNK_SIZE
        step = size - self.OVERLAP
        chunks: list[str] = []
        for i in range(0, len(words), step):
            chunk = " ".join(words[i : i + size])
            if chunk.strip():
                chunks.append(chunk)
        return chunks

    def _merge_paragraphs(self, paragraphs: list[str]) -> list[str]:
        chunks: list[str] = []
        current: list[str] = []
        current_words = 0

        for para in paragraphs:
            words = len(para.split())
            if current_words + words > self.CHUNK_SIZE and current:
                chunks.append("\n\n".join(current))
                current = [para]
                current_words = words
            else:
                current.append(para)
                current_words += words

        if current:
            chunks.append("\n\n".join(current))

        return chunks
