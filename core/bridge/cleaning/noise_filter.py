"""
Noise Filter â€” remove low-value content Claude Code automatically adds.

Temizlenenler:
  - Ham JSON tool result bloklarÄ± â†’ kÄ±sa Ã¶zet
  - Stack trace'lerin body'si â†’ sadece son hata satÄ±rÄ±
  - Tekrar eden <document> header'larÄ±
  - Onay mesajlarÄ± (tamam, ok, anladÄ±m vb.)
  - AynÄ± iÃ§eriÄŸin tekrar eden bloklarÄ±
"""
from __future__ import annotations

import json
import re


# ---------------------------------------------------------------------------
# Tool result summariser
# ---------------------------------------------------------------------------

# C2 fix: use (?:[^"\\]|\\.) to correctly handle escaped quotes inside JSON strings.
# [^"] stopped at the first \" escape; the new pattern matches either a normal char
# or a backslash followed by any character (the correct JSON string grammar).
_TOOL_RESULT_RE = re.compile(
    r'\{"type"\s*:\s*"tool_result"[^}]*"content"\s*:\s*"((?:[^"\\]|\\.){300,})"',
    re.S,
)


def _summarize_tool_result(m: re.Match[str]) -> str:
    try:
        raw = m.group(1)
        # H7 fix: json.loads(f'"{raw}"') decodes JSON string escapes correctly
        # (standard technique). If raw has unescaped control chars, fall back to raw.
        try:
            decoded: str = json.loads(f'"{raw}"')
        except (json.JSONDecodeError, ValueError):
            decoded = raw  # raw as-is (best-effort)

        # Try to parse decoded value as JSON object for richer preview
        try:
            inner = json.loads(decoded)
            if isinstance(inner, dict) and "output" in inner:
                preview = str(inner["output"])[:200]
            elif isinstance(inner, dict):
                preview = str(inner)[:200]
            else:
                preview = decoded[:200]
        except (json.JSONDecodeError, ValueError):
            preview = decoded[:200]

        return f'[tool result: {preview}{"..." if len(raw) > 200 else ""}]'
    except Exception:
        return f"[tool result: {m.group(0)[:200]}...]"


# ---------------------------------------------------------------------------
# Stack trace truncation
# ---------------------------------------------------------------------------

_TRACEBACK_RE = re.compile(
    r"(Traceback \(most recent call last\)[\s\S]{200,}?)(\w+Error[^\n]*)",
    re.M,
)


def _shorten_traceback(m: re.Match[str]) -> str:
    last_error = m.group(2)
    return f"[traceback truncated] {last_error}"


# ---------------------------------------------------------------------------
# Document header dedup
# ---------------------------------------------------------------------------

_DOC_HEADER_RE = re.compile(
    r"<document_content>\s*<source>[^\n]+\n",
    re.M,
)

_SECTION_HEADER_RE = re.compile(
    r"(={3,}|#{1,3})\s*([^\n]{1,80})\n(?=[\s\S]*?\1\s*\2\n)",
    re.M,
)


# ---------------------------------------------------------------------------
# Short acknowledgement removal
# ---------------------------------------------------------------------------

_SHORT_ACK_RE = re.compile(
    r"^(tamam|tamamdÄ±r|ok|anladÄ±m|evet|hayÄ±r|teÅŸekkÃ¼rler?|sure|got it|understood|okay)[.!\s]*$",
    re.I | re.M,
)


# ---------------------------------------------------------------------------
# Repeated block detection
# ---------------------------------------------------------------------------

def _remove_repeated_blocks(text: str, min_block_len: int = 100) -> str:
    """Remove paragraphs that appear more than once."""
    paragraphs = text.split("\n\n")
    seen: set[str] = set()
    out: list[str] = []
    for para in paragraphs:
        key = para.strip()
        if len(key) >= min_block_len:
            if key in seen:
                continue
            seen.add(key)
        out.append(para)
    return "\n\n".join(out)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def filter_noise(message: str) -> str:
    """
    Apply all noise filters. Returns cleaned message.
    Filters are idempotent and order-independent.
    """
    if not message:
        return message

    # 1. Summarise large tool result JSON blobs
    message = _TOOL_RESULT_RE.sub(_summarize_tool_result, message)

    # 2. Truncate stack traces
    message = _TRACEBACK_RE.sub(_shorten_traceback, message)

    # 3. Remove document header boilerplate
    message = _DOC_HEADER_RE.sub("", message)

    # 4. Remove short ack-only lines
    message = _SHORT_ACK_RE.sub("", message)

    # 5. Remove repeated paragraph blocks
    message = _remove_repeated_blocks(message)

    # 6. Collapse excess blank lines
    message = re.sub(r"\n{3,}", "\n\n", message)

    return message.strip()
