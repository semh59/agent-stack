"""
AlloyProviderRouter â€” LiteLLM Router tabanlÄ± multi-provider yÃ¶nlendirme.

Tier sistemi (config.py'deki tÃ¼m key'ler kullanÄ±lÄ±r):
  Tier 0: Ollama          â€” lokal, $0
  Tier 1: Groq / Cerebras / SambaNova  â€” free, yÃ¼ksek TPS
  Tier 2: Gemini Flash / Mistral       â€” generous free tier
  Tier 3: OpenRouter                   â€” 30+ free model
  Tier 4: DeepSeek                     â€” ucuz, rate limit yok
  Tier 5: Claude Haiku                 â€” Ã¼cretli, son Ã§are
"""
from __future__ import annotations

import os
import time
from typing import Any

import litellm
import structlog

from config import Settings

logger = structlog.get_logger(__name__)

# LiteLLM verbose/debug Ã§Ä±ktÄ±sÄ±nÄ± kapat (tÃ¼m sÃ¼rÃ¼mlerde Ã§alÄ±ÅŸÄ±r)
os.environ.setdefault("LITELLM_LOG", "ERROR")
litellm.set_verbose = False


def _build_model_list(settings: Settings) -> list[dict[str, Any]]:
    """Config key'lerine gÃ¶re aktif provider'larÄ± model_list'e ekle."""
    models: list[dict[str, Any]] = []

    # Tier 0 â€” Ollama (her zaman eklenir, key gerekmez)
    models.append({
        "model_name": "tier0-fast",
        "litellm_params": {
            "model": f"ollama/{settings.ollama_fast_model}",
            "api_base": settings.ollama_url,
        },
        "model_info": {"tier": "free", "alloy_tier": 0, "intent": ["fast", "cheap"]},
    })
    models.append({
        "model_name": "tier0-prose",
        "litellm_params": {
            "model": f"ollama/{settings.ollama_prose_model}",
            "api_base": settings.ollama_url,
        },
        "model_info": {"tier": 0, "intent": ["reasoning", "coding"]},
    })

    # Tier 1 â€” Groq
    if settings.groq_api_key:
        models.append({
            "model_name": "tier1-groq",
            "litellm_params": {
                "model": "groq/llama-3.1-70b-versatile",
                "api_key": settings.groq_api_key,
                "rpm": 30,
                "tpm": 6000,
            },
            "model_info": {"tier": "free", "alloy_tier": 1, "intent": ["reasoning", "coding", "fast"]},
        })

    # Tier 1 â€” Cerebras
    if settings.cerebras_api_key:
        models.append({
            "model_name": "tier1-cerebras",
            "litellm_params": {
                "model": "cerebras/llama3.1-70b",
                "api_key": settings.cerebras_api_key,
                "tpm": 1_000_000,
            },
            "model_info": {"tier": "free", "alloy_tier": 1, "intent": ["fast", "coding"]},
        })

    # Tier 1 â€” SambaNova
    if settings.sambanova_api_key:
        models.append({
            "model_name": "tier1-sambanova",
            "litellm_params": {
                "model": "sambanova/Meta-Llama-3.1-70B-Instruct",
                "api_key": settings.sambanova_api_key,
            },
            "model_info": {"tier": "free", "alloy_tier": 1, "intent": ["reasoning", "fast"]},
        })

    # Tier 2 â€” Gemini Flash
    if settings.google_api_key:
        models.append({
            "model_name": "tier2-gemini-flash",
            "litellm_params": {
                "model": "gemini/gemini-1.5-flash",
                "api_key": settings.google_api_key,
                "rpm": 1500,
            },
            "model_info": {"tier": "free", "alloy_tier": 2, "intent": ["reasoning", "fast", "coding"]},
        })

    # Tier 2 â€” Mistral (Codestral kod iÃ§in)
    if settings.mistral_api_key:
        models.append({
            "model_name": "tier2-mistral",
            "litellm_params": {
                "model": "mistral/codestral-latest",
                "api_key": settings.mistral_api_key,
            },
            "model_info": {"tier": "free", "alloy_tier": 2, "intent": ["coding"]},
        })

    # Tier 3 â€” OpenRouter
    if settings.openrouter_api_key:
        models.append({
            "model_name": "tier3-openrouter",
            "litellm_params": {
                "model": f"openrouter/{settings.openrouter_free_model}",
                "api_key": settings.openrouter_api_key,
                "api_base": "https://openrouter.ai/api/v1",
            },
            "model_info": {"tier": "free", "alloy_tier": 3, "intent": ["reasoning", "cheap"]},
        })

    # Tier 4 â€” DeepSeek
    if settings.deepseek_api_key:
        models.append({
            "model_name": "tier4-deepseek",
            "litellm_params": {
                "model": "deepseek/deepseek-chat",
                "api_key": settings.deepseek_api_key,
            },
            "model_info": {"tier": "paid", "alloy_tier": 4, "intent": ["reasoning", "coding", "cheap"]},
        })

    # Tier 4 â€” Together
    if settings.together_api_key:
        models.append({
            "model_name": "tier4-together",
            "litellm_params": {
                "model": "together_ai/meta-llama/Llama-3-70b-chat-hf",
                "api_key": settings.together_api_key,
            },
            "model_info": {"tier": "paid", "alloy_tier": 4, "intent": ["reasoning"]},
        })

    # Tier 5 â€” Claude Haiku (son Ã§are, Ã¼cretli)
    if settings.anthropic_api_key:
        models.append({
            "model_name": "tier5-claude",
            "litellm_params": {
                "model": "claude-haiku-4-5-20251001",
                "api_key": settings.anthropic_api_key,
            },
            "model_info": {"tier": "paid", "alloy_tier": 5, "intent": ["reasoning", "coding"]},
        })

    return models


# Intent â†’ tercih edilen tier listesi (dÃ¼ÅŸÃ¼kten yÃ¼kseÄŸe)
_INTENT_TIER_ORDER: dict[str, list[str]] = {
    "fast":      ["tier0-fast", "tier1-cerebras", "tier1-groq", "tier2-gemini-flash", "tier3-openrouter"],
    "coding":    ["tier0-prose", "tier2-mistral", "tier1-groq", "tier1-cerebras", "tier4-deepseek", "tier5-claude"],
    "reasoning": ["tier0-prose", "tier1-groq", "tier2-gemini-flash", "tier3-openrouter", "tier4-deepseek", "tier5-claude"],
    "cheap":     ["tier0-fast", "tier1-cerebras", "tier3-openrouter", "tier4-deepseek"],
}


class AlloyProviderRouter:
    """
    LiteLLM Router tabanlÄ± provider yÃ¶nlendirme.
    - Tier sistemi: Ollama â†’ free cloud â†’ cheap cloud â†’ paid
    - Otomatik rate limit tracking, cooldown, cascade fallback
    - Her provider key varlÄ±ÄŸÄ±na gÃ¶re dinamik model_list
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._router: litellm.Router | None = None
        self._model_list: list[dict[str, Any]] = []
        self._last_discovery = 0.0
        self._discovery_interval = 3600.0
        self._build_router()

    def _build_router(self) -> None:
        self._model_list = _build_model_list(self.settings)
        # _model_list hiÃ§ boÅŸ olmaz: tier0 (Ollama) key gerektirmez, her zaman eklenir.
        # Sadece cloud key sayÄ±sÄ±nÄ± logluyoruz.
        cloud_count = sum(1 for m in self._model_list if m["model_info"]["alloy_tier"] > 0)
        logger.info("provider_router_model_list", total=len(self._model_list), cloud=cloud_count)

        try:
            self._router = litellm.Router(
                model_list=self._model_list,
                routing_strategy=self.settings.router_strategy,
                num_retries=self.settings.router_num_retries,
                timeout=self.settings.router_timeout,
                retry_after=5,
                allowed_fails=2,
                cooldown_time=60,
                set_verbose=False,
            )
            logger.info(
                "provider_router_built",
                model_count=len(self._model_list),
                models=[m["model_name"] for m in self._model_list],
            )
        except Exception as exc:
            logger.error("provider_router_build_failed", error=str(exc))
            self._router = None

    def select_optimal_model(self, intent: str) -> str:
        """
        Intent'e gÃ¶re en uygun model adÄ±nÄ± dÃ¶ner.
        Router'da kayÄ±tlÄ± modeller arasÄ±ndan tier sÄ±rasÄ±yla seÃ§er.
        """
        tier_order = _INTENT_TIER_ORDER.get(intent, _INTENT_TIER_ORDER["reasoning"])
        registered = {m["model_name"] for m in self._model_list}
        for candidate in tier_order:
            if candidate in registered:
                return candidate
        # Fallback â€” her zaman tier0 var
        return self._model_list[0]["model_name"] if self._model_list else "ollama/qwen2.5-7b"

    async def route_call(
        self,
        model: str,
        messages: list[dict[str, str]],
        **kwargs: Any,
    ) -> Any:
        """
        LiteLLM Router Ã¼zerinden LLM Ã§aÄŸrÄ±sÄ± yapar.
        Router: rate limit tracking, cooldown, cascade fallback saÄŸlar.
        """
        router = self._router
        if router is None:
            logger.error("provider_router_not_initialized")
            raise RuntimeError("AlloyProviderRouter: Router baÅŸlatÄ±lamadÄ±")

        try:
            response = await router.acompletion(
                model=model,
                messages=messages,
                **kwargs,
            )
            return response
        except Exception as exc:
            logger.error("route_call_failed", model=model, error=str(exc))
            raise

    def _get_api_key(self, model: str) -> str:
        """Model adÄ±na gÃ¶re API key dÃ¶ner. Router'dan baÄŸÄ±msÄ±z doÄŸrudan Ã§aÄŸrÄ±lar iÃ§in."""
        m = model.lower()
        if "claude" in m or "anthropic" in m:
            return self.settings.anthropic_api_key
        if "gpt" in m or "openai" in m:
            return self.settings.openai_api_key
        if "gemini" in m or "google" in m:
            return self.settings.google_api_key
        if "groq" in m:
            return self.settings.groq_api_key
        if "cerebras" in m:
            return self.settings.cerebras_api_key
        if "sambanova" in m:
            return self.settings.sambanova_api_key
        if "mistral" in m or "codestral" in m:
            return self.settings.mistral_api_key
        if "deepseek" in m:
            return self.settings.deepseek_api_key
        if "together" in m:
            return self.settings.together_api_key
        if "fireworks" in m:
            return self.settings.fireworks_api_key
        if "openrouter" in m:
            return self.settings.openrouter_api_key
        if "cohere" in m:
            return self.settings.cohere_api_key
        return ""

    async def discover_models(self) -> None:
        """Router'Ä± periyodik olarak yeniden inÅŸa et (yeni key'ler .env'den okunabilir)."""
        now = time.time()
        if now - self._last_discovery < self._discovery_interval:
            return
        self._last_discovery = now
        logger.info("provider_router_rediscovery")
        self._build_router()
