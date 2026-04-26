"""
Caveman Compressor — prose minimization via Ollama.

Three modes:
  LITE  — deterministik filler word removal (spaCy-free, saf regex)
  FULL  — Ollama mistral-7b ile yeniden yaz, anlamı koru
  ULTRA — Ollama → sadece madde listesine indir

CavemanDetector mevcut ai-stack caveman_adapter/detector.py'dan portlanmıştır.
"""
from __future__ import annotations

import re
from typing import Literal

import httpx

from config import Settings


# ---------------------------------------------------------------------------
# Detector — ported from caveman_adapter/detector.py
# ---------------------------------------------------------------------------


class CavemanDetector:
    """Decide when/how to apply prose compression."""

    MIN_TEXT_LENGTH = 50
    MIN_TOKEN_ESTIMATE = 20
    COMPRESSION_THRESHOLD = 0.30

    def should_compress(self, text: str) -> bool:
        if not text:
            return False
        if len(text) < self.MIN_TEXT_LENGTH:
            return False
        if len(text) / 4 < self.MIN_TOKEN_ESTIMATE:
            return False
        return self._analyze_compressibility(text) > self.COMPRESSION_THRESHOLD

    def get_compression_mode(self, text: str) -> Literal["lite", "full", "ultra"]:
        score = self._analyze_compressibility(text)
        if score < 0.12:
            return "lite"
        if score < 0.18:
            return "full"
        return "ultra"

    def _analyze_compressibility(self, text: str) -> float:
        filler = self._analyze_filler_words(text)
        length_score = min(len(text) / 500, 1.0)
        repetition = self._analyze_word_repetition(text)
        return filler * 0.35 + length_score * 0.35 + repetition * 0.30

    def _analyze_filler_words(self, text: str) -> float:
        words = text.lower().split()
        if not words:
            return 0.0
        count = sum(1 for w in words if w.strip(".,!?;:") in _FILLER_WORDS)
        return count / len(words)

    def _analyze_word_repetition(self, text: str) -> float:
        words = text.lower().split()
        if len(words) < 2:
            return 0.0
        freq: dict[str, int] = {}
        for w in words:
            clean = w.strip(".,!?;:")
            freq[clean] = freq.get(clean, 0) + 1
        repeated = sum(1 for c in freq.values() if c > 1)
        return repeated / len(freq) if freq else 0.0


# ---------------------------------------------------------------------------
# LITE mode — deterministic filler word removal
# ---------------------------------------------------------------------------

# Single authoritative filler word source — keeps _analyze_filler_words() in sync.
_FILLER_WORDS: frozenset[str] = frozenset({
    "very", "really", "quite", "just", "simply", "basically",
    "actually", "literally", "certainly", "definitely", "probably",
    "seems", "appears", "arguably", "somewhat", "relatively",
    "also", "furthermore", "moreover", "however", "therefore",
    "thus", "hence", "meanwhile", "ultimately", "essentially",
    "generally", "typically", "usually", "always",
    # These were in the set but missing from regex (H3 fix):
    "ensure", "make", "sure",
})

_FILLER_RE = re.compile(
    r"\b(" + "|".join(sorted(_FILLER_WORDS)) + r")\b",
    re.IGNORECASE,
)


def _lite_compress(text: str) -> tuple[str, float]:
    """Deterministic: regex filler removal. No external calls."""
    cleaned = _FILLER_RE.sub("", text)
    cleaned = re.sub(r"  +", " ", cleaned)  # double spaces
    cleaned = re.sub(r"\. +", ". ", cleaned)
    cleaned = re.sub(r"^\s+|\s+$", "", cleaned, flags=re.M)
    savings = max(0.0, (1 - len(cleaned) / max(len(text), 1)) * 100)
    return cleaned, savings


# ---------------------------------------------------------------------------
# Ollama prompts
# ---------------------------------------------------------------------------

_FULL_PROMPT = (
    "Rewrite the following text concisely. Preserve ALL technical terms, "
    "file names, error messages, and decisions. Remove filler words, verbose "
    "explanations, and redundant phrases. Output ONLY the rewritten text:\n\n{text}"
)

_ULTRA_PROMPT = (
    "Convert the following text to a concise bullet-point list. "
    "Keep only actionable items and key decisions. "
    "Remove all explanations and context. Output ONLY the bullet list:\n\n{text}"
)


# ---------------------------------------------------------------------------
# Compressor
# ---------------------------------------------------------------------------


class CavemanCompressor:

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.detector = CavemanDetector()

    async def compress(
        self,
        text: str,
        mode: Literal["lite", "full", "ultra"] | None = None,
    ) -> tuple[str, float]:
        """
        Compress prose text.
        Returns: (compressed, savings_percent)
        """
        if not self.detector.should_compress(text):
            return text, 0.0

        if mode is None:
            mode = self.detector.get_compression_mode(text)

        # Phase 4.3 Fix: Prevent GPU VRAM Exhaustion
        # If the text is massive (>12000 chars / ~3k tokens), Ollama will likely
        # timeout during prompt ingestion, creating a zombie session that drains VRAM.
        if len(text) > 12000 and mode != "lite":
            mode = "lite"

        if mode == "lite":
            return _lite_compress(text)

        # C1 fix: use str.replace instead of .format() to avoid KeyError when
        # user text contains literal curly braces like "{variable_name}".
        template = _FULL_PROMPT if mode == "full" else _ULTRA_PROMPT
        prompt = template.replace("{text}", text)

        try:
            async with httpx.AsyncClient(timeout=self.settings.ollama_timeout) as client:
                r = await client.post(
                    f"{self.settings.ollama_url}/api/generate",
                    json={
                        "model": self.settings.ollama_prose_model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 1024},
                    },
                )
                r.raise_for_status()
                compressed: str = r.json()["response"].strip()
                savings = max(0.0, (1 - len(compressed) / max(len(text), 1)) * 100)
                return compressed, savings

        except (httpx.ConnectError, httpx.TimeoutException):
            # Ollama erişilemez → LITE'a düş
            return _lite_compress(text)
        except Exception:
            return text, 0.0
