"""
Prometheus metrics â€” ported from ai-stack metrics.py (birebir).
Null-object pattern: tÃ¼m metrikler no-op eÄŸer prometheus_client yÃ¼klÃ¼ deÄŸilse.
"""
from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)

try:
    from prometheus_client import Counter, Gauge, Histogram
    from prometheus_client import start_http_server as _prom_start

    _AVAILABLE = True
except ImportError:
    _AVAILABLE = False


if _AVAILABLE:
    OPTIMIZATIONS: Counter = Counter(  # type: ignore[assignment]
        "ai_stack_optimizations_total",
        "Total optimization calls by layer and status",
        ["layer", "status"],
    )
    SAVINGS_HIST: Histogram = Histogram(  # type: ignore[assignment]
        "ai_stack_savings_percent",
        "Token savings distribution per optimization layer (percent)",
        ["layer"],
        buckets=[0, 5, 10, 25, 50, 75, 90, 95, 99, 100],
    )
    CACHE_HITS: Counter = Counter(  # type: ignore[assignment]
        "ai_stack_cache_hits_total",
        "Cache hits by cache tier",
        ["type"],
    )
    CIRCUIT_BREAKER: Gauge = Gauge(  # type: ignore[assignment]
        "ai_stack_circuit_breaker_open",
        "1 if circuit breaker is open, 0 if closed",
        ["layer"],
    )
else:
    class _Noop:  # type: ignore[no-redef]
        def labels(self, **_kw: object) -> "_Noop":
            return self
        def inc(self, *_a: object, **_kw: object) -> None:
            pass
        def observe(self, *_a: object, **_kw: object) -> None:
            pass
        def set(self, *_a: object, **_kw: object) -> None:
            pass

    OPTIMIZATIONS = _Noop()   # type: ignore[assignment]
    SAVINGS_HIST = _Noop()    # type: ignore[assignment]
    CACHE_HITS = _Noop()      # type: ignore[assignment]
    CIRCUIT_BREAKER = _Noop() # type: ignore[assignment]


_server_started = False
_server_lock = threading.Lock()


def start_metrics_server(port: int = 9090) -> None:
    """Start Prometheus HTTP server (once only, daemon thread)."""
    global _server_started
    if not _AVAILABLE or _server_started:
        return
    with _server_lock:
        if _server_started:
            return
        try:
            _prom_start(port)
            _server_started = True
            logger.info(f"Prometheus metrics server on http://0.0.0.0:{port}/metrics")
        except OSError as exc:
            logger.warning(f"Metrics server failed on port {port}: {exc}")
