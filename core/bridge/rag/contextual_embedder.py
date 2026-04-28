"""
Contextual Embedder â€” RAG 2.0 Enhancement.

Augments code chunks with contextual summaries (file-level + class-level)
before embedding to preserve semantic meaning in isolated snippets.
Inspired by Anthropic's "Contextual Retrieval".
"""
from __future__ import annotations

import logging

import httpx

from config import Settings

logger = logging.getLogger(__name__)

class ContextualEmbedder:

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def contextualize_chunks(self, content: str, chunks: list[str], path: str) -> list[str]:
        """
        Generate a global context for the file and prepend it to each chunk.
        """
        if not chunks:
            return []

        file_summary = await self._generate_file_summary(content, path)

        contextualized = []
        for chunk in chunks:
            # Prepend context: [File Path] [File/Module Purpose] [Chunk Content]
            contextualized.append(f"[File: {path}]\n[Context: {file_summary}]\n\n{chunk}")

        return contextualized

    async def _generate_file_summary(self, content: str, path: str) -> str:
        """
        Generates a concise 1-sentence summary of the file's purpose.
        """
        # Limit content for summary generation to avoid token overflow
        preview = content[0:8000]

        prompt = (
            f"Provide a concise 1-sentence summary of the following file's purpose: {path}\n\n"
            f"File content:\n{preview}\n\n"
            "Summary (1 sentence):"
        )

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    f"{self.settings.ollama_url}/api/generate",
                    json={
                        "model": self.settings.ollama_fast_model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 128},
                    },
                )
                r.raise_for_status()
                return str(r.json()["response"].strip())
        except Exception as exc:
            logger.warning(f"Contextual summary generation failed for {path}: {exc}")
            return "General code module."

