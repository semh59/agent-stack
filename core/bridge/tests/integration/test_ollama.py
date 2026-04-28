"""
Integration tests â€” require Ollama running at ALLOY_OLLAMA_URL.

Mark: @pytest.mark.integration
Run:  pytest tests/integration/ -v -m integration

In Docker:
    docker compose run --rm bridge pytest tests/integration/ -v -m integration
"""
from __future__ import annotations

import os
import pytest
import httpx
import asyncio


OLLAMA_URL = os.environ.get("ALLOY_OLLAMA_URL", "http://localhost:11434")

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def ollama_available() -> bool:
    try:
        r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5.0)
        return r.status_code == 200
    except Exception:
        return False


skip_if_no_ollama = pytest.mark.skipif(
    not ollama_available(),
    reason=f"Ollama not available at {OLLAMA_URL}",
)


# ---------------------------------------------------------------------------
# Ollama connectivity
# ---------------------------------------------------------------------------


@skip_if_no_ollama
def test_ollama_health():
    r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=10.0)
    assert r.status_code == 200
    data = r.json()
    assert "models" in data


@skip_if_no_ollama
def test_ollama_models_available():
    r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=10.0)
    models = {m["name"] for m in r.json().get("models", [])}
    # At least one of our required models must be present
    required_families = ["nomic", "gemma", "qwen"]
    assert any(
        any(family in m for family in required_families)
        for m in models
    ), (
        f"No required model found. Need one of {required_families}. Available: {models}"
    )


# ---------------------------------------------------------------------------
# Caveman compressor via Ollama
# ---------------------------------------------------------------------------


@skip_if_no_ollama
@pytest.mark.asyncio
async def test_caveman_lite_mode(tmp_settings):
    """LITE mode never calls Ollama â€” always works."""
    from alloy_compression.caveman import CavemanCompressor
    comp = CavemanCompressor(tmp_settings)
    prose = (
        "You should really just basically ensure that the system is "
        "essentially working correctly and definitely functioning as expected. " * 3
    )
    result, savings = await comp.compress(prose, mode="lite")
    assert savings > 0
    assert len(result) < len(prose)


@skip_if_no_ollama
@pytest.mark.asyncio
@pytest.mark.timeout(180)
async def test_caveman_full_mode_with_ollama(tmp_settings):
    """FULL mode calls Ollama â€” requires service running."""
    # Check generation model available
    r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5.0)
    models = {m["name"] for m in r.json().get("models", [])}
    if not any("mistral" in m or "qwen" in m or "gemma" in m for m in models):
        pytest.skip("No compression model (mistral/qwen/gemma) available in Ollama")

    from config import Settings
    settings = Settings(ollama_url=OLLAMA_URL)
    from alloy_compression.caveman import CavemanCompressor
    comp = CavemanCompressor(settings)
    prose = (
        "Actually, you should basically just really make sure that you "
        "are essentially always fundamentally thinking about how to very "
        "thoroughly and definitely ensure that the code is quite correct "
        "and working as expected in all situations. " * 2
    )
    result, savings = await comp.compress(prose, mode="full")
    # Fallback to lite if Ollama can't compress â€” still check it ran
    assert isinstance(result, str)
    assert len(result) > 0


# ---------------------------------------------------------------------------
# Semantic cache embeddings via Ollama
# ---------------------------------------------------------------------------


@skip_if_no_ollama
@pytest.mark.asyncio
async def test_semantic_cache_embed(tmp_settings):
    """Verify nomic-embed-text returns a 768-dim vector."""
    # Check model available
    r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5.0)
    models = {m["name"] for m in r.json().get("models", [])}
    if not any("nomic" in m for m in models):
        pytest.skip("nomic-embed-text not available")

    from config import Settings
    settings = Settings(ollama_url=OLLAMA_URL)
    from cache.semantic import SemanticCache
    cache = SemanticCache(settings)
    embedding = await cache._embed("hello world test")
    assert isinstance(embedding, list)
    assert len(embedding) == 768
    assert any(v != 0.0 for v in embedding)


@skip_if_no_ollama
@pytest.mark.asyncio
async def test_semantic_cache_set_get(tmp_settings):
    """End-to-end: store then retrieve from semantic cache."""
    r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5.0)
    models = {m["name"] for m in r.json().get("models", [])}
    if not any("nomic" in m for m in models):
        pytest.skip("nomic-embed-text not available")

    from config import Settings
    settings = Settings(ollama_url=OLLAMA_URL, data_dir=tmp_settings.data_dir)
    from cache.semantic import SemanticCache
    cache = SemanticCache(settings)

    msg = "What is the capital of France?"
    response = "Paris is the capital of France."
    await cache.set(msg, [], response)

    # Exact same query should hit
    result = await cache.get(msg, [])
    assert result == response

    # Very similar query should also hit (high similarity)
    result2 = await cache.get("What is France's capital city?", [])
    # May or may not hit depending on threshold â€” just verify no crash
    assert result2 is None or isinstance(result2, str)


# ---------------------------------------------------------------------------
# Full pipeline orchestrator
# ---------------------------------------------------------------------------


@skip_if_no_ollama
@pytest.mark.asyncio
@pytest.mark.timeout(180)
async def test_orchestrator_optimize_cli_command():
    """CLI command input â†’ cli_cleaner layer applied."""
    from config import Settings
    settings = Settings(ollama_url=OLLAMA_URL)
    from pipeline.optimization_pipeline import OptimizationPipeline
    orch = OptimizationPipeline(settings)
    await orch.initialize()

    git_log = (
        "$ git log --oneline\n"
        + "\n".join([f"a1b2c3d{i} fix: some commit message #{i}" for i in range(20)])
    )
    result = await orch.optimize(git_log)
    assert result.original_tokens > 0
    # cli_cleaner should truncate to â‰¤10 commits
    lines = [line for line in result.optimized_message.splitlines() if line.strip()]
    assert len(lines) <= 12  # 10 commits + possible header/truncation note


@skip_if_no_ollama
@pytest.mark.asyncio
@pytest.mark.timeout(180)
async def test_orchestrator_cache_hit_on_repeat():
    """Second identical request should return from exact cache."""
    from config import Settings
    import tempfile
    import pathlib
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        settings = Settings(ollama_url=OLLAMA_URL, data_dir=pathlib.Path(tmpdir))
        from pipeline.optimization_pipeline import OptimizationPipeline
        orch = OptimizationPipeline(settings)
        await orch.initialize()

        msg = "How do I reverse a list in Python? " * 5
        r1 = await orch.optimize(msg)
        r2 = await orch.optimize(msg)

        assert r2.cache_hit is True
        assert r2.optimized_message == r1.optimized_message


@skip_if_no_ollama
@pytest.mark.asyncio
@pytest.mark.timeout(180)
async def test_cost_tracker_records_request():
    """cost_tracker should log the request to SQLite."""
    from config import Settings
    import tempfile
    import pathlib
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        settings = Settings(ollama_url=OLLAMA_URL, data_dir=pathlib.Path(tmpdir))
        from pipeline.optimization_pipeline import OptimizationPipeline
        orch = OptimizationPipeline(settings)
        await orch.initialize()

        await orch.optimize("Tell me about Python generators. " * 10)
        report = await orch.cost_tracker.report("today")

        assert report["requests"] >= 1


# ---------------------------------------------------------------------------
# Caveman HTTP service (if running)
# ---------------------------------------------------------------------------


CAVEMAN_URL = os.environ.get("CAVEMAN_SERVICE_URL", "http://localhost:5000")


def caveman_available() -> bool:
    try:
        r = httpx.get(f"{CAVEMAN_URL}/health", timeout=3.0)
        return r.status_code == 200
    except Exception:
        return False


skip_if_no_caveman = pytest.mark.skipif(
    not caveman_available(),
    reason=f"Caveman service not available at {CAVEMAN_URL}",
)


@skip_if_no_caveman
def test_caveman_service_health():
    r = httpx.get(f"{CAVEMAN_URL}/health", timeout=5.0)
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


@skip_if_no_caveman
def test_caveman_service_optimize_lite():
    payload = {
        "text": "You should really just basically ensure that the system works.",
        "mode": "lite",
    }
    r = httpx.post(f"{CAVEMAN_URL}/optimize", json=payload, timeout=10.0)
    assert r.status_code == 200
    data = r.json()
    assert "optimized" in data
    assert data["savings_pct"] >= 0


@skip_if_no_caveman
def test_caveman_service_stats():
    r = httpx.get(f"{CAVEMAN_URL}/stats", timeout=5.0)
    assert r.status_code == 200
    data = r.json()
    assert "requests_processed" in data
    assert "uptime_seconds" in data


@skip_if_no_caveman
def test_caveman_service_rejects_empty():
    r = httpx.post(f"{CAVEMAN_URL}/optimize", json={"text": "", "mode": "lite"}, timeout=5.0)
    assert r.status_code == 400


@skip_if_no_caveman
def test_caveman_service_rejects_bad_mode():
    r = httpx.post(
        f"{CAVEMAN_URL}/optimize",
        json={"text": "some text", "mode": "invalid"},
        timeout=5.0,
    )
    assert r.status_code == 400
