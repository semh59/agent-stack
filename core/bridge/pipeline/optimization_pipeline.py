"""
Pipeline OptimizationPipeline.

Main orchestrator for the Alloy AI platform.
Coordinates MAB, Tool Execution, and Pipeline components.
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol, runtime_checkable

import structlog  # type: ignore

from config import Settings  # type: ignore
from dependencies import check_dependencies, get_capability_report  # type: ignore

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Component Protocols — duck-typed, no runtime import required
# ---------------------------------------------------------------------------

@runtime_checkable
class CapabilityMatrix(Protocol):
    semantic_cache: bool
    rag: bool


class ExactCacheProto(Protocol):
    def get(self, key: str) -> str | None: ...
    def set(self, key: str, value: str, ttl: float = 0) -> None: ...
    def clear_memory(self) -> None: ...
    def clear_disk(self) -> None: ...
    def stats(self) -> dict[str, Any]: ...


class SemanticCacheProto(Protocol):
    async def get(self, message: str, context: list[str]) -> str | None: ...
    async def set(self, message: str, context: list[str], response: str, *, is_contextual: bool) -> None: ...
    async def stats(self) -> dict[str, Any]: ...
    async def clear(self) -> None: ...


class PartialCacheProto(Protocol):
    async def get(self, message: str, context: list[str]) -> str | None: ...


@dataclass
class _Classification:
    """Minimal shape returned by MessageRouter.classify()."""
    message_type: Any


class RouterProto(Protocol):
    def classify(self, message: str) -> _Classification: ...


class MABProto(Protocol):
    async def initialize(self) -> None: ...
    async def select_layers(self, candidates: list[str]) -> list[str]: ...
    async def reward(self, layer: str, savings_percent: float) -> None: ...
    async def _save_state(self) -> None: ...


class CostTrackerProto(Protocol):
    async def log(self, record: Any) -> None: ...
    async def report(self, *, period: str) -> dict[str, Any]: ...


class DedupProto(Protocol):
    def process(self, text: str, msg_id: int) -> tuple[str, float]: ...


@dataclass
class _CLICleanResult:
    cleaned: str
    savings_percent: float


class SummarizerProto(Protocol):
    async def compress_history(self, messages: list[Any]) -> list[Any]: ...


class LLMLinguaProto(Protocol):
    async def compress_sections(self, text: str) -> tuple[str, float]: ...


class CavemanProto(Protocol):
    async def compress(self, text: str) -> tuple[str, float]: ...


class RAGIndexerProto(Protocol):
    async def index(self, *, content: str, path: str) -> dict[str, Any]: ...


class RAGRetrieverProto(Protocol):
    async def search(self, query: str, limit: int) -> list[Any]: ...
    async def build_context_snippet(self, query: str, limit: int) -> str | None: ...


class SemanticPrunerProto(Protocol):
    def prune(self, text: str, intensity: float | None = None) -> tuple[str, float]: ...


class PrefixCacheProto(Protocol):
    def get_prefix(self, content: str) -> str | None: ...
    def store_prefix(self, content: str) -> None: ...


class _CircuitBreaker(Protocol):
    async def is_open(self) -> bool: ...


class ModelCascadeProto(Protocol):
    breakers: dict[str, _CircuitBreaker]
    manual_override: str


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class OptimizationPipeline:
    """
    Coordinates the full optimization pipeline.

    Adım 1: stub — returns message unchanged, records timing.
    Adım 10: full implementation with cache, MAB, all layers.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._initialized = False
        self._init_lock: Any = None  # asyncio.Lock — created inside running event loop

        # Sub-components — populated in initialize()
        self.exact_cache: ExactCacheProto | None = None
        self.semantic_cache: SemanticCacheProto | None = None
        self.partial_cache: PartialCacheProto | None = None
        self.router: RouterProto | None = None
        self.mab: MABProto | None = None
        self.cost_tracker: CostTrackerProto | None = None
        self.capability_matrix: CapabilityMatrix | None = None

        # Cleaning
        self.cli_cleaner: Callable[[str], _CLICleanResult] | None = None
        self.dedup: DedupProto | None = None
        self.summarizer: SummarizerProto | None = None
        self.noise_filter_fn: Callable[[str], str] | None = None

        # Compression
        self.llmlingua: LLMLinguaProto | None = None
        self.caveman: CavemanProto | None = None

        # RAG
        self.rag_indexer: RAGIndexerProto | None = None
        self.rag_retriever: RAGRetrieverProto | None = None

        # 2026 Hardening
        self.semantic_pruner: SemanticPrunerProto | None = None
        self.prefix_cache: PrefixCacheProto | None = None

        # Models
        self.model_cascade: ModelCascadeProto | None = None

    @property
    def is_initialized(self) -> bool:
        """Public read-only accessor for initialization state."""
        return self._initialized

    async def initialize(self) -> None:
        """Lazy-initialize all sub-components. Called once at first tool use."""
        if self._initialized:
            return
        import asyncio as _asyncio
        if self._init_lock is None:
            self._init_lock = _asyncio.Lock()
        async with self._init_lock:
            if self._initialized:
                return

            states, self.capability_matrix = check_dependencies()
            logger.info("deps_checked", report=get_capability_report(self.capability_matrix))

            self._init_caches()
            self._init_logic()
            if self.mab is not None:
                await self.mab.initialize()
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

        if self.capability_matrix and self.capability_matrix.semantic_cache:
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

        try:
            from compression.semantic_pruner import SemanticPruner  # type: ignore
            self.semantic_pruner = SemanticPruner(self.settings)
        except Exception as exc:
            _log_warn(f"SemanticPruner failed: {exc}")

        try:
            from pipeline.prefix_cache_manager import PrefixCacheManager  # type: ignore
            self.prefix_cache = PrefixCacheManager(self.settings)
        except Exception as exc:
            _log_warn(f"PrefixCacheManager failed: {exc}")

    def _init_rag(self) -> None:
        if self.capability_matrix and self.capability_matrix.rag:
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
        """Run the full optimization pipeline."""
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
            
        # 1b. Prefix Cache (2026 Spec)
        if self.prefix_cache is not None and ctx:
            long_context = "\n".join(ctx)
            if len(long_context) > 1000:
                self.prefix_cache.store_prefix(long_context)

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
        ordered = await self.mab.select_layers(candidates) if self.mab else candidates

        # 4. Apply layers
        processed = message
        applied: list[str] = []
        msg_id = int(time.time() * 1000)

        for layer in ordered:
            result, savings = await self._apply_layer(layer, processed, ctx, msg_id)
            if savings > 5.0:  # >5.0% threshold (Masterpiece Optimization)
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

    async def pipeline_status(self) -> dict[str, str]:
        """Health check for all sub-components."""
        await self.initialize()

        status: dict[str, str] = {}

        try:
            import httpx  # type: ignore
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{self.settings.ollama_url}/api/tags")
                status["ollama"] = "ok" if r.status_code == 200 else f"http_{r.status_code}"
        except Exception:
            status["ollama"] = "unreachable"

        status["openrouter"] = "configured" if self.settings.openrouter_api_key else "no_key"
        status["exact_cache"] = "ok" if self.exact_cache else "unavailable"
        status["semantic_cache"] = "ok" if self.semantic_cache else "unavailable"
        status["rag"] = "ok" if self.rag_indexer else "unavailable"

        if self.model_cascade:
            for name, breaker in self.model_cascade.breakers.items():
                status[f"circuit_{name}"] = "open" if await breaker.is_open() else "closed"

        return status

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _cache_lookup(self, message: str, context: list[str]) -> str | None:
        if self.exact_cache:
            result = self.exact_cache.get(message)
            if result is not None:
                return result
        if self.semantic_cache:
            try:
                result = await self.semantic_cache.get(message, context)
                if result is not None:
                    if self.exact_cache:
                        self.exact_cache.set(message, result)
                    return result
            except (ConnectionError, TimeoutError, RuntimeError) as exc:
                logger.warning("semantic_cache_lookup_failed", error=str(exc))
        if self.partial_cache:
            try:
                result = await self.partial_cache.get(message, context)
                if result is not None:
                    return result
            except (ConnectionError, TimeoutError, RuntimeError) as exc:
                logger.warning("partial_cache_lookup_failed", error=str(exc))
        return None

    async def _cache_store(
        self,
        message: str,
        context: list[str],
        response: str,
        is_contextual: bool,
    ) -> None:
        if self.exact_cache:
            self.exact_cache.set(message, response, ttl=self.settings.exact_cache_default_ttl)
        if self.semantic_cache:
            try:
                await self.semantic_cache.set(
                    message, context, response, is_contextual=is_contextual
                )
            except (ConnectionError, TimeoutError, RuntimeError) as exc:
                logger.warning("semantic_cache_store_failed", error=str(exc))

    def _layer_candidates(self, msg_type: str) -> list[str]:
        mapping: dict[str, list[str]] = {
            "cli_command":      ["cli_cleaner", "noise_filter"],
            "data_analysis":    ["dedup", "rag", "llmlingua", "summarizer", "semantic_pruning"],
            "prose_reasoning":  ["noise_filter", "caveman", "llmlingua", "summarizer", "semantic_pruning"],
            "code_generation":  ["dedup", "noise_filter", "llmlingua", "semantic_pruning"],
            "query":            ["rag", "summarizer"],
            "local_answerable": [],
            "unknown":          ["noise_filter", "semantic_pruning"],
        }
        return mapping.get(msg_type, ["noise_filter"])

    async def _apply_layer(
        self,
        layer: str,
        text: str,
        context: list[str],
        msg_id: int,
    ) -> tuple[str, float]:
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
        if layer == "cli_cleaner" and self.cli_cleaner:
            res = self.cli_cleaner(text)
            return res.cleaned, res.savings_percent
        if layer == "dedup" and self.dedup:
            return self.dedup.process(text, msg_id)
        if layer == "noise_filter" and self.noise_filter_fn:
            cleaned = self.noise_filter_fn(text)
            savings = max(0.0, (1 - len(cleaned) / max(len(text), 1)) * 100)
            return cleaned, savings
        return await self._dispatch_heavy(layer, text, msg_id)

    async def _dispatch_heavy(self, layer: str, text: str, msg_id: int) -> tuple[str, float]:
        if layer == "llmlingua" and self.llmlingua:
            return await self.llmlingua.compress_sections(text)
        if layer == "caveman" and self.caveman:
            return await self.caveman.compress(text)
        if layer == "rag" and self.rag_retriever:
            return await self._apply_rag(text)
        if layer == "summarizer" and self.summarizer:
            return await self._apply_summarizer(text, msg_id)
        if layer == "semantic_pruning" and self.semantic_pruner:
            return self.semantic_pruner.prune(text)
        return text, 0.0

    async def _apply_rag(self, text: str) -> tuple[str, float]:
        snippet = await self.rag_retriever.build_context_snippet(text)  # type: ignore[union-attr]
        if snippet:
            return f"[Relevant context]\n{snippet}\n\n[Query]\n{text}", 1.0
        return text, 0.0

    async def _apply_summarizer(self, text: str, msg_id: int) -> tuple[str, float]:
        from cleaning.summarizer import Message as SumMsg  # type: ignore
        msgs = [SumMsg(id=msg_id, role="user", content=text)]
        compressed = await self.summarizer.compress_history(msgs)  # type: ignore[union-attr]
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
