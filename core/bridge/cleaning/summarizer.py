"""
Conversation Summarizer â€” sliding window context compression.

Pencere stratejisi:
  msg 1-10  (en yeni): tam metin korunur
  msg 11-20:           Ollama Ã¶zeti (kararlar + sonuÃ§lar)
  msg 21-30:           meta Ã¶zet (dosyalar, ne Ã¼zerinde Ã§alÄ±ÅŸÄ±ldÄ±)
  msg 30+:             sadece PRESERVE pattern'leri tut, diÄŸerlerini at

PRESERVE edilen iÃ§erik (asla Ã¶zetlenmeyen):
  - Hata mesajlarÄ± / stack trace'ler
  - "bunu yapma" tÃ¼rÃ¼ kararlar
  - Dosya isimleri (.py, .ts vb.)
  - TODO/FIXME/NOTE etiketleri
  - Teknik terimler (bÃ¼yÃ¼k harf bloklarÄ±)
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import httpx

from config import Settings

logger = logging.getLogger(__name__)

# Maximum input length in characters â€” prevents OOM / timeout on huge inputs.
MAX_INPUT_CHARS = 50_000


@dataclass
class Message:
    id: int
    role: str    # "user" | "assistant"
    content: str


# Patterns that must survive summarization verbatim
# M3 fix: added Turkish error words, Python exception prefix variants, and file extensions
_PRESERVE_PATTERNS = [
    re.compile(r"(Error:|Exception:|FAILED|Traceback|AssertionError|ValueError:|TypeError:|KeyError:)", re.I),
    re.compile(r"\b(Hata|BaÅŸarÄ±sÄ±z|UyarÄ±|hata|uyarÄ±)\b"),              # Turkish error terms
    re.compile(r"\b(yapma|kullanma|silme|don[' ]?t|avoid|never|bunu)\b", re.I),
    re.compile(r"\b\w+\.(py|ts|js|go|rs|json|yaml|yml|toml|md|cpp|c|h|rb|java)\b"),
    re.compile(r"(TODO:|FIXME:|NOTE:|HACK:|BUG:|XXX:)"),
    re.compile(r"\b[A-Z]{3,}\b"),   # Acronyms / constants
]


def _must_preserve(content: str) -> bool:
    return any(p.search(content) for p in _PRESERVE_PATTERNS)


class ConversationSummarizer:

    ACTIVE_WINDOW = 10
    SUMMARY_WINDOW = 20
    META_WINDOW = 30

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def compress_history(self, messages: list[Message]) -> list[Message]:
        """
        Compress conversation history using sliding window.
        Short histories (<= ACTIVE_WINDOW) are returned unchanged.
        """
        n = len(messages)
        if n <= self.ACTIVE_WINDOW:
            return messages

        result: list[Message] = []
        for i, msg in enumerate(messages):
            age = n - i  # 1 = most recent

            if age <= self.ACTIVE_WINDOW:
                result.append(msg)

            elif age <= self.SUMMARY_WINDOW:
                if _must_preserve(msg.content):
                    result.append(msg)
                else:
                    summarized = await self._ollama_summarize(msg)
                    result.append(summarized)

            elif age <= self.META_WINDOW:
                if _must_preserve(msg.content):
                    result.append(msg)
                else:
                    meta = await self._meta_summarize(msg)
                    result.append(meta)

            else:
                # 30+: keep only critical messages
                if _must_preserve(msg.content):
                    result.append(msg)
                # others are dropped

        return result

    # ------------------------------------------------------------------
    # Ollama calls
    # ------------------------------------------------------------------

    async def _ollama_summarize(self, msg: Message) -> Message:
        content = msg.content
        if len(content) > MAX_INPUT_CHARS:
            logger.warning(
                "summarizer_input_truncated",
                original_len=len(content),
                max_chars=MAX_INPUT_CHARS,
            )
            content = content[:MAX_INPUT_CHARS] + "\n[...truncated...]"
        prompt = (
            "Summarize this message in 1-2 sentences. "
            "MUST PRESERVE: error messages, file names (.py/.ts/.js), "
            "technical decisions, 'don't do X' rules, exact variable/function names. "
            "REMOVE: explanations, examples, verbose phrasing.\n\n"
            f"{content}"
        )
        summary = await self._call_ollama(prompt, msg.content)
        return Message(id=msg.id, role=msg.role, content=f"[summary] {summary}")

    async def _meta_summarize(self, msg: Message) -> Message:
        content = msg.content
        if len(content) > MAX_INPUT_CHARS:
            content = content[:MAX_INPUT_CHARS] + "\n[...truncated...]"
        prompt = (
            "Extract ONLY: file names mentioned, decisions made, errors that occurred. "
            "One line max. If nothing important, output 'no key info'.\n\n"
            f"{content}"
        )
        meta = await self._call_ollama(prompt, msg.content)
        return Message(id=msg.id, role=msg.role, content=f"[meta] {meta}")

    async def _call_ollama(self, prompt: str, fallback_content: str) -> str:
        # Safety net: truncate overly long prompts before sending to Ollama
        if len(prompt) > MAX_INPUT_CHARS:
            prompt = prompt[:MAX_INPUT_CHARS] + "\n[...truncated...]"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    f"{self.settings.ollama_url}/api/generate",
                    json={
                        "model": self.settings.ollama_fast_model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 256},
                    },
                )
                r.raise_for_status()
                return r.json()["response"].strip()
        except Exception:
            # Ollama unavailable â€” crude truncation
            return fallback_content[:200] + ("..." if len(fallback_content) > 200 else "")
