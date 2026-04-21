"""
Circuit Breaker + Model Cascade.

Her model için bağımsız devre:
  CLOSED    → normal çalışma
  OPEN      → bypass (reset_timeout sonrası HALF_OPEN'a geçer)
  HALF_OPEN → bir deneme yap, başarılı → CLOSED, başarısız → OPEN

Kaskad: Ollama → OpenRouter → pass-through (Claude Code'un kendi bağlantısı)
"""
from __future__ import annotations

import asyncio
import time
import structlog
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any

from config import Settings
from models.ollama import OllamaClient
from models.openrouter import OpenRouterClient, RateLimitError

logger = structlog.get_logger(__name__)


class BreakerState(Enum):
    CLOSED = auto()
    OPEN = auto()
    HALF_OPEN = auto()


@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = 3
    reset_timeout: float = 60.0  # seconds

    _failures: int = field(default=0, init=False, repr=False)
    _state: BreakerState = field(default=BreakerState.CLOSED, init=False, repr=False)
    _opened_at: float = field(default=0.0, init=False, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False, repr=False)

    async def is_open(self) -> bool:
        async with self._lock:
            if self._state == BreakerState.OPEN:
                if time.time() - self._opened_at >= self.reset_timeout:
                    logger.info("breaker_half_open", name=self.name)
                    self._state = BreakerState.HALF_OPEN
                    return False
                return True
            else:
                return False
        return False  # Redundant final return to satisfy Pyre

    async def record_success(self) -> None:
        async with self._lock:
            if self._state != BreakerState.CLOSED:
                logger.info("breaker_closed", name=self.name)
            self._failures = 0
            self._state = BreakerState.CLOSED

    async def record_failure(self) -> None:
        async with self._lock:
            self._failures += 1
            if self._failures >= self.failure_threshold:
                logger.warning("breaker_opened", name=self.name, failures=self._failures)
                self._state = BreakerState.OPEN
                self._opened_at = time.time()

    @property
    def state_name(self) -> str:
        # Use str() to satisfy Pyre that we are calling lower() on a string
        return str(self._state.name).lower()


class ModelCascade:
    """
    Tries models in order: Ollama → OpenRouter → pass-through.

    pass-through: returns empty string.
    Caller (orchestrator) interprets "" as "optimization only, Claude Code handles inference".
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.ollama = OllamaClient(settings)
        self.openrouter = OpenRouterClient(settings)
        self.manual_override: str | None = None

        self.breakers: dict[str, CircuitBreaker] = {
            "ollama": CircuitBreaker("ollama", failure_threshold=3, reset_timeout=60.0),
            "openrouter": CircuitBreaker("openrouter", failure_threshold=5, reset_timeout=120.0),
        }

    async def call(self, prompt: str, model_hint: str) -> str:
        """
        Route to the appropriate model.
        Returns response string, or "" for pass-through.

        H8 fix: when manual_override is set, only try that provider.
        Failures do NOT cascade to other providers — the override is explicit.
        """
        # H8 fix: manual_override pins the provider; no fallthrough on failure.
        if self.manual_override:
            target: str = str(self.manual_override)
            if "openrouter" in target:
                if not await self.breakers["openrouter"].is_open():
                    model_name = _extract_model_name(target, "openrouter")
                    try:
                        result = await self.openrouter.complete(prompt, model=model_name or None)
                        await self.breakers["openrouter"].record_success()
                        return result
                    except Exception as exc:
                        logger.error("openrouter_override_failed", error=str(exc))
                        await self.breakers["openrouter"].record_failure()
                return ""
            if "ollama" in target:
                if not await self.breakers["ollama"].is_open():
                    model_name = _extract_model_name(target, "ollama")
                    try:
                        result = await self.ollama.complete(prompt, model=model_name)
                        await self.breakers["ollama"].record_success()
                        return result
                    except Exception as exc:
                        logger.error("ollama_override_failed", error=str(exc))
                        await self.breakers["ollama"].record_failure()
                return ""
            return ""

        target_hint: str = str(model_hint)

        # --- Ollama ---
        if "ollama" in target_hint and not await self.breakers["ollama"].is_open():
            try:
                model_name = _extract_model_name(target_hint, "ollama")
                result = await self.ollama.complete(prompt, model=model_name)
                await self.breakers["ollama"].record_success()
                return result
            except Exception as exc:
                logger.error("ollama_cascade_failed", error=str(exc))
                await self.breakers["ollama"].record_failure()

        # --- OpenRouter ---
        if self.openrouter.is_configured() and not await self.breakers["openrouter"].is_open():
            try:
                model_name = _extract_model_name(target_hint, "openrouter")
                result = await self.openrouter.complete(prompt, model=model_name or None)
                await self.breakers["openrouter"].record_success()
                return result
            except RateLimitError as exc:
                # Rate limited: wait and retry once
                logger.warning("openrouter_rate_limit", retry_after=exc.retry_after)
                await asyncio.sleep(min(exc.retry_after, 30))
                try:
                    result = await self.openrouter.complete(prompt)
                    await self.breakers["openrouter"].record_success()
                    return result
                except Exception as exc2:
                    logger.error("openrouter_retry_failed", error=str(exc2))
                    await self.breakers["openrouter"].record_failure()
            except Exception as exc:
                logger.error("openrouter_cascade_failed", error=str(exc))
                await self.breakers["openrouter"].record_failure()

        # --- Pass-through ---
        return ""

    def status(self) -> dict[str, Any]:
        return {
            name: {
                "state": b.state_name,
                "failures": b._failures,
            }
            for name, b in self.breakers.items()
        }


def _extract_model_name(hint: str, provider: str) -> str:
    """
    Extract model name from hints like "ollama:qwen2.5-7b-q4"
    or "openrouter:llama-3.1-70b-free".
    """
    if ":" in hint:
        parts = hint.split(":", 1)
        if parts[0].lower() == provider:
            return parts[1]
    return ""
