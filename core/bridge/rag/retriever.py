from __future__ import annotations
import asyncio
from pathlib import Path
from typing import Any
import structlog # type: ignore
from rank_bm25 import BM25Okapi # type: ignore

from config import Settings # type: ignore
from rag.indexer import DocumentIndexer
from rag.reranker import DocumentReranker
from rag.agentic_explorer import AgenticExplorer
from rag.graph import CodeGraph

logger = structlog.get_logger(__name__)

class DocumentRetriever:
    def __init__(self, indexer: DocumentIndexer, settings: Settings) -> None:
        self.indexer = indexer
        self.settings = settings
        self.reranker = DocumentReranker(settings)
        self.explorer = AgenticExplorer(self, settings)
        self._bm25: BM25Okapi | None = None
        self._corpus: list[str] = []
        self._corpus_metadata: list[dict[str, Any]] = []
        self.graph = CodeGraph(settings)
        self.graph.load()

    async def search(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        try:
            table = await self.indexer._get_table()
            query_embedding = await self.indexer._embed(query)

            # Extract to standalone function to avoid Any/Unknown issues in to_thread
            def fetch_dense_sync(tbl: Any, emb: list[float], l: int):
                return tbl.search(emb).limit(l * 2).to_list()

            vector_results = await asyncio.to_thread(fetch_dense_sync, table, query_embedding, limit)

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

            sparse_hits = await self._sparse_search(query, limit=limit)
            combined = self._merge_results(dense_hits, sparse_hits)
            combined = await self._augment_with_graph(combined)
            reranked = await self.reranker.rerank(query, combined, limit=limit)
            return reranked
        except Exception as exc:
            logger.error("hybrid_search_failed", error=str(exc))
            return []

    async def _sparse_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        bm = self._bm25
        if not bm:
            await self._refresh_bm25_index()
            bm = self._bm25
        if not bm:
            return []

        tokenized_query = query.lower().split()
        scores = bm.get_scores(tokenized_query)

        # Proper indexing for top-n
        score_indices = sorted(range(len(scores)), key=lambda i: float(scores[i]), reverse=True)
        top_n = score_indices[0:limit]

        hits = []
        max_score = max(scores) if len(scores) > 0 else 1.0
        for i in top_n:
            if float(scores[i]) > 0:
                meta = self._corpus_metadata[i]
                hits.append({
                    "path": meta["path"],
                    "chunk": self._corpus[i],
                    "score": float(scores[i]) / (max_score or 1.0),
                    "source": "sparse"
                })
        return hits

    async def _refresh_bm25_index(self) -> None:
        try:
            table = await self.indexer._get_table()
            def fetch_all_sync(tbl: Any):
                return tbl.search().to_list()
            all_records = await asyncio.to_thread(fetch_all_sync, table)
            self._corpus = [str(r["chunk"]) for r in all_records]
            self._corpus_metadata = [{"path": str(r["path"])} for r in all_records]
            tokenized_corpus = [doc.lower().split() for doc in self._corpus]
            self._bm25 = BM25Okapi(tokenized_corpus)
        except Exception as exc:
            logger.warning("bm25_refresh_failed", error=str(exc))

    def _merge_results(self, dense: list[dict[str, Any]], sparse: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen = {}
        for h in dense + sparse:
            chunk_slice = str(h['chunk'])[0:100]
            path_chunk = f"{h['path']}:{chunk_slice}"
            if path_chunk not in seen:
                seen[path_chunk] = h
            else:
                s1 = float(seen[path_chunk]["score"])
                s2 = float(h["score"])
                seen[path_chunk]["score"] = (s1 + s2) / 2
                seen[path_chunk]["source"] = "hybrid"
        return list(seen.values())

    async def _augment_with_graph(self, hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
        augmented = list(hits)
        seen_paths = {h["path"] for h in hits}
        for h in hits:
            path_val = str(h["path"])
            neighbors = self.graph.get_neighbors(Path(path_val).name, depth=1)
            for n in neighbors:
                if "." in n and n not in seen_paths:
                    extra_chunks = await self.search_by_path(n, limit=2)
                    for ec in extra_chunks:
                        ec["score"] = float(h["score"]) * 0.8
                        ec["source"] = "graph_neighbor"
                        augmented.append(ec)
                        seen_paths.add(n)
        return augmented

    async def build_context_snippet(self, query: str, limit: int = 3) -> str:
        # Agency explorer handles logic
        return await self.explorer.build_quantum_context(query, limit=limit)

    async def search_by_path(self, path_pattern: str, limit: int = 20) -> list[dict[str, Any]]:
        try:
            table = await self.indexer._get_table()
            safe = path_pattern.replace("'", "''")
            def fetch_match_sync(tbl: Any, p: str, l: int):
                return tbl.search().where(f"path LIKE '{p}%'").limit(l).to_list()
            results = await asyncio.to_thread(fetch_match_sync, table, safe, limit)
            return [{"path": str(r["path"]), "chunk": str(r["chunk"])} for r in results]
        except Exception:
            return []
