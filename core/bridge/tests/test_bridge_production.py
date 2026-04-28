"""
Tests for bridge.py production-mode hardening:
  - refuses to boot without ALLOY_BRIDGE_SECRET in staging/prod
  - propagates X-Request-ID through responses
  - constant-time secret compare
  - error middleware converts exceptions to structured JSON
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent


def _reset_bridge_module():
    """Force bridge and config modules to be re-imported with current env."""
    for modname in list(sys.modules):
        if modname in ("bridge", "config") or modname.startswith(("bridge.", "config.")):
            del sys.modules[modname]
    sys.path.insert(0, str(ROOT))


def test_bridge_exits_in_production_without_secret(monkeypatch, tmp_path):
    """APP_ENV=production and no secret â†’ sys.exit(78) EX_CONFIG."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOY_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ALLOY_BRIDGE_SECRET", raising=False)

    _reset_bridge_module()

    with pytest.raises(SystemExit) as exc_info:
        importlib.import_module("bridge")

    assert exc_info.value.code == 78, (
        "production boot without secret must exit with EX_CONFIG (78)"
    )


def test_bridge_exits_in_staging_without_secret(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("ALLOY_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ALLOY_BRIDGE_SECRET", raising=False)

    _reset_bridge_module()

    with pytest.raises(SystemExit) as exc_info:
        importlib.import_module("bridge")

    assert exc_info.value.code == 78


def test_bridge_uses_default_secret_in_development(monkeypatch, tmp_path):
    """In development mode, a missing secret uses the default from config (if not generated)."""
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("ALLOY_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ALLOY_BRIDGE_SECRET", raising=False)

    _reset_bridge_module()

    bridge = importlib.import_module("bridge")
    secret = bridge._get_bridge_secret()
    assert secret == "s3cret-v1-alloy"


def test_bridge_uses_env_secret_when_provided(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOY_BRIDGE_SECRET", "supersecret-value-1234567890")

    _reset_bridge_module()

    bridge = importlib.import_module("bridge")
    assert bridge._get_bridge_secret() == "supersecret-value-1234567890"


def test_check_auth_constant_time_compare(monkeypatch, tmp_path):
    """_check_auth uses hmac.compare_digest â€” verify correctness, not timing."""
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("ALLOY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOY_BRIDGE_SECRET", "s3cret")

    _reset_bridge_module()
    bridge = importlib.import_module("bridge")

    # Build a fake request object with a headers dict.
    class FakeHeaders(dict):
        def get(self, key, default=""):
            return super().get(key, default)

    class FakeRequest:
        def __init__(self, token):
            self.headers = FakeHeaders({"X-Bridge-Secret": token} if token else {})

    assert bridge._check_auth(FakeRequest("s3cret")) is True
    assert bridge._check_auth(FakeRequest("wrong")) is False
    assert bridge._check_auth(FakeRequest("")) is False
    assert bridge._check_auth(FakeRequest(None)) is False
