"""
HTTP Bridge — Gateway ↔ Optimization Engine communication layer.

Exposes the MCP optimization pipeline as REST endpoints for the
TypeScript Gateway to consume. Runs alongside (or instead of) the
stdio MCP server.

Usage:
    python bridge.py                    # default port 9100
    python bridge.py --port 9200        # custom port

The Gateway calls these endpoints:
    POST /optimize          → optimize_context
    POST /search            → search_docs
    POST /index             → index_document
    GET  /cost-report       → get_cost_report
    GET  /cache-stats       → cache_stats
    POST /cache-clear       → clear_cache
    POST /model-preference  → set_model_preference
    GET  /status            → get_pipeline_status
    GET  /health            → liveness probe
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
from pipeline.orchestrator import Orchestrator  # type: ignore

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_orchestrator: Orchestrator | None = None
_orch_lock = asyncio.Lock()

async def _get_orch() -> Orchestrator:
    global _orchestrator
    if _orchestrator is None:
        async with _orch_lock:
            if _orchestrator is None:
                orch = Orchestrator(settings)
                await orch.initialize()
                _orchestrator = orch
    return _orchestrator


# ---------------------------------------------------------------------------
# Auth validation (lightweight — Gateway does the real auth)
# ---------------------------------------------------------------------------

_APP_ENV = os.environ.get("APP_ENV", os.environ.get("NODE_ENV", "development")).lower()
_IS_PRODUCTION_LIKE = _APP_ENV in {"production", "staging"}

_BRIDGE_SECRET = (
    getattr(settings, "bridge_secret", None)
    or os.environ.get("AI_STACK_BRIDGE_SECRET", "")
    or ""
).strip()

if not _BRIDGE_SECRET:
    if _IS_PRODUCTION_LIKE:
        # Cloud / staging: NEVER generate an ephemeral file-based secret.
        # - filesystem may be read-only
        # - gateway (separate container/pod) cannot read it
        # - rotation story is nonexistent
        logger.error(
            "bridge_secret_missing",
            app_env=_APP_ENV,
            hint="Set AI_STACK_BRIDGE_SECRET. Refusing to start in production-like mode.",
        )
        sys.exit(78)  # EX_CONFIG — see sysexits.h

    # Dev-only fallback. Flag it loudly so it cannot be mistaken for prod behavior.
    import secrets as _sec
    _BRIDGE_SECRET = _sec.token_hex(32)
    secret_path = settings.data_dir / ".bridge_secret"
    try:
        secret_path.write_text(_BRIDGE_SECRET, encoding="utf-8")
        try:
            secret_path.chmod(0o600)
        except Exception:
            # chmod fails on Windows; non-fatal in dev.
            pass
        logger.warning(
            "bridge_secret_generated_dev",
            path=str(secret_path),
            message="Dev-only: ephemeral secret generated. DO NOT USE IN PRODUCTION.",
        )
    except Exception as e:
        logger.warning("bridge_secret_write_failed", path=str(secret_path), error=str(e))

def _check_auth(request: web.Request) -> bool:
    """
    Validate that the request comes from our Gateway using a shared secret.
    Uses constant-time compare to prevent timing side-channels.
    """
    import hmac
    token = request.headers.get("X-Bridge-Secret", "")
    if not token or not _BRIDGE_SECRET:
        return False
    return hmac.compare_digest(token.encode("utf-8"), _BRIDGE_SECRET.encode("utf-8"))


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
    """POST /optimize — Full optimization pipeline."""
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
async def handle_search(request: web.Request) -> web.Response:
    """POST /search — RAG document search."""
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
    """POST /index — Index a document for RAG."""
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
    """GET /cost-report — Token savings report."""
    orch = await _get_orch()

    if orch.cost_tracker is None:
        return web.json_response({"error": "CostTracker not initialized"}, status=503)

    period = request.query.get("period", "today")
    report = await orch.cost_tracker.report(period=period)
    return web.json_response(report)


@_auth_guard
async def handle_cache_stats(request: web.Request) -> web.Response:
    """GET /cache-stats — Cache hit rate and fill status."""
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
    """POST /cache-clear — Clear cache tiers."""
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
    """POST /model-preference — Set model override."""
    body = await request.json()
    orch = await _get_orch()

    model = body.get("model", "")
    reason = body.get("reason", "")
    if orch.model_cascade:
        orch.model_cascade.manual_override = model

    return web.json_response({"set": model, "reason": reason})


@_auth_guard
async def handle_status(request: web.Request) -> web.Response:
    """GET /status — Pipeline health check."""
    orch = await _get_orch()
    status = await orch.pipeline_status()
    return web.json_response(status)


async def handle_health(request: web.Request) -> web.Response:
    """GET /health — Liveness probe (no auth required)."""
    return web.json_response({
        "status": "ok",
        "service": "ai-stack-optimization-bridge",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "initialized": _orchestrator is not None and _orchestrator._initialized,
    })


async def handle_ready(request: web.Request) -> web.Response:
    """
    GET /ready — Readiness probe (no auth).
    Returns 200 iff the orchestrator is fully initialized. ECS/k8s should use
    this for service-registration gating; /health remains the liveness probe.
    """
    ready = _orchestrator is not None and _orchestrator._initialized
    return web.json_response(
        {"ready": ready, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        status=200 if ready else 503,
    )


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
    except Exception as exc:  # noqa: BLE001 — last-chance handler
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
        # Don't block startup if pre-warm fails — /ready will return 503 until
        # a lazy initialization succeeds on a real request.
        logger.warning("bridge_prewarm_failed", error=str(exc))


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

    # Order matters: correlation/error wraps innermost, CORS wraps outermost.
    app.middlewares.append(correlation_and_error_middleware)
    app.middlewares.append(cors_middleware)

    app.on_startup.append(_on_startup)

    # Register routes
    app.router.add_post("/optimize", handle_optimize)
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
