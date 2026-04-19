"""
L2 Cache — Semantic (ChromaDB + nomic-embed-text via Ollama).

Hit threshold: cosine similarity >= settings.semantic_cache_similarity_threshold (default 0.85)
Embed text: message + last 3 context messages joined with " ||| "
TTL: simple=7 days, contextual=1 day
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any

import httpx

from config import Settings


class SemanticCache:
    """
    ChromaDB persistent semantic cache.

    Lazy-imports chromadb so import errors don't break server startup
    if the package is missing.
    """

    COLLECTION_NAME = "message_cache"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._collection: Any = None  # chromadb Collection
        # C3 fix: asyncio.Lock guards concurrent initialization.
        # Python 3.10+ allows Lock creation outside a running event loop.
        import asyncio as _asyncio
        self._init_lock = _asyncio.Lock()

    async def _ensure_collection(self) -> Any:
        """Thread-safe lazy init of ChromaDB collection (C3 fix)."""
        if self._collection is not None:
            return self._collection
        async with self._init_lock:
            if self._collection is not None:  # double-check after lock
                return self._collection
            try:
                import chromadb
                from chromadb.config import Settings as ChromaSettings

                client = chromadb.PersistentClient(
                    path=str(self.settings.data_dir / "chromadb"),
                    settings=ChromaSettings(anonymized_telemetry=False),
                )
                self._collection = client.get_or_create_collection(
                    name=self.COLLECTION_NAME,
                    metadata={"hnsw:space": "cosine"},
                )
            except ImportError as exc:
                raise RuntimeError(f"chromadb yüklü değil: {exc}") from exc
        return self._collection

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------

    async def _embed(self, text: str) -> list[float]:
        """nomic-embed-text via Ollama /api/embeddings."""
        async with httpx.AsyncClient(timeout=self.settings.ollama_timeout) as client:
            r = await client.post(
                f"{self.settings.ollama_url}/api/embeddings",
                json={"model": self.settings.ollama_embed_model, "prompt": text},
            )
            r.raise_for_status()
            return r.json()["embedding"]

    @staticmethod
    def _build_embed_text(message: str, context: list[str]) -> str:
        """Son 3 context mesajı + asıl mesaj — bağlamla birlikte embed."""
        recent = context[-3:] if len(context) >= 3 else context
        return " ||| ".join(recent + [message])

    # ------------------------------------------------------------------
    # Cache operations
    # ------------------------------------------------------------------

    async def get(self, message: str, context: list[str]) -> str | None:
        """Return cached response if similarity >= threshold, else None."""
        try:
            collection = await self._ensure_collection()
            embed_text = self._build_embed_text(message, context)
            embedding = await self._embed(embed_text)

            results = await asyncio.to_thread(
                collection.query,
                query_embeddings=[embedding],
                n_results=1,
                include=["documents", "distances", "metadatas"],
            )

            ids = results.get("ids", [[]])[0]
            if not ids:
                return None

            distance = results["distances"][0][0]
            similarity = 1.0 - distance  # cosine: distance is 1-similarity

            if similarity < self.settings.semantic_cache_similarity_threshold:
                return None

            meta = results["metadatas"][0][0]
            expires_at = meta.get("expires_at", 0.0)
            if expires_at < time.time():
                # Expired — delete and return miss
                await asyncio.to_thread(collection.delete, ids=[ids[0]])
                return None

            return results["documents"][0][0]

        except Exception:
            return None  # graceful miss

    async def set(
        self,
        message: str,
        context: list[str],
        response: str,
        is_contextual: bool = False,
        ttl: int | None = None,
    ) -> None:
        """Store message → response pair with embedding."""
        if ttl is None:
            ttl = (
                self.settings.semantic_cache_ttl_contextual
                if is_contextual
                else self.settings.semantic_cache_ttl_simple
            )
        try:
            collection = await self._ensure_collection()
            embed_text = self._build_embed_text(message, context)
            embedding = await self._embed(embed_text)
            doc_id = hashlib.sha256(embed_text.encode()).hexdigest()

            await asyncio.to_thread(
                collection.upsert,
                ids=[doc_id],
                embeddings=[embedding],
                documents=[response],
                metadatas=[{
                    "expires_at": time.time() + ttl,
                    "message_len": len(message),
                    "contextual": int(is_contextual),
                }],
            )
        except Exception:
            pass  # embedding/DB error → silent fail, pipeline continues

    async def clear(self) -> None:
        """Delete all entries from the collection."""
        try:
            collection = await self._ensure_collection()
            all_ids = await asyncio.to_thread(lambda: collection.get(include=[])["ids"])
            if all_ids:
                await asyncio.to_thread(collection.delete, ids=all_ids)
        except Exception:
            pass

    async def stats(self) -> dict[str, Any]:
        try:
            collection = await self._ensure_collection()
            count = await asyncio.to_thread(collection.count)
            return {"count": count}
        except Exception:
            return {"status": "unavailable"}
