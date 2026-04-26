from __future__ import annotations
import asyncio
import hashlib
from pathlib import Path
from typing import Any
import httpx # type: ignore
from astchunk import ASTChunkBuilder # type: ignore
from config import Settings # type: ignore
from rag.contextual_embedder import ContextualEmbedder
from rag.graph import CodeGraph

import logging
logger = logging.getLogger(__name__)

class DocumentIndexer:
    TABLE_NAME = "documents"
    CHUNK_SIZE = 500
    OVERLAP = 50

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._db: Any = None
        self._table: Any = None
        self._file_hashes: dict[str, str] = {}
        self._table_lock = asyncio.Lock()
        self.contextualizer = ContextualEmbedder(settings)
        self.graph = CodeGraph(settings)
        self.graph.load()

    async def _get_table(t_self) -> Any:
        # Local pinning for thread/async safety and type satisfaction
        tbl = t_self._table
        if tbl is not None:
            return tbl
        async with t_self._table_lock:
            tbl = t_self._table
            if tbl is not None:
                return tbl
            try:
                import lancedb # type: ignore
            except ImportError as exc:
                raise RuntimeError(f"lancedb is not installed: {exc}") from exc
            db_path = str(t_self.settings.data_dir / "lancedb")
            t_self._db = await asyncio.to_thread(lancedb.connect, db_path)
            db = t_self._db
            try:
                t_self._table = await asyncio.to_thread(db.open_table, t_self.TABLE_NAME)
            except Exception:
                import pyarrow as pa # type: ignore
                sample_embedding = await t_self._embed("init")
                embed_dim = len(sample_embedding)
                schema = pa.schema([
                    pa.field("id", pa.string()),
                    pa.field("path", pa.string()),
                    pa.field("chunk", pa.string()),
                    pa.field("chunk_index", pa.int32()),
                    pa.field("file_hash", pa.string()),
                    pa.field("embedding", pa.list_(pa.float32(), embed_dim)),
                ])
                t_self._table = await asyncio.to_thread(db.create_table, t_self.TABLE_NAME, schema=schema)
        return t_self._table

    async def _embed(self, text: str) -> list[float]:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    f"{self.settings.ollama_url}/api/embeddings",
                    json={"model": self.settings.ollama_embed_model, "prompt": text},
                )
                r.raise_for_status()
                embedding = r.json()["embedding"]
                return [float(x) for x in embedding]
        except Exception as exc:
            logger.error(f"Embedding failed: {exc}")
            return [0.0] * 1024

    async def index(self, content: str, path_str: str) -> dict[str, Any]:
        if ".." in path_str or path_str.startswith("/") or path_str.startswith("\\"):
            return {"success": False, "error": "Invalid document path", "path": path_str}
        path_str = path_str.replace("\\", "/").lstrip("/")
        file_hash = hashlib.sha256(content.encode()).hexdigest()
        if self._file_hashes.get(path_str) == file_hash:
            return {"success": True, "chunks_indexed": 0, "cached": True, "path": path_str}
        table = await self._get_table()
        chunks = self._chunk_document(content, path_str)
        contextualized_chunks = await self.contextualizer.contextualize_chunks(content, chunks, path_str)
        self.graph.parse_file(Path(path_str), content)
        self.graph.save()
        sem = asyncio.Semaphore(10)
        async def sem_embed(chunk_text: str) -> list[float]:
            async with sem:
                return await self._embed(chunk_text)
        embeddings = await asyncio.gather(*[sem_embed(chunk) for chunk in contextualized_chunks])
        records: list[dict[str, Any]] = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
            chunk_text = str(chunk)
            preview = chunk_text[0:50]
            chunk_id = hashlib.sha256(f"{path_str}:{i}:{preview}".encode()).hexdigest()[:16]
            records.append({
                "id": chunk_id,
                "path": path_str,
                "chunk": chunk_text,
                "chunk_index": i,
                "file_hash": file_hash,
                "embedding": embedding,
            })
        try:
            safe_delete = f"path = '{path_str.replace(chr(39), chr(39)*2)}'"
            await asyncio.to_thread(table.delete, safe_delete)
        except Exception:
            pass
        if records:
            await asyncio.to_thread(table.add, records)
        self._file_hashes[path_str] = file_hash
        return {"success": True, "chunks_indexed": len(chunks), "cached": False, "path": path_str}

    async def index_file(self, file_path: str) -> dict[str, Any]:
        try:
            content = Path(file_path).read_text(encoding="utf-8", errors="ignore")
            return await self.index(content, file_path)
        except OSError as exc:
            return {"success": False, "error": str(exc), "path": file_path}

    def _chunk_document(self, content: str, path: str = "") -> list[str]:
        p = Path(path)
        ext = p.suffix.lower().lstrip(".")
        supported = {"py": "python", "js": "javascript", "ts": "typescript"}
        if ext in supported:
            try:
                chunker = ASTChunkBuilder(language=supported[ext], max_chunk_size=self.CHUNK_SIZE * 4)
                chunks: list[str] = chunker.chunk(content)
                if chunks:
                    return chunks
            except Exception as exc:
                logger.warning(f"AST chunking failed for {path}, falling back: {exc}")
        
        paragraphs = [p.strip() for p in content.split("\n\n") if len(p.strip()) > 50]
        if len(paragraphs) >= 3:
            return self._merge_paragraphs(paragraphs)
        
        words = content.split()
        if not words:
            return []
            
        size = self.CHUNK_SIZE
        step = size - self.OVERLAP
        chunks_list: list[str] = []
        for i in range(0, len(words), step):
            ch_words = words[i : i + size]
            chunk = " ".join(ch_words)
            if chunk.strip():
                chunks_list.append(chunk)
        return chunks_list

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
