"""
LLMLingua 2 — selective prompt compression.

Uygulanır:
  - 500+ token system promptlar
  - Uzun doküman referansları (README, spec)
  - Tekrarlayan açıklama blokları (PROSE, SYSTEM_PROMPT, DOC_REFERENCE)

Uygulanmaz:
  - Kod blokları (``` ... ```)
  - Hata mesajları / stack trace'ler
  - 100 token altı kısa mesajlar (overhead değmez)
"""
from __future__ import annotations

import asyncio
import re
import threading
from enum import Enum, auto
from typing import TYPE_CHECKING

from config import Settings

if TYPE_CHECKING:
    pass  # forward refs only

# C4 fix: module-level lock so only one thread loads the heavy LLMLingua model.
_MODEL_LOCK = threading.Lock()


class ContentType(Enum):
    CODE_BLOCK = auto()
    ERROR_MSG = auto()
    STACK_TRACE = auto()
    SHORT_MSG = auto()      # <100 tokens — skip
    PROSE = auto()
    SYSTEM_PROMPT = auto()
    DOC_REFERENCE = auto()


_CODE_FENCE_RE = re.compile(r"```[\s\S]*?```", re.M)
_TRACE_RE = re.compile(
    r"Traceback \(most recent call last\)|File \".*\", line \d+|"
    r"^\s+at \S+ \(.*:\d+:\d+\)",
    re.M,
)
_ERROR_RE = re.compile(r"(Error:|Exception:|FAILED|AssertionError)", re.M)
_DOC_RE = re.compile(r"(^#{1,3}\s|\*\*[^*]+\*\*|^>\s|^\*\s)", re.M)
# M6 fix: detect system prompts by common "You are ..." opening pattern
_SYSTEM_PROMPT_RE = re.compile(r"^You are\b", re.M)


def _detect_content_type(text: str) -> ContentType:
    tokens = len(text.split())
    if tokens < 100:
        return ContentType.SHORT_MSG
    if _CODE_FENCE_RE.search(text):
        return ContentType.CODE_BLOCK
    if _TRACE_RE.search(text):
        return ContentType.STACK_TRACE
    if _ERROR_RE.search(text):
        return ContentType.ERROR_MSG
    if _SYSTEM_PROMPT_RE.search(text):
        return ContentType.SYSTEM_PROMPT
    if _DOC_RE.search(text):
        return ContentType.DOC_REFERENCE
    return ContentType.PROSE


def _compression_rate(ctype: ContentType, settings: Settings) -> float | None:
    """Return target rate or None (= skip compression)."""
    mapping: dict[ContentType, float] = {
        ContentType.PROSE: settings.llmlingua_rate_general,
        ContentType.SYSTEM_PROMPT: settings.llmlingua_rate_general,
        ContentType.DOC_REFERENCE: settings.llmlingua_rate_technical,
    }
    return mapping.get(ctype)  # CODE_BLOCK, ERROR_MSG, STACK_TRACE, SHORT_MSG → None


class LLMLinguaCompressor:
    """
    Wraps the llmlingua PromptCompressor.

    Lazy-loads the model on first use so server startup is not blocked
    when llmlingua/torch is not installed.
    """

    MODEL_ID = "microsoft/llmlingua-2-xlm-roberta-large-meetingbank"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._compressor: object = None

    def _ensure_loaded(self) -> None:
        # Fast path (no lock needed after first load)
        if self._compressor is not None:
            return
        # C4 fix: hold module-level lock so concurrent calls don't load model twice.
        with _MODEL_LOCK:
            if self._compressor is not None:  # double-check inside lock
                return
            try:
                from llmlingua import PromptCompressor  # type: ignore[import]
                self._compressor = PromptCompressor(
                    model_name=self.MODEL_ID,
                    use_llmlingua2=True,
                    device_map="cpu",
                )
            except ImportError as exc:
                raise RuntimeError(
                    f"llmlingua yüklü değil: {exc}  — pip install llmlingua"
                ) from exc

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Sync internals — wrapped by async public API via asyncio.to_thread
    # ------------------------------------------------------------------

    def _compress_sync(self, text: str) -> tuple[str, float]:
        """Blocking compress — called inside a thread via asyncio.to_thread."""
        ctype = _detect_content_type(text)
        rate = _compression_rate(ctype, self.settings)
        if rate is None:
            return text, 0.0

        try:
            self._ensure_loaded()
        except RuntimeError:
            return text, 0.0

        try:
            result = self._compressor.compress_prompt(  # type: ignore[attr-defined]
                text,
                rate=rate,
                force_tokens=["!", "?", "\n", ":", ";"],
            )
            compressed: str = result["compressed_prompt"]
            savings = max(0.0, (1 - len(compressed) / max(len(text), 1)) * 100)
            return compressed, savings
        except Exception:
            return text, 0.0

    def _compress_sections_sync(self, text: str) -> tuple[str, float]:
        """Blocking compress_sections — called inside a thread via asyncio.to_thread."""
        parts = _CODE_FENCE_RE.split(text)
        fences = _CODE_FENCE_RE.findall(text)

        original_len = len(text)
        compressed_parts: list[str] = []

        fence_idx = 0
        for part in parts:
            compressed_part, _ = self._compress_sync(part)
            compressed_parts.append(compressed_part)
            if fence_idx < len(fences):
                compressed_parts.append(fences[fence_idx])  # code fence: untouched
                fence_idx += 1

        result = "".join(compressed_parts)
        savings = max(0.0, (1 - len(result) / max(original_len, 1)) * 100)
        return result, savings

    # ------------------------------------------------------------------
    # Async public API — offloads blocking work to a thread
    # ------------------------------------------------------------------

    async def compress(self, text: str) -> tuple[str, float]:
        """
        Compress a single text block (non-blocking).
        Returns: (compressed_text, savings_percent)
        savings_percent=0.0 → no compression applied.
        """
        return await asyncio.to_thread(self._compress_sync, text)

    async def compress_sections(self, text: str) -> tuple[str, float]:
        """
        Split on code fences, compress only non-code sections (non-blocking).
        For mixed content (explanation + code).
        """
        return await asyncio.to_thread(self._compress_sections_sync, text)
