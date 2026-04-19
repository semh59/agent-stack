"""
Centralized configuration — Pydantic Settings.
All values are overridable via environment variables prefixed with AI_STACK_.
"""
from __future__ import annotations

from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_STACK_",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Paths ----
    data_dir: Path = Field(default_factory=lambda: Path.home() / ".ai-stack-mcp")
    cache_db: Path | None = None
    mab_db: Path | None = None
    costs_db: Path | None = None

    # ---- Ollama ----
    ollama_url: str = "http://localhost:11434"
    ollama_fast_model: str = "gemma4:e2b"
    ollama_prose_model: str = "gemma4:e2b"
    ollama_embed_model: str = "nomic-embed-text"
    ollama_timeout: float = 120.0

    # ---- OpenRouter ----
    openrouter_api_key: str = ""
    openrouter_free_model: str = "meta-llama/llama-3.1-70b-instruct:free"

    # ---- Semantic Cache ----
    semantic_cache_similarity_threshold: float = 0.85
    semantic_cache_ttl_simple: int = 604_800    # 7 gün
    semantic_cache_ttl_contextual: int = 86_400  # 1 gün
    exact_cache_max_size: int = 500
    exact_cache_default_ttl: int = 86_400

    # ---- Compression ----
    llmlingua_min_tokens: int = 100
    llmlingua_rate_general: float = 0.60
    llmlingua_rate_technical: float = 0.40
    llmlingua_rate_critical: float = 0.20

    # ---- MAB ----
    mab_epsilon: float = 0.10
    mab_reward_threshold: float = 0.20  # savings fraction

    # ---- Logging ----
    log_level: str = "INFO"

    # ---- Observability ----
    # Base port for the Prometheus metrics exporter.
    # server.py (stdio MCP) uses this port; bridge.py binds to metrics_port + 1
    # so they can run side-by-side locally without conflict.
    metrics_port: int = 9090

    # ---- Bridge auth ----
    # Shared secret between the gateway and the HTTP bridge. In production-like
    # environments (APP_ENV=production|staging) this MUST be set; dev falls back
    # to an ephemeral token. See bridge.py for the startup contract.
    bridge_secret: str = ""

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


# Singleton — projenin her yerinde `from config import settings` ile kullanılır
settings = Settings()
