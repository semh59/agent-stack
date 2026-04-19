"""
RAG Document Retriever — semantic search over LanceDB.

Returns top-k chunks for a query.
build_context_snippet() formats results for direct injection into context.
"""
from __future__ import annotations

import asyncio
from typing import Any

from config import Settings
from rag.indexer import DocumentIndexer


class DocumentRetriever:

    def __init__(self, indexer: DocumentIndexer, settings: Settings) -> None:
        self.indexer = indexer
        self.settings = settings

    async def search(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        """
        Returns: [{"path": str, "chunk": str, "score": float}]
        score: 1.0 = perfect match, 0.0 = unrelated
        """
        try:
            table = await self.indexer._get_table()
            query_embedding = await self.indexer._embed(query)

            results = await asyncio.to_thread(
                lambda: (
                    table.search(query_embedding)
                    .limit(limit)
                    .to_list()
                )
            )

            return [
                {
                    "path": r["path"],
                    "chunk": r["chunk"],
                    "score": round(float(1 - r.get("_distance", 1.0)), 4),
                }
                for r in results
                if r.get("chunk", "").strip()
            ]
        except Exception as exc:
            return []

    async def build_context_snippet(self, query: str, limit: int = 3) -> str:
        """
        Format top-k chunks as a context snippet ready for injection.

        Instead of sending full documents, only the relevant paragraphs are
        included — typically 80-90% token savings on documentation queries.
        """
        chunks = await self.search(query, limit=limit)
        if not chunks:
            return ""

        parts: list[str] = []
        for chunk in chunks:
            score_tag = f"[relevance: {chunk['score']:.2f}]"
            parts.append(f"[from {chunk['path']} {score_tag}]\n{chunk['chunk']}")

        return "\n\n---\n\n".join(parts)

    async def search_by_path(self, path_pattern: str, limit: int = 20) -> list[dict[str, Any]]:
        """Return all indexed chunks for a given file path (exact or prefix match)."""
        try:
            table = await self.indexer._get_table()
            safe = path_pattern.replace("'", "''")
            results = await asyncio.to_thread(
                lambda: (
                    table.search()
                    .where(f"path LIKE '{safe}%'")
                    .limit(limit)
                    .to_list()
                )
            )
            return [{"path": r["path"], "chunk": r["chunk"]} for r in results]
        except Exception:
            return []
