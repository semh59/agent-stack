"""Tests for pipeline/mab.py â€” Bayesian Thompson Sampling MAB.

select_layers and reward are coroutines â€” these tests must await them.
"""
import pytest
import numpy as np
from pipeline.mab import BayesianTSAgent


@pytest.fixture
def agent(tmp_settings):
    return BayesianTSAgent(tmp_settings)


def test_agent_instantiation(agent):
    """BayesianTSAgent should initialise with dim=4 and default actions."""
    assert agent.dim == 4
    assert "rag" in agent.models
    assert "llmlingua" in agent.models


def test_get_features_from_ctx_shape(agent):
    ctx = {"intent_code": 1, "prompt_tokens": 200, "has_code": True, "history_depth": 5}
    x = agent._get_features_from_ctx(ctx)
    assert x.shape == (4, 1)


def test_get_features_from_ctx_defaults(agent):
    x = agent._get_features_from_ctx({})
    assert x.shape == (4, 1)
    # intent_val should default to 0.2 when intent_code is falsy
    assert x[0].item() == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_select_layers_returns_subset_of_candidates(agent):
    """select_layers must only return items that were in candidates."""
    candidates = ["rag", "llmlingua", "caveman"]
    result = await agent.select_layers(candidates, {"intent_code": 1, "prompt_tokens": 500})
    assert isinstance(result, list)
    assert all(item in candidates for item in result)
    assert len(result) >= 1  # fallback guarantees at least 1


@pytest.mark.asyncio
async def test_select_layers_fallback_on_empty_candidates(agent):
    """Empty candidates should return empty list (not crash)."""
    result = await agent.select_layers([], {})
    assert result == []


@pytest.mark.asyncio
async def test_select_layers_unknown_candidates_ignored(agent):
    """Candidates not in agent.models should still be handled by fallback."""
    result = await agent.select_layers(["unknown_layer"], {})
    # Fallback: return all candidates when nothing selected
    assert result == ["unknown_layer"]


@pytest.mark.asyncio
async def test_reward_updates_model(agent):
    """reward() should update mu for the specified layers."""
    ctx = [{"role": "user", "content": "fix the bug"}]
    mu_before = agent.models["llmlingua"]["mu"].copy()
    await agent.reward("test message", ctx, ["llmlingua"], savings=0.4)
    mu_after = agent.models["llmlingua"]["mu"]
    # mu should have changed after a significant reward
    assert not np.allclose(mu_before, mu_after)


@pytest.mark.asyncio
async def test_reward_skipped_on_small_savings(agent):
    """reward() should be a no-op when savings < 0.01."""
    ctx = []
    mu_before = agent.models["rag"]["mu"].copy()
    await agent.reward("msg", ctx, ["rag"], savings=0.005)
    assert np.allclose(mu_before, agent.models["rag"]["mu"])
