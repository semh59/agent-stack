"""Tests for pipeline/cost_tracker.py"""
import pytest
import time
from pipeline.cost_tracker import CostTracker, CostRecord


def _make_record(**kwargs) -> CostRecord:
    defaults = dict(
        timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        original_tokens=1000,
        sent_tokens=300,
        model_used="ollama:qwen2.5-7b-q4",
        savings_percent=70.0,
        cache_hit=False,
        layers_applied=["cli_cleaner", "dedup"],
    )
    defaults.update(kwargs)
    return CostRecord(**defaults)


@pytest.mark.asyncio
async def test_log_and_report(tmp_settings):
    tracker = CostTracker(tmp_settings)
    await tracker.log(_make_record())
    report = await tracker.report("today")
    assert report["requests"] == 1
    assert report["avg_savings_percent"] == pytest.approx(70.0)


@pytest.mark.asyncio
async def test_empty_report(tmp_settings):
    tracker = CostTracker(tmp_settings)
    report = await tracker.report("today")
    assert report["requests"] == 0


@pytest.mark.asyncio
async def test_multiple_records(tmp_settings):
    tracker = CostTracker(tmp_settings)
    for savings in [50.0, 60.0, 70.0]:
        await tracker.log(_make_record(savings_percent=savings))
    report = await tracker.report("today")
    assert report["requests"] == 3
    assert report["avg_savings_percent"] == pytest.approx(60.0, abs=0.1)


@pytest.mark.asyncio
async def test_cache_hit_rate(tmp_settings):
    tracker = CostTracker(tmp_settings)
    await tracker.log(_make_record(cache_hit=True))
    await tracker.log(_make_record(cache_hit=False))
    report = await tracker.report("today")
    assert report["cache_hit_rate"] == pytest.approx(0.5, abs=0.01)


@pytest.mark.asyncio
async def test_by_layer(tmp_settings):
    tracker = CostTracker(tmp_settings)
    await tracker.log(_make_record(layers_applied=["cli_cleaner"]))
    report = await tracker.report("today")
    assert "cli_cleaner" in report["by_layer"]


@pytest.mark.asyncio
async def test_total_tokens_saved(tmp_settings):
    tracker = CostTracker(tmp_settings)
    await tracker.log(_make_record(original_tokens=1000, sent_tokens=300))
    await tracker.log(_make_record(original_tokens=2000, sent_tokens=500))
    report = await tracker.report("today")
    assert report["total_tokens_saved"] == 2200  # (1000-300) + (2000-500)
