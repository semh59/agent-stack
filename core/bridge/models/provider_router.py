from __future__ import annotations
import os
import time
from typing import Any, Dict, List, Optional
from litellm import Router
from litellm.router import RetryPolicy
from core.bridge.config import Settings
import structlog

logger = structlog.get_logger(__name__)

class AlloyProviderRouter:
    """
    Hyper-Optimized Provider Router for Alloy Platform (2026 Edition).
    
    Features:
    - Multi-Objective Pareto-Optimal Routing: Balances [Cost, Latency, Accuracy].
    - Intent-Aware Capability Scoring: Different ratings for [Coding, Reasoning, Creative, Fast].
    - LiteLLM Core: Multi-tier fallback and standardized OpenAI output.
    """
    
    # Model Capability Profiles (Normalized 0.0 - 1.0)
    # [Coding, Reasoning, Latency_Advantage, Cost_Advantage]
    CAPABILITIES = {
        "claude-3-5-sonnet": [0.95, 0.90, 0.40, 0.30],
        "gpt-4o":            [0.90, 0.92, 0.50, 0.40],
        "gemini-1.5-pro":    [0.85, 0.88, 0.30, 0.60],
        "llama-3-70b":       [0.80, 0.75, 0.60, 0.90],
        "local-fast":        [0.40, 0.30, 0.95, 1.00],
    }

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.router = Router(
            model_list=self._build_model_list(),
            routing_strategy="usage-based-routing-v2", # Base strategy
            num_retries=settings.router_num_retries,
            timeout=settings.router_timeout,
            retry_policy=RetryPolicy(
                ContentFilterPolicy=True,
                RateLimitErrorRetries=3,
                TimeoutErrorRetries=2,
            )
        )
        logger.info("provider_router_hyper_optimized", strategy="pareto-multi-objective")

    def _build_model_list(self) -> list[dict[str, Any]]:
        model_list = []
        
        # Mapping available capabilities to LiteLLM params
        providers = [
            ("claude-3-5-sonnet", self.settings.anthropic_api_key, "anthropic/claude-3-5-sonnet-20240620"),
            ("gpt-4o", self.settings.openai_api_key, "openai/gpt-4o"),
            ("gemini-1.5-pro", self.settings.google_api_key, "gemini/gemini-1.5-pro-latest"),
            ("llama-3-70b", self.settings.openrouter_api_key, f"openrouter/{self.settings.openrouter_free_model}"),
        ]

        for name, key, model_id in providers:
            if key:
                model_list.append({
                    "model_name": name,
                    "litellm_params": {
                        "model": model_id,
                        "api_key": key,
                    },
                })

        if self.settings.ollama_fast_model:
            model_list.append({
                "model_name": "local-fast",
                "litellm_params": {
                    "model": f"ollama/{self.settings.ollama_fast_model}",
                    "api_base": self.settings.ollama_url,
                },
            })

        return model_list

    def select_optimal_model(self, intent: str, weight_latency: float = 0.3, weight_cost: float = 0.3) -> str:
        """
        Custom Pareto-Optimal selection algorithm.
        Score = (Capability[Type] * W_acc) + (Latency_Adv * W_lat) + (Cost_Adv * W_cost)
        """
        # Mapping intent to capability index
        # 0: Coding, 1: Reasoning, 2: Latency, 3: Cost
        idx = 1 # Default: Reasoning
        if "code" in intent or "fix" in intent:
            idx = 0
        elif "fast" in intent or "quick" in intent:
            idx = 2
            weight_latency = 0.8
        
        weight_acc = 1.0 - (weight_latency + weight_cost)
        
        best_model = "gpt-4o"
        max_score = -1.0
        
        # Only consider models that are actually in the router
        available = self.get_available_models()

        for model_name, caps in self.CAPABILITIES.items():
            if model_name not in available:
                continue
                
            score = (caps[idx] * weight_acc) + \
                    (caps[2] * weight_latency) + \
                    (caps[3] * weight_cost)
            
            if score > max_score:
                max_score = score
                best_model = model_name
                
        logger.debug("pareto_model_selected", model=best_model, intent=intent, score=round(max_score, 3))
        return best_model

    async def completion(self, model: str, messages: list[dict[str, str]], **kwargs) -> Any:
        # If 'model' looks like a capability intent (e.g. "coding"), auto-select
        target_model = model
        if model in ["coding", "reasoning", "fast", "economy"]:
            target_model = self.select_optimal_model(model)

        try:
            response = await self.router.acompletion(
                model=target_model,
                messages=messages,
                **kwargs
            )
            return response
        except Exception as e:
            logger.error("router_completion_failed", error=str(e), model=target_model)
            raise

    def get_available_models(self) -> list[str]:
        return [m["model_name"] for m in self.router.model_list]
