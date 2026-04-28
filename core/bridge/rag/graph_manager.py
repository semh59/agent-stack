"""
Graph Manager â€” RAG 2.0 Codebase Intelligence.

Builds and maintains a dependency graph using networkx.
Supports PageRank for symbol ranking and subgraph traversal.
"""
from __future__ import annotations

import logging
from typing import Any

import networkx as nx # type: ignore
from config import Settings

logger = logging.getLogger(__name__)

class CodeGraphManager:

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.graph = nx.DiGraph()

    def add_dependency(self, source: str, target: str, rel_type: str = "dependency") -> None:
        """Add a dependency edge between symbols or files."""
        self.graph.add_edge(source, target, relation=rel_type)

    def get_pagerank(self) -> dict[str, float]:
        """Calculate PageRank for all nodes in the graph."""
        try:
            return nx.pagerank(self.graph)
        except Exception as exc:
            logger.warning(f"PageRank calculation failed: {exc}")
            return {}

    def get_neighborhood(self, node: str, depth: int = 1) -> list[str]:
        """Get nodes within a certain distance from the target node."""
        if node not in self.graph:
            return []

        # Simple BFS/DFS to get neighbors
        try:
            nodes = nx.single_source_shortest_path_length(self.graph, node, cutoff=depth)
            return list(nodes.keys())
        except Exception:
            return []
