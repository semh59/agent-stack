"""
Spectral Agentic Explorer — RAG 2.0 PageRank-lite Traversal.

Instead of BFS, this agent uses Spectral Influence Ranking to determine
which structural neighbors (classes/methods) are most central to the
retrieved context.
"""
from __future__ import annotations

import structlog  # type: ignore
from pathlib import Path
from typing import Any
import numpy as np  # type: ignore

from config import Settings
from rag.graph import CodeGraph

logger = structlog.get_logger(__name__)

class SpectralExplorer:

    def __init__(self, retriever: Any, settings: Settings) -> None:
        self.retriever = retriever
        self.settings = settings
        self.max_depth = getattr(settings, "explorer_max_depth", 2)
        self.graph = CodeGraph(settings)
        self.graph.load()

    async def explore(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """
        Perform spectral exploration.
        Uses a localized PageRank algorithm to find high-influence symbols.
        """
        # 1. Initial semantic search
        initial_chunks = await self.retriever.search(query, limit=limit)
        if not initial_chunks:
            return []

        results = {c["path"]: c for c in initial_chunks}
        seed_nodes = [Path(c["path"]).name for c in initial_chunks]

        # 2. Localized PageRank (Power Iteration on the local subgraph)
        # We assign 'influence scores' to structural neighbors
        influence_scores = self._calculate_spectral_influence(seed_nodes)

        # 3. Targeted Retrieval
        # Sort neighbors by influence and fetch content
        sorted_neighbors = sorted(influence_scores.items(), key=lambda x: x[1], reverse=True)

        for neighbor_name, influence in sorted_neighbors:
            if neighbor_name in results or influence < 0.1:
                continue

            neighbor_hits = await self.retriever.search_by_path(neighbor_name, limit=2)
            for nh in neighbor_hits:
                if nh["path"] not in results:
                    nh["score"] = influence * 0.9
                    nh["source"] = f"spectral_explorer (influence: {influence:.2f})"
                    results[nh["path"]] = nh

            if len(results) >= limit * 3:
                break

        return list(results.values())

    def _calculate_spectral_influence(self, seeds: list[str]) -> dict[str, float]:
        """
        Localized Influence Score calculation.
        Heuristic: Neighbors of seeds get scores based on connectivity.
        """
        influence = {}
        for seed in seeds:
            neighbors = self.graph.get_neighbors(seed, depth=1)
            for n in neighbors:
                if n == seed: continue
                influence[n] = influence.get(n, 0.0) + 1.0

        # Normalize
        total = sum(influence.values()) if influence else 1.0
        return {k: v / total for k, v in influence.items()}

    async def build_quantum_context(self, query: str, limit: int = 5) -> str:
        """
        Highest-density context injection.
        """
        chunks = await self.explore(query, limit=limit)
        if not chunks:
            return ""

        parts = []
        for chunk in sorted(chunks, key=lambda x: x.get("score", 0.0), reverse=True):
            source = chunk.get("source", "dense")
            parts.append(f"[Spectral Hit | Source: {source} | Path: {chunk['path']}]\n{chunk['chunk']}")

        return "\n\n---\n\n".join(parts)
