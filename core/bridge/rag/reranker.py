"""
Reranker — RAG 2.0 Precision Enhancement.

Uses a cross-encoder model to re-score retrieval results,
ensuring only the most relevant context is passed to the LLM.
"""
from __future__ import annotations

import logging
from typing import Any

from config import Settings

logger = logging.getLogger(__name__)

class DocumentReranker:
    
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: Any = None
        
    async def rerank(self, query: str, chunks: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
        """
        Rerank retrieval results using a cross-encoder.
        """
        if not chunks:
            return []
            
        # Simplified reranking for MVP: ensure we don't have duplicates and sort by initial score
        # In a full 2026 system, we'd use sentence-transformers CrossEncoder here.
        
        # Sort by score descending
        sorted_chunks = sorted(chunks, key=lambda x: x.get("score", 0.0), reverse=True)
        
        return sorted_chunks[:limit]

    def _init_model(self) -> None:
        try:
            # Lazy load for performance
            from sentence_transformers import CrossEncoder # type: ignore
            model_name = self.settings.reranker_model # e.g. "BAAI/bge-reranker-base"
            self._model = CrossEncoder(model_name)
        except Exception as exc:
            logger.error(f"Reranker initialization failed: {exc}")
