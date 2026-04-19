"""Tests for cleaning/cli_cleaner.py"""
import pytest
from cleaning.cli_cleaner import clean, detect_command, _strip_ansi


def test_strip_ansi():
    colored = "\x1b[32mhello\x1b[0m world"
    assert _strip_ansi(colored) == "hello world"


def test_git_log_truncates_to_10():
    lines = [f"abcdef{i:04d} commit message {i}" for i in range(50)]
    text = "git log --oneline\n" + "\n".join(lines)
    result = clean(text)
    assert result.cleaned_lines <= 12  # 10 commits + possible header
    assert result.savings_percent > 50


def test_git_log_shortens_hash():
    text = "git log --oneline\nabc1234567890 First commit\ndef9876543210 Second commit"
    result = clean(text)
    assert "abc1234" in result.cleaned
    assert "abc1234567890" not in result.cleaned


def test_detect_git_log():
    text = "git log --oneline\nabc1234 First commit"
    assert detect_command(text) == "git log"


def test_detect_docker_ps():
    text = "docker ps\nCONTAINER ID   IMAGE   COMMAND"
    assert detect_command(text) == "docker ps"


def test_pytest_keeps_failed():
    lines = [
        "collected 20 items",
        "test_foo.py::test_bar PASSED",
        "test_foo.py::test_baz PASSED",
        "FAILED test_foo.py::test_broken - AssertionError: expected True",
        "short test summary info",
        "FAILED test_foo.py::test_broken",
        "1 failed, 19 passed",
    ]
    text = "pytest tests/\n" + "\n".join(lines)
    result = clean(text)
    assert "FAILED" in result.cleaned
    assert "1 failed" in result.cleaned


def test_dedup_removes_repeated_lines():
    text = "git status\nOn branch main\nOn branch main\nnothing to commit\n"
    result = clean(text)
    assert result.cleaned.count("On branch main") == 1


def test_blank_line_collapse():
    text = "git status\nline1\n\n\n\nline2"
    result = clean(text)
    # At most 2 consecutive newlines in output
    assert "\n\n\n" not in result.cleaned


def test_savings_percent_non_negative():
    result = clean("short text")
    assert result.savings_percent >= 0.0


def test_npm_install_keeps_errors():
    lines = [
        "npm WARN deprecated package@1.0.0",
        "npm timing reifyNode Completed in 234ms",
        "added 42 packages in 3.5s",
        "npm ERR! code E404",
        "npm ERR! 404 Not Found",
    ]
    text = "npm install\n" + "\n".join(lines)
    result = clean(text)
    assert "npm ERR!" in result.cleaned
