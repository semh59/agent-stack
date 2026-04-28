"""
Centralized configuration â€” Pydantic Settings.
All values are overridable via environment variables prefixed with ALLOY_.
"""
from __future__ import annotations

from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="ALLOY_",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Paths ----
    data_dir: Path = Field(default_factory=lambda: Path.home() / ".bridge")
    cache_db: Path | None = None
    mab_db: Path | None = None
    costs_db: Path | None = None

    # ---- Provider Keys ----
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""
    cohere_api_key: str = ""
    groq_api_key: str = ""
    cerebras_api_key: str = ""
    sambanova_api_key: str = ""
    mistral_api_key: str = ""
    deepseek_api_key: str = ""
    together_api_key: str = ""
    fireworks_api_key: str = ""

    # ---- Ollama ----
    ollama_url: str = "http://localhost:11434"
    ollama_fast_model: str = "gemma2:2b"
    ollama_prose_model: str = "gemma2:9b"
    ollama_embed_model: str = "nomic-embed-text"
    ollama_timeout: float = Field(default=120.0, gt=0)

    # ---- OpenRouter ----
    openrouter_api_key: str = ""
    openrouter_free_model: str = "meta-llama/llama-3.1-70b-instruct:free"

    # ---- Router ----
    router_strategy: str = "usage-based-routing-v2"
    router_num_retries: int = 3
    router_timeout: float = 60.0

    # ---- Semantic Cache ----
    semantic_cache_similarity_threshold: float = Field(default=0.85, ge=0.0, le=1.0)
    semantic_cache_ttl_simple: int = Field(default=604_800, gt=0)    # 7 gÃ¼n
    semantic_cache_ttl_contextual: int = Field(default=86_400, gt=0)  # 1 gÃ¼n
    exact_cache_max_size: int = Field(default=500, gt=0)
    exact_cache_default_ttl: int = Field(default=86_400, gt=0)

    # ---- Compression ----
    llmlingua_min_tokens: int = 100
    llmlingua_rate_general: float = 0.60
    llmlingua_rate_technical: float = 0.40
    llmlingua_rate_critical: float = 0.20

    # ---- MAB (Bayesian Thompson Sampling) ----
    mab_epsilon: float = 0.10
    mab_reward_threshold: float = 5.0  # adjusted for higher sensitivity
    mab_alpha: float = 1.0             # Exploration parameter

    # ---- RAG & Explorer ----
    reranker_model: str = "BAAI/bge-reranker-base"
    explorer_max_depth: int = 2

    # ---- Logging ----
    log_level: str = "INFO"

    # ---- Observability ----
    # Base port for the Prometheus metrics exporter.
    # server.py (stdio MCP) uses this port; bridge.py binds to metrics_port + 1
    # so they can run side-by-side locally without conflict.
    metrics_port: int = Field(default=9090, ge=1024, le=65535)
    bridge_secret: str = "s3cret-v1-alloy"

    # ---- Deployment hints ----
    app_env: str = "development"   # development | staging | production

    @model_validator(mode="after")
    def _resolve_paths(self) -> "Settings":
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if self.cache_db is None:
            self.cache_db = self.data_dir / "cache.db"
        if self.mab_db is None:
            self.mab_db = self.data_dir / "mab_state.db"
        if self.costs_db is None:
            self.costs_db = self.data_dir / "costs.db"
        return self


# Singleton â€” projenin her yerinde `from config import settings` ile kullanÄ±lÄ±r
settings = Settings()
