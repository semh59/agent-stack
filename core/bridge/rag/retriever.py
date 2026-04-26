"""
RAG Document Retriever — semantic search over LanceDB.

Returns top-k chunks for a query.
build_context_snippet() formats results for direct injection into context.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from rank_bm25 import BM25Okapi # type: ignore

from config import Settings
from rag.indexer import DocumentIndexer
from rag.reranker import DocumentReranker
from rag.agentic_explorer import AgenticExplorer

logger = logging.getLogger(__name__)


class DocumentRetriever:

    def __init__(self, indexer: DocumentIndexer, settings: Settings) -> None:
        self.indexer = indexer
        self.settings = settings
        
        # RAG 2.0 Components
        self.reranker = DocumentReranker(settings)
        self.explorer = AgenticExplorer(self, settings)
        self._bm25: BM25Okapi | None = None
        self._corpus: list[str] = []
        self._corpus_metadata: list[dict[str, Any]] = []

    async def search(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        """
        Perform hybrid search (Dense + Sparse) followed by Reranking.
        """
        try:
            # 1. Dense (Semantic) Search
            table = await self.indexer._get_table()
            query_embedding = await self.indexer._embed(query)
            
            # Using to_thread for LanceDB synchronous calls
            vector_results = await asyncio.to_thread(
                lambda: (
                    table.search(query_embedding)
                    .limit(limit * 2)
                    .to_list()
                )
            )

            dense_hits = []
            for r in vector_results:
                if isinstance(r, dict) and r.get("chunk", "").strip():
                    dist = float(r.get("_distance", 1.0))
                    dense_hits.append({
                        "path": str(r["path"]),
                        "chunk": str(r["chunk"]),
                        "score": float(1.0 - dist),
                        "source": "dense"
                    })

            # 2. Sparse (BM25) Search
            # In a real 2026 system, we'd maintain the BM25 index incrementally.
            # For now, we'll fetch some candidate documents and score them.
            sparse_hits = await self._sparse_search(query, limit=limit)

            # 3. Merge results (Reciprocal Rank Fusion - simplified)
            combined = self._merge_results(dense_hits, sparse_hits)

            # 4. Reranking (Cross-Encoder)
            reranked = await self.reranker.rerank(query, combined, limit=limit)

            return reranked
        except Exception as exc:
            logger.error(f"Hybrid search failed: {exc}")
            return []

    async def _sparse_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        """Local keyword search using BM25."""
        if not self._bm25:
            # Initialize corpus from indexed data if needed
            await self._refresh_bm25_index()
            
        if not self._bm25:
            return []
            
        tokenized_query = query.lower().split()
        scores = self._bm25.get_scores(tokenized_query)
        
        # Get top-k indices
        top_n = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:limit]
        
        hits = []
        for i in top_n:
            if scores[i] > 0:
                meta = self._corpus_metadata[i]
                hits.append({
                    "path": meta["path"],
                    "chunk": self._corpus[i],
                    "score": float(scores[i]) / (max(scores) or 1.0),
                    "source": "sparse"
                })
        return hits

    async def _refresh_bm25_index(self) -> None:
        """Fetch all chunks from DB and build BM25 index."""
        try:
            table = await self.indexer._get_table()
            
            def fetch_all():
                return table.search().to_list()
                
            all_records = await asyncio.to_thread(fetch_all)
            
            self._corpus = [r["chunk"] for r in all_records]
            self._corpus_metadata = [{"path": r["path"]} for r in all_records]
            
            tokenized_corpus = [doc.lower().split() for doc in self._corpus]
            self._bm25 = BM25Okapi(tokenized_corpus)
        except Exception as exc:
            logger.warning(f"BM25 index refresh failed: {exc}")

    def _merge_results(self, dense: list[dict[str, Any]], sparse: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Simple RRF-like merge."""
        seen = {}
        for h in dense + sparse:
            path_chunk = f"{h['path']}:{h['chunk'][:100]}"
            if path_chunk not in seen:
                seen[path_chunk] = h
            else:
                # Average scores if hit by both
                seen[path_chunk]["score"] = (seen[path_chunk]["score"] + h["score"]) / 2
                seen[path_chunk]["source"] = "hybrid"
        return list(seen.values())

    async def build_context_snippet(self, query: str, limit: int = 3) -> str:
        """
        Format top-k chunks as a context snippet, augmented by agentic exploration.
        """
        # Quantum Hardening: use AgenticExplorer instead of simple search for complex queries
        return await self.explorer.build_quantum_context(query, limit=limit)

    async def search_by_path(self, path_pattern: str, limit: int = 20) -> list[dict[str, Any]]:
        """Return all indexed chunks for a given file path (exact or prefix match)."""
        try:
            table = await self.indexer._get_table()
            safe = path_pattern.replace("'", "''")
            
            def fetch_by_path():
                return (
                    table.search()
                    .where(f"path LIKE '{safe}%'")
                    .limit(limit)
                    .to_list()
                )
                
            results = await asyncio.to_thread(fetch_by_path)
            return [{"path": str(r["path"]), "chunk": str(r["chunk"])} for r in results]
        except Exception:
            return []
