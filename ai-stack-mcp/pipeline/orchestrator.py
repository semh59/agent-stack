"""
Pipeline Orchestrator — stub implementation (Adım 1).

Full implementation added in Adım 10 once all sub-components are ready.
This stub allows the MCP server to start and respond to tool calls immediately.
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from typing import Any

import structlog  # type: ignore

from config import Settings  # type: ignore
from dependencies import check_dependencies, get_capability_report  # type: ignore

logger = structlog.get_logger(__name__)


@dataclass
class OptimizationResult:
    """Result returned by optimize() — serialised to JSON for MCP tool response."""

    original_tokens: int
    optimized_message: str
    sent_tokens: int
    savings_percent: float
    cache_hit: bool
    layers_applied: list[str]
    model_recommended: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(
            {
                "optimized": self.optimized_message,
                "savings_percent": float(math.floor(self.savings_percent * 10) / 10.0),
                "cache_hit": self.cache_hit,
                "layers": self.layers_applied,
                "model": self.model_recommended,
                "tokens": {
                    "original": self.original_tokens,
                    "sent": self.sent_tokens,
                },
                "metadata": self.metadata,
            },
            ensure_ascii=False,
            indent=2,
        )


class Orchestrator:
    """
    Coordinates the full optimization pipeline.

    Adım 1: stub — returns message unchanged, records timing.
    Adım 10: full implementation with cache, MAB, all layers.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._initialized = False
        self._init_lock: Any = None  # asyncio.Lock — created on first use (event loop safe)

        # Sub-components — populated in initialize()
        self.exact_cache: Any = None
        self.semantic_cache: Any = None
        self.partial_cache: Any = None
        self.router: Any = None
        self.mab: Any = None
        self.cost_tracker: Any = None
        self.capability_matrix: Any = None

        # Cleaning
        self.cli_cleaner: Any = None
        self.dedup: Any = None
        self.summarizer: Any = None
        self.noise_filter_fn: Any = None

        # Compression
        self.llmlingua: Any = None
        self.caveman: Any = None

        # RAG
        self.rag_indexer: Any = None
        self.rag_retriever: Any = None

        # Models
        self.model_cascade: Any = None

    async def initialize(self) -> None:
        """Lazy-initialize all sub-components. Called once at first tool use."""
        # Fast path — already initialized (no lock needed for read after init)
        if self._initialized:
            return
        # Create lock on first call (must happen inside a running event loop)
        import asyncio as _asyncio
        if self._init_lock is None:
            self._init_lock = _asyncio.Lock()
        async with self._init_lock:
            if self._initialized:  # re-check after acquiring lock
                return

        # Run dependency health check
        states, self.capability_matrix = check_dependencies()
        logger.info("deps_checked", report=get_capability_report(self.capability_matrix))

        self._init_caches()
        self._init_logic()
        self._init_cleaning()
        self._init_compression()
        self._init_rag()
        self._init_models()

        self._initialized = True

    def _init_caches(self) -> None:
        try:
            from cache.exact import ExactCache  # type: ignore
            self.exact_cache = ExactCache(self.settings)
        except Exception as exc:
            _log_warn(f"ExactCache failed: {exc}")

        if self.capability_matrix.semantic_cache:
            try:
                from cache.semantic import SemanticCache  # type: ignore
                self.semantic_cache = SemanticCache(self.settings)
            except Exception as exc:
                logger.error("semantic_cache_init_failed", error=str(exc))

        try:
            if self.exact_cache and self.semantic_cache:
                from cache.partial import PartialCache  # type: ignore
                self.partial_cache = PartialCache(self.exact_cache, self.semantic_cache)
        except Exception as exc:
            _log_warn(f"PartialCache failed: {exc}")

    def _init_logic(self) -> None:
        try:
            from pipeline.router import MessageRouter  # type: ignore
            self.router = MessageRouter(self.settings)
        except Exception as exc:
            _log_warn(f"Router failed: {exc}")

        try:
            from pipeline.mab import ThompsonSamplingMAB  # type: ignore
            self.mab = ThompsonSamplingMAB(self.settings)
        except Exception as exc:
            _log_warn(f"MAB failed: {exc}")

        try:
            from pipeline.cost_tracker import CostTracker  # type: ignore
            self.cost_tracker = CostTracker(self.settings)
        except Exception as exc:
            _log_warn(f"CostTracker failed: {exc}")

    def _init_cleaning(self) -> None:
        try:
            from cleaning.cli_cleaner import clean as cli_clean  # type: ignore
            self.cli_cleaner = cli_clean
        except Exception as exc:
            _log_warn(f"CLICleaner failed: {exc}")

        try:
            from cleaning.dedup import CodeDeduplicator  # type: ignore
            self.dedup = CodeDeduplicator()
        except Exception as exc:
            _log_warn(f"Dedup failed: {exc}")

        try:
            from cleaning.summarizer import ConversationSummarizer  # type: ignore
            self.summarizer = ConversationSummarizer(self.settings)
        except Exception as exc:
            _log_warn(f"Summarizer failed: {exc}")

        try:
            from cleaning.noise_filter import filter_noise  # type: ignore
            self.noise_filter_fn = filter_noise
        except Exception as exc:
            _log_warn(f"NoiseFilter failed: {exc}")

    def _init_compression(self) -> None:
        try:
            from compression.llmlingua import LLMLinguaCompressor  # type: ignore
            self.llmlingua = LLMLinguaCompressor(self.settings)
        except Exception as exc:
            _log_warn(f"LLMLingua failed: {exc}")

        try:
            from compression.caveman import CavemanCompressor  # type: ignore
            self.caveman = CavemanCompressor(self.settings)
        except Exception as exc:
            _log_warn(f"Caveman failed: {exc}")

    def _init_rag(self) -> None:
        if self.capability_matrix.rag:
            try:
                from rag.indexer import DocumentIndexer  # type: ignore
                self.rag_indexer = DocumentIndexer(self.settings)
                from rag.retriever import DocumentRetriever  # type: ignore
                self.rag_retriever = DocumentRetriever(self.rag_indexer, self.settings)
            except Exception as exc:
                logger.error("rag_init_failed", error=str(exc))

    def _init_models(self) -> None:
        try:
            from models.circuit_breaker import ModelCascade  # type: ignore
            self.model_cascade = ModelCascade(self.settings)
        except Exception as exc:
            _log_warn(f"ModelCascade failed: {exc}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def optimize(
        self,
        message: str,
        context: list[str] | None = None,
        force_layers: list[str] | None = None,
    ) -> OptimizationResult:
        """
        Run the full optimization pipeline.

        Returns an OptimizationResult. When sub-components are not yet
        implemented the message is returned unchanged with 0% savings.
        """
        await self.initialize()
        ctx = context or []
        start = time.monotonic()
        original_tokens = _count_tokens(message)

        # 1. Cache lookup
        cached = await self._cache_lookup(message, ctx)
        if cached is not None:
            return OptimizationResult(
                original_tokens=original_tokens,
                optimized_message=cached,
                sent_tokens=_count_tokens(cached),
                savings_percent=max(0.0, (1 - _count_tokens(cached) / max(original_tokens, 1)) * 100),
                cache_hit=True,
                layers_applied=["cache"],
                model_recommended="cached",
                metadata={"elapsed_ms": _elapsed(start)},
            )

        # 2. Classify + complexity
        msg_type = "unknown"
        complexity = 5
        model = "ollama:qwen2.5-7b-q4"
        if self.router:
            classification = self.router.classify(message)
            msg_type = classification.message_type.value
            from pipeline.router import complexity_score, model_recommendation  # type: ignore
            complexity = complexity_score(message, sum(len(c.split()) for c in ctx))
            model = model_recommendation(complexity, sum(len(c.split()) for c in ctx))

        # 3. Layer candidates
        candidates = force_layers or self._layer_candidates(msg_type)
        if self.mab:
            ordered = await self.mab.select_layers(candidates)
        else:
            ordered = candidates

        # 4. Apply layers
        processed = message
        applied: list[str] = []
        msg_id = int(time.time() * 1000)

        for layer in ordered:
            result, savings = await self._apply_layer(layer, processed, ctx, msg_id)
            if savings > 0.5:  # >0.5% savings threshold
                if self.mab:
                    await self.mab.reward(layer, savings)
                applied.append(layer)
                processed = result

        sent_tokens = _count_tokens(processed)
        total_savings = max(0.0, (1 - sent_tokens / max(original_tokens, 1)) * 100)

        # 5. Log cost
        if self.cost_tracker:
            from pipeline.cost_tracker import CostRecord  # type: ignore
            await self.cost_tracker.log(CostRecord(
                timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                original_tokens=original_tokens,
                sent_tokens=sent_tokens,
                model_used=model,
                savings_percent=total_savings,
                cache_hit=False,
                layers_applied=applied,
            ))

        # 6. Store in cache
        await self._cache_store(message, ctx, processed, is_contextual=bool(ctx))

        return OptimizationResult(
            original_tokens=original_tokens,
            optimized_message=processed,
            sent_tokens=sent_tokens,
            savings_percent=total_savings,
            cache_hit=False,
            layers_applied=applied,
            model_recommended=model,
            metadata={
                "elapsed_ms": _elapsed(start),
                "message_type": msg_type,
                "complexity": complexity,
            },
        )

    async def pipeline_status(self) -> dict[str, Any]:
        """Health check for all sub-components."""
        await self.initialize()

        status: dict[str, str] = {}

        # Ollama
        try:
            import httpx  # type: ignore
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{self.settings.ollama_url}/api/tags")
                status["ollama"] = "ok" if r.status_code == 200 else f"http_{r.status_code}"
        except Exception:
            status["ollama"] = "unreachable"

        # OpenRouter
        status["openrouter"] = "configured" if self.settings.openrouter_api_key else "no_key"

        # Cache
        status["exact_cache"] = "ok" if self.exact_cache else "unavailable"
        status["semantic_cache"] = "ok" if self.semantic_cache else "unavailable"

        # RAG
        status["rag"] = "ok" if self.rag_indexer else "unavailable"

        # Circuit breaker states
        if self.model_cascade:
            for name, breaker in self.model_cascade.breakers.items():
                status[f"circuit_{name}"] = "open" if breaker.is_open() else "closed"

        return status

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _cache_lookup(self, message: str, context: list[str]) -> str | None:
        # L1 exact
        if self.exact_cache:
            result = self.exact_cache.get(message)
            if result is not None:
                return result
        # L2 semantic
        if self.semantic_cache:
            try:
                result = await self.semantic_cache.get(message, context)
                if result is not None:
                    if self.exact_cache:
                        self.exact_cache.set(message, result)
                    return result
            except Exception:
                pass
        # L3 partial
        if self.partial_cache:
            try:
                result = await self.partial_cache.get(message, context)
                if result is not None:
                    return result
            except Exception:
                pass
        return None

    async def _cache_store(
        self,
        message: str,
        context: list[str],
        response: str,
        is_contextual: bool,
    ) -> None:
        if self.exact_cache:
            # H4 fix: L1 exact cache uses its own TTL setting, not the semantic ones.
            # Semantic TTLs (1d/7d) are only for the chromadb collection.
            self.exact_cache.set(message, response, ttl=self.settings.exact_cache_default_ttl)
        if self.semantic_cache:
            try:
                await self.semantic_cache.set(
                    message, context, response, is_contextual=is_contextual
                )
            except Exception:
                pass

    def _layer_candidates(self, msg_type: str) -> list[str]:
        mapping: dict[str, list[str]] = {
            "cli_command":      ["cli_cleaner", "noise_filter"],
            "data_analysis":    ["dedup", "rag", "llmlingua", "summarizer"],
            "prose_reasoning":  ["noise_filter", "caveman", "llmlingua", "summarizer"],
            "code_generation":  ["dedup", "noise_filter", "llmlingua"],
            "query":            ["rag", "summarizer"],
            "local_answerable": [],
            "unknown":          ["noise_filter"],
        }
        return mapping.get(msg_type, ["noise_filter"])

    async def _apply_layer(
        self,
        layer: str,
        text: str,
        context: list[str],
        msg_id: int,
    ) -> tuple[str, float]:
        """Apply a single layer. Returns (result, savings_percent)."""
        try:
            return await self._dispatch_layer(layer, text, context, msg_id)
        except Exception as exc:
            _log_warn(f"Layer {layer} failed: {exc}")
        return text, 0.0

    async def _dispatch_layer(
        self,
        layer: str,
        text: str,
        context: list[str],
        msg_id: int,
    ) -> tuple[str, float]:
        """Internal dispatch logic to keep complexity low."""
        # Simple layers - synchronous or low complexity
        if layer == "cli_cleaner" and self.cli_cleaner:
            res = self.cli_cleaner(text)
            return res.cleaned, res.savings_percent
        if layer == "dedup" and self.dedup:
            return self.dedup.process(text, msg_id)
        if layer == "noise_filter" and self.noise_filter_fn:
            cleaned = self.noise_filter_fn(text)
            savings = max(0.0, (1 - len(cleaned) / max(len(text), 1)) * 100)
            return cleaned, savings

        # Heavy/Async layers
        return await self._dispatch_heavy(layer, text, msg_id)

    async def _dispatch_heavy(self, layer: str, text: str, msg_id: int) -> tuple[str, float]:
        """Decomposed heavy layer dispatch."""
        if layer == "llmlingua" and self.llmlingua:
            return self.llmlingua.compress_sections(text)
        if layer == "caveman" and self.caveman:
            return await self.caveman.compress(text)
        if layer == "rag" and self.rag_retriever:
            return await self._apply_rag(text)
        if layer == "summarizer" and self.summarizer:
            return await self._apply_summarizer(text, msg_id)
        return text, 0.0

    async def _apply_rag(self, text: str) -> tuple[str, float]:
        snippet = await self.rag_retriever.build_context_snippet(text)
        if snippet:
            enriched = f"[Relevant context]\n{snippet}\n\n[Query]\n{text}"
            return enriched, 1.0
        return text, 0.0

    async def _apply_summarizer(self, text: str, msg_id: int) -> tuple[str, float]:
        from cleaning.summarizer import Message as SumMsg  # type: ignore

        msgs = [SumMsg(id=msg_id, role="user", content=text)]
        compressed = await self.summarizer.compress_history(msgs)
        if compressed:
            res_text = compressed[0].content
            savings = max(0.0, (1 - len(res_text) / max(len(text), 1)) * 100)
            return res_text, savings
        return text, 0.0


# ------------------------------------------------------------------
# Utilities
# ------------------------------------------------------------------

def _count_tokens(text: str) -> int:
    """Rough token estimate (1 token ≈ 4 chars)."""
    return max(1, len(text) // 4)


def _elapsed(start: float) -> float:
    return float(math.floor((time.monotonic() - start) * 1000 * 10) / 10.0)


def _log_warn(msg: str) -> None:
    logger.warning("legacy_warn", message=msg)
