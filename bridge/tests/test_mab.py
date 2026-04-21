"""Tests for pipeline/mab.py — Thompson Sampling MAB.

select_layers and reward are coroutines — these tests must await them.
"""
import pytest
from pipeline.mab import ThompsonSamplingMAB, MABArm


def test_mab_arm_sample_range():
    arm = MABArm(name="test", alpha=2.0, beta=1.0)
    for _ in range(100):
        s = arm.sample()
        assert 0.0 <= s <= 1.0


def test_mab_arm_update_reward():
    arm = MABArm(name="test")
    initial_alpha = arm.alpha
    arm.update(0.5, threshold=0.20)   # savings 50% >= threshold 20%
    assert arm.alpha > initial_alpha


def test_mab_arm_update_no_reward():
    arm = MABArm(name="test")
    initial_beta = arm.beta
    arm.update(0.05, threshold=0.20)  # savings 5% < threshold 20%
    assert arm.beta > initial_beta


@pytest.mark.asyncio
async def test_mab_select_layers_returns_candidates(tmp_settings):
    mab = ThompsonSamplingMAB(tmp_settings)
    candidates = ["cli_cleaner", "dedup", "caveman"]
    result = await mab.select_layers(candidates)
    assert set(result) == set(candidates)
    assert len(result) == 3


@pytest.mark.asyncio
async def test_mab_select_empty(tmp_settings):
    mab = ThompsonSamplingMAB(tmp_settings)
    assert await mab.select_layers([]) == []


@pytest.mark.asyncio
async def test_mab_reward_updates_arm(tmp_settings):
    mab = ThompsonSamplingMAB(tmp_settings)
    initial_alpha = mab.arms["cli_cleaner"].alpha
    await mab.reward("cli_cleaner", 70.0)
    assert mab.arms["cli_cleaner"].alpha > initial_alpha


@pytest.mark.asyncio
async def test_mab_persists_and_loads(tmp_settings):
    mab1 = ThompsonSamplingMAB(tmp_settings)
    await mab1.reward("dedup", 80.0)
    saved_alpha = mab1.arms["dedup"].alpha

    mab2 = ThompsonSamplingMAB(tmp_settings)
    assert mab2.arms["dedup"].alpha == pytest.approx(saved_alpha, abs=0.01)


def test_mab_arm_stats(tmp_settings):
    mab = ThompsonSamplingMAB(tmp_settings)
    stats = mab.arm_stats()
    assert "cli_cleaner" in stats
    assert "mean" in stats["cli_cleaner"]
    assert 0.0 <= stats["cli_cleaner"]["mean"] <= 1.0
