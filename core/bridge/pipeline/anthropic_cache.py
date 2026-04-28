from __future__ import annotations
import structlog  # type: ignore
from typing import Any, cast
from config import Settings  # type: ignore

logger = structlog.get_logger(__name__)

class AnthropicPromptCache:
    """
    Hyper-Optimized Anthropic Prompt Caching (2026 Edition).

    Strategically selects up to 4 cache breakpoints using a prioritized
    importance heuristic to maximize cache hit rates for multi-turn sessions.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.max_breakpoints = 4

    def apply(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Injects 'cache_control' into the top 4 most important blocks.
        Priority: System > Large Docs > Recent State.
        """
        if not messages:
            return messages

        # Explicitly type to satisfy strict analyzers
        candidates: list[tuple[int, int]] = []

        # 1. System Prompt (Highest Priority)
        first_msg = messages[0]
        if first_msg.get("role") == "system":
            candidates.append((0, 100)) # (index, priority_score)

        # 2. Identify "Heavy" messages (likely containing context/docs)
        # Use a list to avoid slicing ambiguity in some analyzers if needed
        # but messages[1:] is standard Python. Avoiding slicing via range(1, len(messages))
        for i in range(1, len(messages)):
            msg = messages[i]
            content = msg.get("content", "")
            text_len = len(content) if isinstance(content, str) else 0

            # If message > 1000 chars, it's a context block
            if text_len > 1000:
                candidates.append((i, 50 + min(text_len // 100, 40)))

        # 3. Recent context (Rolling window for chat speed)
        if len(messages) > 1:
            candidates.append((len(messages) - 1, 30))

        # Sort by priority score and take top 4
        candidates.sort(key=lambda x: x[1], reverse=True)

        # Cast to avoid "SupportsIndex" false positives
        limit = self.max_breakpoints
        subset = candidates[0:limit]
        top_indices = [int(item[0]) for item in subset]

        logger.debug("anthropic_cache_plan", top_indices=top_indices)

        for idx in top_indices:
            # Type guard for dict
            target = messages[idx]
            if isinstance(target, dict):
                target["content"] = self._inject_cache_control(target["content"])

        return messages

    def _inject_cache_control(self, content: Any) -> Any:
        # Prevent double injection
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and "cache_control" in block:
                    return content

        if isinstance(content, str):
            return [
                {
                    "type": "text",
                    "text": content,
                    "cache_control": {"type": "ephemeral"}
                }
            ]
        elif isinstance(content, list):
            # Find the last text block and add cache_control
            for i in range(len(content) - 1, -1, -1):
                block = content[i]
                if isinstance(block, dict) and block.get("type") == "text":
                    block["cache_control"] = {"type": "ephemeral"}
                    break
            return content
        return content
