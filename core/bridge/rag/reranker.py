"""
Reranker â€” RAG 2.0 Precision Enhancement.

Uses a cross-encoder model to re-score retrieval results,
ensuring only the most relevant context is passed to the LLM.
"""
from __future__ import annotations

import asyncio
import structlog
from typing import Any

from config import Settings

logger = structlog.get_logger(__name__)

class DocumentReranker:

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: Any = None
        self._lock = asyncio.Lock()

    async def rerank(self, query: str, chunks: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
        """
        Rerank retrieval results using a cross-encoder or local relevance heuristic.
        """
        if not chunks:
            return []

        # 1. Lazy load model
        if self._model is None:
            async with self._lock:
                if self._model is None:
                    # Run CPU-intensive init in thread
                    await asyncio.to_thread(self._init_model)

        # 2. Re-score
        if self._model:
            try:
                pairs = [[query, c["chunk"]] for c in chunks]
                # Cross-encoder prediction is expensive, run in thread
                scores = await asyncio.to_thread(self._model.predict, pairs)

                for i, score in enumerate(scores):
                    chunks[i]["score"] = float(score)
                    chunks[i]["source"] = "reranked"
            except Exception as exc:
                logger.warning("rerank_model_inference_failed", error=str(exc))
                # Fallback to tiered scoring if model fails
                self._apply_tiered_scores(chunks)
        else:
            # Fallback to high-fidelity heuristic if model cannot be loaded
            self._apply_tiered_scores(chunks)

        # 3. Final sort and limit
        sorted_chunks = sorted(chunks, key=lambda x: x.get("score", 0.0), reverse=True)
        return sorted_chunks[:limit]

    def _init_model(self) -> None:
        try:
            from sentence_transformers import CrossEncoder # type: ignore
            model_name = getattr(self.settings, "reranker_model", "BAAI/bge-reranker-base")
            # Force CPU to avoid issues in bridge environment
            self._model = CrossEncoder(model_name, device="cpu")
            logger.info("reranker_model_loaded", model=model_name)
        except Exception as exc:
            logger.error("reranker_init_failed", error=str(exc))

    def _apply_tiered_scores(self, chunks: list[dict[str, Any]]) -> None:
        """Heuristic fallback: boost code blocks and exact matches."""
        for c in chunks:
            base = float(c.get("score", 0.5))
            # Boost if chunk contains structural keywords
            if any(kw in c["chunk"] for kw in ["def ", "class ", "interface ", "type "]):
                base += 0.2
            # Penalize very short fragments
            if len(c["chunk"]) < 50:
                base -= 0.1
            c["score"] = min(1.0, max(0.0, base))
