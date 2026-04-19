"""Tests for pipeline/router.py"""
import pytest
from pipeline.router import MessageRouter, MessageType, complexity_score, model_recommendation
from config import Settings


@pytest.fixture
def router(tmp_settings):
    return MessageRouter(tmp_settings)


def test_cli_command_git(router):
    c = router.classify("git status")
    assert c.message_type == MessageType.CLI_COMMAND
    assert c.confidence >= 0.90


def test_cli_command_docker(router):
    c = router.classify("docker ps -a")
    assert c.message_type == MessageType.CLI_COMMAND


def test_code_generation(router):
    c = router.classify("write a Python function to sort a list by key")
    assert c.message_type == MessageType.CODE_GENERATION


def test_prose_reasoning(router):
    c = router.classify("explain why async/await is better than callbacks")
    assert c.message_type in (MessageType.PROSE_REASONING, MessageType.CODE_GENERATION)


def test_query(router):
    c = router.classify("find all files with .py extension")
    assert c.message_type in (MessageType.QUERY, MessageType.CLI_COMMAND)


def test_local_answerable(router):
    c = router.classify("what is a dictionary")
    assert c.message_type in (MessageType.LOCAL_ANSWERABLE, MessageType.QUERY)


def test_short_message_fast_path(router):
    c = router.classify("hi")
    assert c.message_type == MessageType.QUERY  # fast path
    assert c.confidence >= 0.60


def test_recommended_layers_cli(router):
    c = router.classify("git log --oneline")
    assert "cli_cleaner" in c.recommended_layers


def test_complexity_score_low():
    score = complexity_score("what is a list?", context_tokens=100)
    assert 0 <= score <= 3


def test_complexity_score_stack_trace():
    msg = "File \"app.py\", line 42\nTraceback (most recent call last):"
    score = complexity_score(msg, context_tokens=500)
    assert score >= 3


def test_complexity_score_architecture():
    msg = "How should I design the security architecture for the auth migration?"
    score = complexity_score(msg, context_tokens=2000)
    assert score >= 4


def test_model_recommendation_low():
    model = model_recommendation(2, context_tokens=500)
    assert "ollama" in model


def test_model_recommendation_medium():
    model = model_recommendation(5, context_tokens=3000)
    assert "openrouter" in model


def test_model_recommendation_high():
    model = model_recommendation(9, context_tokens=10000)
    assert model == "claude"
