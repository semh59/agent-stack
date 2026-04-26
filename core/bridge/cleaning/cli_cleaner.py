"""
CLI Output Cleaner — deterministic, zero-dependency RTK replacement.

Temizlenen içerik:
  - ANSI escape kodları
  - git log: son 10 commit, hash 7 karaktere kısaltılır
  - git diff: max 200 satır, context satırları azaltılır
  - docker ps/images: önemli sütunlar tutulur
  - npm/pip install: sadece error/warn satırları
  - pytest: sadece FAILED/ERROR + özet satırı
  - Tekrar eden satırlar dedup edilir
  - Boş satır blokları tek boş satıra indirilir
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable


@dataclass
class CleanResult:
    cleaned: str
    original_lines: int
    cleaned_lines: int
    savings_percent: float


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[mGKHFABCDEFJKSTlh]")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _dedup_lines(lines: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped not in seen:
            seen.add(stripped)
            out.append(line)
    return out


def _limit(items: list[str], n: int) -> list[str]:
    """Helper to bypass linter indexing issues with slices."""
    return items[slice(0, n)]


def _collapse_blank_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    blank_run = 0
    for line in lines:
        if line.strip() == "":
            blank_run += 1
            if blank_run == 1:
                out.append(line)
        else:
            blank_run = 0
            out.append(line)
    return out


# ---------------------------------------------------------------------------
# Command-specific cleaners
# ---------------------------------------------------------------------------

_GIT_HASH_RE = re.compile(r"^([a-f0-9]{8,})\s+(.*)")


def _clean_git_log(lines: list[str]) -> list[str]:
    """Keep last 10 commits, shorten hash to 7 chars."""
    result: list[str] = []
    for i, line in enumerate(lines):
        if i >= 10:
            break
        m = _GIT_HASH_RE.match(line.strip())
        if m:
            full_hash: str = str(m.group(1))
            short_hash = full_hash[0:7]
            result.append(f"{short_hash} {m.group(2)}")
        else:
            result.append(line)
    return result


def _clean_git_diff(lines: list[str]) -> list[str]:
    """Max 200 lines. Limit unchanged context lines to 3 per hunk."""
    out: list[str] = []
    ctx_count = 0
    for i, line in enumerate(lines):
        if i >= 200:
            break
        ch = line[0] if line else " "
        if ch in ("+", "-", "@", "d", "i", "n"):  # diff, index, new file
            ctx_count = 0
            out.append(line)
        elif ch == " ":  # context line
            ctx_count += 1
            if ctx_count <= 3:
                out.append(line)
        else:
            ctx_count = 0
            out.append(line)
    if len(lines) > 200:
        out.append(f"... [{len(lines) - 200} more lines truncated]")
    return out


def _clean_git_status(lines: list[str]) -> list[str]:
    return lines[0:60]


def _clean_docker_ps(lines: list[str]) -> list[str]:
    """Keep CONTAINER ID, NAMES, STATUS — truncate each line to 100 chars."""
    return [line[:100] for line in lines[:30]]


def _clean_docker_images(lines: list[str]) -> list[str]:
    return [line[0:100] for line in lines[0:25]]


def _clean_docker_logs(lines: list[str]) -> list[str]:
    """Keep last 50 lines (most recent)."""
    return lines[-50:]


_NPM_SKIP_RE = re.compile(
    r"^\s*([\⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏▸▾►◄]|npm timing|npm http|^added \d|reify:|idealTree)"
)
_NPM_KEEP_RE = re.compile(r"(npm (?:warn|err)|error|added \d+|removed \d+|changed \d+)", re.I)


def _clean_npm_install(lines: list[str]) -> list[str]:
    out = [line for line in lines if _NPM_KEEP_RE.search(line) and not _NPM_SKIP_RE.match(line)]
    return out if out else lines[0:5]


_PIP_KEEP_RE = re.compile(
    r"(error|warning|successfully installed|requirement already|could not|no matching)", re.I
)


def _clean_pip_install(lines: list[str]) -> list[str]:
    out = [line for line in lines if _PIP_KEEP_RE.search(line)]
    return out if out else lines[-5:]


_PYTEST_SUMMARY_RE = re.compile(r"=+ (short test summary|FAILURES|ERRORS|passed|failed|error)", re.I)
_PYTEST_FAILED_RE = re.compile(r"(FAILED|ERROR)\s+", re.I)


def _clean_pytest(lines: list[str]) -> list[str]:
    out: list[str] = []
    in_block = False
    for line in lines:
        if _PYTEST_SUMMARY_RE.search(line):
            in_block = True
            out.append(line)
        elif _PYTEST_FAILED_RE.match(line):
            out.append(line)
        elif in_block:
            out.append(line)
        elif re.search(r"AssertionError|E\s+assert", line):
            out.append(line)
    # Always keep last summary line
    for line in reversed(lines):
        if re.search(r"\d+ (passed|failed|error)", line):
            if line not in out:
                out.append(line)
            break
    return out if out else lines[-10:]


def _clean_ls(lines: list[str]) -> list[str]:
    return lines[:60]


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------

# Keys: lowercase command prefix patterns to match
_COMMAND_RULES: dict[str, Callable[[list[str]], list[str]]] = {
    "git log":          _clean_git_log,
    "git diff":         _clean_git_diff,
    "git show":         _clean_git_diff,
    "git status":       _clean_git_status,
    "git branch":       lambda lines: _limit(lines, 30),
    "docker ps":        _clean_docker_ps,
    "docker images":    _clean_docker_images,
    "docker logs":      _clean_docker_logs,
    "npm install":      _clean_npm_install,
    "npm audit":        lambda lines: _limit([line for line in lines if re.search(r"(high|critical|moderate|low|found)", line, re.I)], 30),
    "npm outdated":     lambda lines: _limit(lines, 30),
    "pip install":      _clean_pip_install,
    "pip list":         lambda lines: _limit(lines, 50),
    "pytest":           _clean_pytest,
    "ls -la":           _clean_ls,
    "ls -l":            _clean_ls,
    "ls":               lambda lines: _limit(lines, 80),
}

# Shell prompt pattern — extracts "cmd subcmd"
_PROMPT_RE = re.compile(r"[\$#>]\s*([\w.-]+)\s+([\w.-]+)")


def detect_command(text: str) -> str | None:
    """Detect which command produced this output."""
    first_lines = "\n".join(text.strip().splitlines()[:5]).lower()

    # Exact prefix match
    for cmd in _COMMAND_RULES:
        if cmd in first_lines:
            return cmd

    # Shell prompt pattern: "$ git log" etc.
    m = _PROMPT_RE.search(first_lines)
    if m:
        candidate = f"{m.group(1)} {m.group(2)}"
        if candidate in _COMMAND_RULES:
            return candidate
        # Single-word command
        single = m.group(1)
        for cmd in _COMMAND_RULES:
            if cmd.startswith(single):
                return cmd

    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def clean(text: str) -> CleanResult:
    """
    Main entry point.
    Detect command → apply cleaner → dedup → collapse blanks.
    """
    lines = text.splitlines()
    original_count = len(lines)

    # 1. Strip ANSI
    lines = [_strip_ansi(l) for l in lines]

    # 2. Command-specific cleaning
    cmd = detect_command(text)
    if cmd:
        cleaner = _COMMAND_RULES.get(cmd)
        if cleaner:
            lines = cleaner(lines)

    # 3. Dedup + blank line collapse
    lines = _dedup_lines(lines)
    lines = _collapse_blank_lines(lines)

    cleaned = "\n".join(lines)
    savings = max(0.0, (1 - len(lines) / max(original_count, 1)) * 100)

    return CleanResult(
        cleaned=cleaned,
        original_lines=original_count,
        cleaned_lines=len(lines),
        savings_percent=savings,
    )
