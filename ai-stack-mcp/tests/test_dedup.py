"""Tests for cleaning/dedup.py"""
import pytest
from cleaning.dedup import CodeDeduplicator


@pytest.fixture
def dedup():
    return CodeDeduplicator()


def test_first_occurrence_unchanged(dedup):
    code = "def hello():\n    return 42\n"
    message = f"# myfile.py\n```python\n{code}```"
    result, savings = dedup.process(message, msg_id=1)
    assert code in result
    assert savings == 0.0


def test_unchanged_file_skipped(dedup):
    # Use a long code block so the "already in context" notice is shorter
    code = "".join([f"def func_{i}():\n    return {i}\n\n" for i in range(30)])
    message = f"# bigfile.py\n```python\n{code}```"
    dedup.process(message, msg_id=1)  # first time
    result, savings = dedup.process(message, msg_id=2)  # second time
    assert "already in context" in result
    assert savings > 0


def test_changed_file_sends_diff(dedup):
    code_v1 = "def hello():\n    return 42\n"
    code_v2 = "def hello():\n    return 99\n"

    msg1 = f"# myfile.py\n```python\n{code_v1}```"
    msg2 = f"# myfile.py\n```python\n{code_v2}```"

    dedup.process(msg1, msg_id=1)
    result, savings = dedup.process(msg2, msg_id=2)
    # Either diff or full content — either way it should contain the new value
    assert "99" in result


def test_extract_function(dedup):
    source = """
def foo():
    return 1

def bar():
    return 2
"""
    extracted = dedup.extract_function(source, "bar")
    assert extracted is not None
    assert "def bar" in extracted
    assert "def foo" not in extracted


def test_extract_nonexistent_function(dedup):
    source = "def foo():\n    pass\n"
    assert dedup.extract_function(source, "nonexistent") is None


def test_reset_clears_registry(dedup):
    code = "def hello():\n    return 42\n"
    message = f"# myfile.py\n```python\n{code}```"
    dedup.process(message, msg_id=1)
    dedup.reset()
    result, savings = dedup.process(message, msg_id=2)
    assert "already in context" not in result  # fresh start
