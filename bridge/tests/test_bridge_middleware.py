"""
Unit tests for the bridge's handlers + middleware.

We avoid spinning up an HTTP server (which conflicts with pytest-asyncio's
auto-mode on this Python/aiohttp version) and instead drive the handlers and
middleware directly with a minimal fake request. This tests the same behavior
with fewer moving parts.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def bridge_module(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("AI_STACK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AI_STACK_BRIDGE_SECRET", "test-secret")
    monkeypatch.setenv("BRIDGE_CORS_ORIGIN", "http://example.com")
    sys.path.insert(0, str(ROOT))

    for modname in list(sys.modules):
        if modname == "bridge":
            del sys.modules[modname]

    return importlib.import_module("bridge")


@pytest.fixture
def fake_orchestrator():
    orch = MagicMock()
    orch._initialized = True
    orch.optimize = AsyncMock()
    orch.pipeline_status = AsyncMock(return_value={"ok": True})
    return orch


def _req(method: str, path: str, *, headers: dict | None = None, body: bytes | None = None):
    """Build a mocked aiohttp request without a running server."""
    h = {"Host": "localhost"}
    if headers:
        h.update(headers)
    req = make_mocked_request(method, path, headers=h, payload=None)
    if body is not None:
        # make_mocked_request does not give us a real body; stub .json() & .read()
        async def _json():
            import json
            return json.loads(body.decode("utf-8"))
        async def _read():
            return body
        req.json = _json  # type: ignore[assignment]
        req.read = _read  # type: ignore[assignment]
    return req


async def _wrap_with_mw(bridge_module, handler, request):
    """Invoke the correlation/error middleware around a handler."""
    return await bridge_module.correlation_and_error_middleware(request, handler)


@pytest.mark.asyncio
async def test_health_unauthenticated(bridge_module, fake_orchestrator):
    bridge_module._orchestrator = fake_orchestrator
    req = _req("GET", "/health")
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_health, req)
    assert resp.status == 200
    body = resp.body.decode("utf-8") if resp.body else ""
    assert "\"status\": \"ok\"" in body
    assert "X-Request-ID" in resp.headers


@pytest.mark.asyncio
async def test_ready_returns_503_when_uninitialized(bridge_module):
    bridge_module._orchestrator = None
    req = _req("GET", "/ready")
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_ready, req)
    assert resp.status == 503


@pytest.mark.asyncio
async def test_ready_returns_200_when_initialized(bridge_module, fake_orchestrator):
    bridge_module._orchestrator = fake_orchestrator
    req = _req("GET", "/ready")
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_ready, req)
    assert resp.status == 200


@pytest.mark.asyncio
async def test_request_id_preserved(bridge_module, fake_orchestrator):
    bridge_module._orchestrator = fake_orchestrator
    req = _req("GET", "/health", headers={"X-Request-ID": "rid-abc-123"})
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_health, req)
    assert resp.headers["X-Request-ID"] == "rid-abc-123"


@pytest.mark.asyncio
async def test_request_id_generated_when_absent(bridge_module, fake_orchestrator):
    bridge_module._orchestrator = fake_orchestrator
    req = _req("GET", "/health")
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_health, req)
    rid = resp.headers.get("X-Request-ID", "")
    assert rid and len(rid) >= 8


@pytest.mark.asyncio
async def test_protected_route_rejects_without_secret(bridge_module):
    req = _req("POST", "/optimize", body=b'{"message":"hi"}')
    # handle_optimize is already wrapped by @_auth_guard
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_optimize, req)
    assert resp.status == 401


@pytest.mark.asyncio
async def test_protected_route_rejects_wrong_secret(bridge_module):
    req = _req(
        "POST",
        "/optimize",
        headers={"X-Bridge-Secret": "wrong"},
        body=b'{"message":"hi"}',
    )
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_optimize, req)
    assert resp.status == 401


@pytest.mark.asyncio
async def test_protected_route_accepts_correct_secret(bridge_module, fake_orchestrator):
    bridge_module._orchestrator = fake_orchestrator
    fake_result = MagicMock()
    fake_result.to_json.return_value = (
        '{"optimized":"hi","savings_percent":0.0,"cache_hit":false,'
        '"layers":[],"model":"test","tokens":{"original":1,"sent":1},"metadata":{}}'
    )
    fake_orchestrator.optimize = AsyncMock(return_value=fake_result)

    req = _req(
        "POST",
        "/optimize",
        headers={"X-Bridge-Secret": "test-secret"},
        body=b'{"message":"hi"}',
    )
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_optimize, req)
    assert resp.status == 200


@pytest.mark.asyncio
async def test_optimize_missing_message_returns_400(bridge_module, fake_orchestrator):
    bridge_module._orchestrator = fake_orchestrator
    req = _req(
        "POST",
        "/optimize",
        headers={"X-Bridge-Secret": "test-secret"},
        body=b"{}",
    )
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_optimize, req)
    assert resp.status == 400


@pytest.mark.asyncio
async def test_unhandled_exception_becomes_structured_500(bridge_module, fake_orchestrator):
    import json as _json
    bridge_module._orchestrator = fake_orchestrator
    fake_orchestrator.optimize = AsyncMock(side_effect=RuntimeError("kaboom"))

    req = _req(
        "POST",
        "/optimize",
        headers={"X-Bridge-Secret": "test-secret"},
        body=b'{"message":"trigger"}',
    )
    resp = await _wrap_with_mw(bridge_module, bridge_module.handle_optimize, req)
    assert resp.status == 500
    body = _json.loads(resp.body.decode("utf-8"))
    assert body["error"] == "internal_error"
    assert body["message"] == "kaboom"
    assert body["error_type"] == "RuntimeError"
    assert "request_id" in body
    assert resp.headers["X-Request-ID"] == body["request_id"]
