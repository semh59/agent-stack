"""
L2 Cache — Semantic (ChromaDB + nomic-embed-text via Ollama).

Hit threshold: cosine similarity >= settings.semantic_cache_similarity_threshold (default 0.85)
Embed text: message + last 3 context messages joined with " ||| "
TTL: simple=7 days, contextual=1 day
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any

import httpx

from config import Settings

logger = logging.getLogger(__name__)


class SemanticCache:
    """
    ChromaDB persistent semantic cache.

    Lazy-imports chromadb so import errors don't break server startup
    if the package is missing.
    """

    COLLECTION_NAME = "message_cache"

    CLEANUP_INTERVAL = 3600  # Run cleanup every hour

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._collection: Any = None  # chromadb Collection
        # C3 fix: asyncio.Lock guards concurrent initialization.
        # Python 3.10+ allows Lock creation outside a running event loop.
        import asyncio as _asyncio
        self._init_lock = _asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None  # type: ignore[type-arg]

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

        except Exception as exc:
            logger.debug("semantic_cache.get failed: %s", exc)
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
        except Exception as exc:
            logger.warning("semantic_cache.set failed: %s", exc)  # pipeline continues

    async def start_cleanup_task(self) -> None:
        """Start the background TTL cleanup task (call once after init)."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        """Periodically remove expired entries from the cache."""
        while True:
            await asyncio.sleep(self.CLEANUP_INTERVAL)
            try:
                await self._cleanup_expired()
            except Exception as exc:
                logger.warning("semantic_cache.cleanup_failed: %s", exc)

    async def _cleanup_expired(self) -> int:
        """Remove all expired entries. Returns count of removed entries."""
        try:
            collection = await self._ensure_collection()
            now = time.time()
            # Fetch all entries with metadata
            all_data = await asyncio.to_thread(
                lambda: collection.get(include=["metadatas"])
            )
            ids = all_data.get("ids", [])
            metas = all_data.get("metadatas", [])
            expired_ids = [
                eid for eid, meta in zip(ids, metas)
                if meta.get("expires_at", 0.0) < now
            ]
            if expired_ids:
                await asyncio.to_thread(collection.delete, ids=expired_ids)
                logger.info("semantic_cache_cleaned", removed=len(expired_ids))
            return len(expired_ids)
        except Exception as exc:
            logger.warning("semantic_cache._cleanup_expired failed: %s", exc)
            return 0

    async def stop_cleanup_task(self) -> None:
        """Cancel the background cleanup task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

    async def clear(self) -> None:
        """Delete all entries from the collection."""
        try:
            collection = await self._ensure_collection()
            all_ids = await asyncio.to_thread(lambda: collection.get(include=[])["ids"])
            if all_ids:
                await asyncio.to_thread(collection.delete, ids=all_ids)
        except Exception as exc:
            logger.warning("semantic_cache.clear failed: %s", exc)

    async def stats(self) -> dict[str, Any]:
        try:
            collection = await self._ensure_collection()
            count = await asyncio.to_thread(collection.count)
            return {"count": count}
        except Exception:
            return {"status": "unavailable"}
