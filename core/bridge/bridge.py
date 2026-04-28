"""
HTTP Bridge â€” Gateway â†” Optimization Engine communication layer.

Exposes the MCP optimization pipeline as REST endpoints for the
TypeScript Gateway to consume. Runs alongside (or instead of) the
stdio MCP server.

Usage:
    python bridge.py                    # default port 9100
    python bridge.py --port 9200        # custom port

The Gateway calls these endpoints:
    POST /optimize          â†’ optimize_context
    POST /search            â†’ search_docs
    POST /index             â†’ index_document
    GET  /cost-report       â†’ get_cost_report
    GET  /cache-stats       â†’ cache_stats
    POST /cache-clear       â†’ clear_cache
    POST /model-preference  â†’ set_model_preference
    GET  /status            â†’ get_pipeline_status
    GET  /health            â†’ liveness probe
"""
from __future__ import annotations

import argparse
import asyncio
import functools
import json
import os
import sys
import time
from typing import Any, cast

import collections
import structlog  # type: ignore

try:
    from aiohttp import web  # type: ignore
except ImportError:
    print(
        "[bridge] aiohttp is required for the HTTP bridge.\n"
        "  pip install aiohttp",
        file=sys.stderr,
    )
    sys.exit(1)

from config import settings  # type: ignore
from metrics import start_metrics_server  # type: ignore
from pipeline.optimization_pipeline import OptimizationPipeline  # type: ignore

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_orchestrator: OptimizationPipeline | None = None
_orch_lock = asyncio.Lock()

async def _get_orch() -> OptimizationPipeline:
    global _orchestrator
    if _orchestrator is None:
        async with _orch_lock:
            if _orchestrator is None:
                orch = OptimizationPipeline(settings)
                await orch.initialize()
                _orchestrator = orch
    return _orchestrator


# ---------------------------------------------------------------------------
# Auth validation (lightweight â€” Gateway does the real auth)
_APP_ENV = os.environ.get("APP_ENV", os.environ.get("NODE_ENV", "development")).lower()
_IS_PRODUCTION_LIKE = _APP_ENV in {"production", "staging"}

def _get_bridge_secret() -> str:
    """Dynamically resolve the bridge secret from settings or environment."""
    return getattr(settings, "bridge_secret", "").strip()

# Hardened: Refuse to boot in production if secret is missing or is the known default
_secret = _get_bridge_secret()
if _IS_PRODUCTION_LIKE and (not _secret or _secret == "s3cret-v1-alloy"):
    logger.error(
        "bridge_secret_unsafe",
        app_env=_APP_ENV,
        hint="Set a strong ALLOY_BRIDGE_SECRET. Known defaults are forbidden in production.",
    )
    sys.exit(78)

def _check_auth(request: web.Request) -> bool:
    """
    Validate that the request comes from our Gateway using a shared secret.
    Uses constant-time compare to prevent timing side-channels.
    """
    import hmac
    token = request.headers.get("X-Bridge-Secret", "")
    secret = _get_bridge_secret()
    if not token or not secret:
        return False
    # constant-time compare
    return hmac.compare_digest(token.encode("utf-8"), secret.encode("utf-8"))


def _auth_guard(handler):
    """Decorator that rejects unauthenticated requests."""
    @functools.wraps(handler)
    async def wrapper(request: web.Request) -> web.Response:
        if not _check_auth(request):
            return web.json_response(
                {"error": "Unauthorized bridge request"},
                status=401,
            )
        return await handler(request)
    return wrapper


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

@_auth_guard
async def handle_optimize(request: web.Request) -> web.Response:
    """POST /optimize â€” Full optimization pipeline."""
    body = await request.json()
    orch = await _get_orch()

    message = body.get("message", "")
    if not message:
        return web.json_response({"error": "message is required"}, status=400)

    result = await orch.optimize(
        message=message,
        context=body.get("context_messages") or [],
        force_layers=body.get("force_layers"),
    )
    return web.json_response(
        json.loads(result.to_json()),
        content_type="application/json",
    )


@_auth_guard
async def handle_speculative(request: web.Request) -> web.Response:
    """POST /speculative --- Parallel Speculative Consensus Execution."""
    from pipeline.speculative import SpeculativeConsensusRouter
    
    body = await request.json()
    message = body.get("message", "")
    intent = body.get("intent", "code_generation")
    manifest = body.get("manifest", [])
    
    if not message:
        return web.json_response({"error": "message is required"}, status=400)
    if not manifest:
        return web.json_response({"error": "models manifest is required for speculative execution"}, status=400)

    # Initialize speculative router dynamically
    router = SpeculativeConsensusRouter(settings)
    try:
        result = await router.execute_parallel(
            context=message,
            intent=intent,
            models=manifest,
        )
    finally:
        await router.close()

    return web.json_response(result)


@_auth_guard
async def handle_search(request: web.Request) -> web.Response:
    """POST /search â€” RAG document search."""
    body = await request.json()
    orch = await _get_orch()

    if orch.rag_retriever is None:
        return web.json_response({"error": "RAG not initialized"}, status=503)

    chunks = await orch.rag_retriever.search(
        query=body.get("query", ""),
        limit=int(body.get("limit", 3)),
    )
    return web.json_response({"results": chunks})


@_auth_guard
async def handle_index(request: web.Request) -> web.Response:
    """POST /index â€” Index a document for RAG."""
    body = await request.json()
    orch = await _get_orch()

    if orch.rag_indexer is None:
        return web.json_response({"error": "RAG not initialized"}, status=503)

    result = await orch.rag_indexer.index(
        content=body.get("content", ""),
        path=body.get("path", ""),
    )
    return web.json_response(result)


@_auth_guard
async def handle_cost_report(request: web.Request) -> web.Response:
    """GET /cost-report â€” Token savings report."""
    orch = await _get_orch()

    if orch.cost_tracker is None:
        return web.json_response({"error": "CostTracker not initialized"}, status=503)

    period = request.query.get("period", "today")
    report = await orch.cost_tracker.report(period=period)
    return web.json_response(report)


@_auth_guard
async def handle_cache_stats(request: web.Request) -> web.Response:
    """GET /cache-stats â€” Cache hit rate and fill status."""
    orch = await _get_orch()

    stats: dict[str, Any] = {}
    if orch.exact_cache:
        stats["exact"] = orch.exact_cache.stats()
    if orch.semantic_cache:
        stats["semantic"] = await orch.semantic_cache.stats()
    if not stats:
        stats["status"] = "cache components not initialized"

    return web.json_response(stats)


@_auth_guard
async def handle_cache_clear(request: web.Request) -> web.Response:
    """POST /cache-clear â€” Clear cache tiers."""
    body = await request.json()
    orch = await _get_orch()

    tier = body.get("tier", "all")
    cleared: list[str] = []
    if tier in ("all", "memory") and orch.exact_cache:
        orch.exact_cache.clear_memory()
        cleared.append("memory")
    if tier in ("all", "disk") and orch.exact_cache:
        orch.exact_cache.clear_disk()
        cleared.append("disk")
    if tier in ("all", "semantic") and orch.semantic_cache:
        await orch.semantic_cache.clear()
        cleared.append("semantic")

    return web.json_response({"cleared": cleared})


@_auth_guard
async def handle_model_preference(request: web.Request) -> web.Response:
    """POST /model-preference â€” Set model override."""
    body = await request.json()
    orch = await _get_orch()

    model = body.get("model", "")
    reason = body.get("reason", "")
    if orch.model_cascade:
        orch.model_cascade.manual_override = model

    return web.json_response({"set": model, "reason": reason})


@_auth_guard
async def handle_status(request: web.Request) -> web.Response:
    """GET /status â€” Pipeline health check."""
    orch = await _get_orch()
    status = await orch.pipeline_status()
    return web.json_response(status)


async def handle_health(request: web.Request) -> web.Response:
    """GET /health â€” Liveness probe (no auth required)."""
    return web.json_response({
        "status": "ok",
        "service": "ai-stack-optimization-bridge",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "initialized": _orchestrator is not None and _orchestrator.is_initialized,
    })


async def handle_ready(request: web.Request) -> web.Response:
    """
    GET /ready â€” Readiness probe (no auth).
    Returns 200 iff the orchestrator is fully initialized. ECS/k8s should use
    this for service-registration gating; /health remains the liveness probe.
    """
    ready = _orchestrator is not None and _orchestrator.is_initialized
    return web.json_response(
        {"ready": ready, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        status=200 if ready else 503,
    )


# ---------------------------------------------------------------------------
# Rate-limit middleware (sliding window, per-IP)
# ---------------------------------------------------------------------------

_RATE_LIMIT = int(os.environ.get("BRIDGE_RATE_LIMIT", "300"))   # requests / window
_RATE_WINDOW = int(os.environ.get("BRIDGE_RATE_WINDOW", "60"))  # seconds
_RATE_BUCKET_TTL = 300  # Remove idle IP buckets after 5 minutes

# {ip: (deque of request timestamps, last_access_time)}
_rate_buckets: dict[str, tuple[collections.deque, float]] = {}


def _cleanup_rate_buckets() -> None:
    """Remove idle IP buckets to prevent unbounded memory growth."""
    now = time.monotonic()
    idle_ips = [
        ip for ip, (_, last_access) in _rate_buckets.items()
        if now - last_access > _RATE_BUCKET_TTL
    ]
    for ip in idle_ips:
        del _rate_buckets[ip]


@web.middleware
async def rate_limit_middleware(request: web.Request, handler) -> web.Response:
    # Health/ready probes are exempt
    if request.path in ("/health", "/ready"):
        return await handler(request)

    ip = request.remote or "unknown"
    now = time.monotonic()

    # Periodic cleanup of idle buckets (every 100 requests approximately)
    if len(_rate_buckets) > _RATE_LIMIT and int(now) % 100 == 0:
        _cleanup_rate_buckets()

    bucket_data = _rate_buckets.get(ip)
    if bucket_data is None:
        bucket = collections.deque()
        _rate_buckets[ip] = (bucket, now)
    else:
        bucket, _ = bucket_data
        _rate_buckets[ip] = (bucket, now)  # update last access time

    # Drop timestamps outside the window
    while bucket and now - bucket[0] > _RATE_WINDOW:
        bucket.popleft()

    if len(bucket) >= _RATE_LIMIT:
        return web.json_response(
            {"error": "rate_limit_exceeded", "limit": _RATE_LIMIT, "window_seconds": _RATE_WINDOW},
            status=429,
            headers={"Retry-After": str(_RATE_WINDOW)},
        )

    bucket.append(now)
    return await handler(request)


# ---------------------------------------------------------------------------
# Error + correlation-ID middleware
# ---------------------------------------------------------------------------

def _gen_request_id() -> str:
    import uuid
    return uuid.uuid4().hex


@web.middleware
async def correlation_and_error_middleware(
    request: web.Request, handler
) -> web.Response:
    """
    Attach X-Request-ID (propagated from gateway if present), log every
    request with structured context, and convert unhandled exceptions to
    structured JSON errors so clients never see raw tracebacks.
    """
    rid = request.headers.get("X-Request-ID") or _gen_request_id()
    request["request_id"] = rid
    log = logger.bind(request_id=rid, method=request.method, path=request.path)

    start = time.perf_counter()
    try:
        response = await handler(request)
    except web.HTTPException as http_exc:
        # Let aiohttp's own HTTPException go through with an rid header.
        http_exc.headers["X-Request-ID"] = rid
        log.warning("http_exception", status=http_exc.status, reason=http_exc.reason)
        raise
    except asyncio.TimeoutError:
        log.warning("upstream_timeout")
        return web.json_response(
            {"error": "upstream_timeout", "request_id": rid},
            status=504,
            headers={"X-Request-ID": rid},
        )
    except Exception as exc:  # noqa: BLE001 â€” last-chance handler
        log.exception("unhandled_error", error=str(exc), error_type=type(exc).__name__)
        return web.json_response(
            {
                "error": "internal_error",
                "message": str(exc),
                "error_type": type(exc).__name__,
                "request_id": rid,
            },
            status=500,
            headers={"X-Request-ID": rid},
        )
    else:
        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Request-ID"] = rid
        # Skip health/ready log chatter at INFO
        if request.path not in ("/health", "/ready"):
            log.info("request_complete", status=response.status, ms=round(elapsed_ms, 2))
        return response


# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------

async def _on_startup(app: web.Application) -> None:
    """Pre-warm the orchestrator so the first real request is not a cold start."""
    try:
        await _get_orch()
        logger.info("bridge_prewarm_complete")
    except Exception as exc:  # noqa: BLE001
        logger.warning("bridge_prewarm_failed", error=str(exc))


async def _on_shutdown(app: web.Application) -> None:
    """Persist MAB state and release resources before process exits."""
    global _orchestrator
    orch = _orchestrator
    if orch is None:
        return
    try:
        if orch.mab is not None:
            await orch.mab._save_state()
            logger.info("bridge_shutdown_mab_saved")
    except Exception as exc:  # noqa: BLE001
        logger.warning("bridge_shutdown_mab_save_failed", error=str(exc))
    logger.info("bridge_shutdown_complete")


def create_app() -> web.Application:
    app = web.Application(client_max_size=10 * 1024 * 1024)  # 10MB for large prompts

    _allowed_origin = os.environ.get("BRIDGE_CORS_ORIGIN", "http://127.0.0.1:3000")

    # CORS middleware (allow Gateway origin only)
    @web.middleware
    async def cors_middleware(request: web.Request, handler) -> web.Response:
        if request.method == "OPTIONS":
            response = web.Response(status=204)
        else:
            response = await handler(request)

        if isinstance(response, web.StreamResponse):
            response_headers = cast(Any, response.headers)
            response_headers["Access-Control-Allow-Origin"] = str(_allowed_origin)
            response_headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response_headers["Access-Control-Allow-Headers"] = (
                "Content-Type, Authorization, X-Bridge-Secret, X-Request-ID"
            )
            response_headers["Access-Control-Expose-Headers"] = "X-Request-ID"
        return response

    # Order: rate-limit â†’ error/correlation â†’ CORS (outermost)
    app.middlewares.append(rate_limit_middleware)
    app.middlewares.append(correlation_and_error_middleware)
    app.middlewares.append(cors_middleware)

    app.on_startup.append(_on_startup)
    app.on_shutdown.append(_on_shutdown)

    # Register routes
    app.router.add_post("/optimize", handle_optimize)
    app.router.add_post("/speculative", handle_speculative)
    app.router.add_post("/search", handle_search)
    app.router.add_post("/index", handle_index)
    app.router.add_get("/cost-report", handle_cost_report)
    app.router.add_get("/cache-stats", handle_cache_stats)
    app.router.add_post("/cache-clear", handle_cache_clear)
    app.router.add_post("/model-preference", handle_model_preference)
    app.router.add_get("/status", handle_status)
    app.router.add_get("/health", handle_health)
    app.router.add_get("/ready", handle_ready)

    return app


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="AI Stack Optimization Bridge")
    parser.add_argument("--port", type=int, default=9100, help="Port (default 9100)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host (default 127.0.0.1)")
    args = parser.parse_args()

    # Start metrics server (use port 9091 for bridge if running alongside server,
    # but here we use the one from settings or default)
    start_metrics_server(settings.metrics_port + 1)

    app = create_app()
    logger.info("bridge_starting", host=args.host, port=args.port)
    web.run_app(app, host=args.host, port=args.port, print=lambda msg: logger.debug("aiohttp_msg", message=msg))


if __name__ == "__main__":
    main()
