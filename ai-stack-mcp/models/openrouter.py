"""
OpenRouter cloud fallback client.

Free tier models (as of 2026):
  meta-llama/llama-3.1-70b-instruct:free
  meta-llama/llama-3.1-8b-instruct:free
  mistral/mistral-7b-instruct:free
  google/gemma-2-9b-it:free

Rate limits on free tier: ~10-20 req/min.
429 responses include a Retry-After header.
"""
from __future__ import annotations

import httpx

from config import Settings


FREE_MODELS = [
    "meta-llama/llama-3.1-70b-instruct:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "mistral/mistral-7b-instruct:free",
    "google/gemma-2-9b-it:free",
]


class OpenRouterClient:

    BASE_URL = "https://openrouter.ai/api/v1"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.openrouter_api_key}",
            "HTTP-Referer": "https://github.com/ai-stack-mcp",
            "X-Title": "ai-stack-mcp",
        }

    async def complete(self, prompt: str, model: str | None = None) -> str:
        if not self.settings.openrouter_api_key:
            raise ValueError("OPENROUTER_API_KEY not configured")

        model = model or self.settings.openrouter_free_model

        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.post(
                f"{self.BASE_URL}/chat/completions",
                headers=self._headers(),
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2048,
                    "temperature": 0.1,
                },
            )

            if r.status_code == 429:
                retry_after = int(r.headers.get("retry-after", "60"))
                raise RateLimitError(f"Rate limit — retry after {retry_after}s", retry_after)

            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    def is_configured(self) -> bool:
        return bool(self.settings.openrouter_api_key)


class RateLimitError(Exception):
    def __init__(self, message: str, retry_after: int = 60) -> None:
        super().__init__(message)
        self.retry_after = retry_after
