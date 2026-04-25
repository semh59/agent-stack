"""
L3 Cache — Partial / Chunk-based.

Mesajı chunk'lara böler, her chunk'ı L1/L2'de arar.
En az MIN_CHUNKS chunk bulunursa birleştirip döner.
Uzun bileşik mesajlar için "partial hit" sağlar.
"""
from __future__ import annotations

import logging

from cache.exact import ExactCache
from cache.semantic import SemanticCache

logger = logging.getLogger(__name__)


class PartialCache:

    CHUNK_SIZE = 200   # kelime
    MIN_CHUNKS = 1     # H6 fix: 2→1 so short docs with a single chunk still get a partial hit

    def __init__(self, exact: ExactCache, semantic: SemanticCache) -> None:
        self._exact = exact
        self._semantic = semantic

    async def get(self, message: str, context: list[str]) -> str | None:
        chunks = self._split_chunks(message)
        if len(chunks) < self.MIN_CHUNKS:
            return None

        results: list[str] = []
        for chunk in chunks:
            # L1 exact first (faster)
            hit = self._exact.get(chunk)
            if hit is None:
                # L2 semantic
                try:
                    hit = await self._semantic.get(chunk, context)
                except Exception as exc:
                    logger.debug("partial_cache semantic lookup failed for chunk: %s", exc)
            if hit:
                results.append(hit)

        if len(results) >= self.MIN_CHUNKS:
            return "\n\n".join(results)
        return None

    def _split_chunks(self, message: str) -> list[str]:
        """Paragraf öncelikli, yoksa sabit kelime sayısı."""
        paragraphs = [p.strip() for p in message.split("\n\n") if len(p.strip()) > 30]
        if len(paragraphs) >= self.MIN_CHUNKS:
            return paragraphs
        words = message.split()
        size = self.CHUNK_SIZE
        return [" ".join(words[i : i + size]) for i in range(0, len(words), size)]
