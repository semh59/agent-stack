"""Tests for pipeline/discovery_agent.py"""
import json
import pytest
from unittest.mock import AsyncMock

from pipeline.discovery_agent import DiscoveryAgent, DiscoveryContext


def _mock_router(content: str) -> AsyncMock:
    router = AsyncMock()
    router.route_call.return_value = {
        "choices": [{"message": {"content": content}}]
    }
    return router


@pytest.mark.asyncio
async def test_discover_basic():
    payload = {
        "clarified_goal": "Todo app",
        "target_audience": "personal use",
        "tech_constraints": [],
        "must_have": ["add task", "delete task"],
        "nice_to_have": ["due dates"],
        "clarification_questions": [],
    }
    agent = DiscoveryAgent(_mock_router(json.dumps(payload)))
    ctx = await agent.discover("bir todo uygulamasÄ± yap")

    assert ctx.clarified_goal == "Todo app"
    assert "add task" in ctx.must_have
    assert "delete task" in ctx.must_have
    assert ctx.clarification_rounds == 1
    assert ctx.target_audience == "personal use"


@pytest.mark.asyncio
async def test_discover_increments_rounds():
    payload = {"clarified_goal": "Blog", "must_have": ["posts"], "nice_to_have": [],
               "tech_constraints": [], "target_audience": "", "clarification_questions": []}
    agent = DiscoveryAgent(_mock_router(json.dumps(payload)))
    ctx = await agent.discover("blog yap")
    assert ctx.clarification_rounds == 1


@pytest.mark.asyncio
async def test_discover_fallback_on_bad_json():
    """Router returns garbage JSON â†’ fallback to raw prompt."""
    router = AsyncMock()
    router.route_call.return_value = {
        "choices": [{"message": {"content": "not json at all"}}]
    }
    agent = DiscoveryAgent(router)
    ctx = await agent.discover("bir ÅŸey yap")

    # Fallback: raw_prompt used as clarified_goal
    assert ctx.clarified_goal == "bir ÅŸey yap"
    assert ctx.clarification_rounds == 1


@pytest.mark.asyncio
async def test_discover_fallback_on_router_error():
    """Router raises exception â†’ fallback to raw prompt."""
    router = AsyncMock()
    router.route_call.side_effect = RuntimeError("network error")
    agent = DiscoveryAgent(router)
    ctx = await agent.discover("hata testi")

    assert ctx.clarified_goal == "hata testi"
    assert ctx.clarification_rounds == 1


def test_discovery_context_is_complete_with_must_have():
    ctx = DiscoveryContext(
        raw_prompt="test",
        clarified_goal="Build X",
        must_have=["feature A"],
    )
    assert ctx.is_complete() is True


def test_discovery_context_is_complete_after_two_rounds():
    ctx = DiscoveryContext(
        raw_prompt="test",
        clarified_goal="Build X",
        clarification_rounds=2,
    )
    assert ctx.is_complete() is True


def test_discovery_context_incomplete_no_goal():
    ctx = DiscoveryContext(raw_prompt="test")
    assert ctx.is_complete() is False


def test_to_spec_prompt_includes_fields():
    ctx = DiscoveryContext(
        raw_prompt="test",
        clarified_goal="Goal",
        target_audience="devs",
        tech_constraints=["Python"],
        must_have=["auth"],
        nice_to_have=["dark mode"],
    )
    prompt = ctx.to_spec_prompt()
    assert "Goal" in prompt
    assert "devs" in prompt
    assert "Python" in prompt
    assert "auth" in prompt
    assert "dark mode" in prompt
