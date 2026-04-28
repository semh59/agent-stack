"""
Ollama local model client â€” async HTTP.
"""
from __future__ import annotations

import httpx

from config import Settings


class OllamaClient:

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def complete(self, prompt: str, model: str | None = None) -> str:
        model = model or self.settings.ollama_fast_model
        async with httpx.AsyncClient(timeout=self.settings.ollama_timeout) as client:
            r = await client.post(
                f"{self.settings.ollama_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 2048},
                },
            )
            r.raise_for_status()
            return r.json()["response"].strip()

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{self.settings.ollama_url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self.settings.ollama_url}/api/tags")
                r.raise_for_status()
                return [m["name"] for m in r.json().get("models", [])]
        except Exception:
            return []
