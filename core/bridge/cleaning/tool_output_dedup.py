import hashlib
import json
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

class ToolOutputDeduplicator:
    """
    Prevents duplicate tool outputs from bloating the LLM context.
    Uses SHA-256 fingerprinting of tool call arguments and results.
    """
    def __init__(self) -> None:
        self.seen_fingerprints: set[str] = set()

    def process(self, tool_name: str, arguments: dict[str, Any], output: str) -> tuple[str, bool]:
        """
        Check if this tool output is already present in the current session context.
        Returns: (output, is_duplicate)
        """
        # Create a stable fingerprint
        stable_args = json.dumps(arguments, sort_keys=True)
        fingerprint = hashlib.sha256(f"{tool_name}:{stable_args}:{output}".encode()).hexdigest()

        if fingerprint in self.seen_fingerprints:
            logger.info("tool_output_deduped", tool_name=tool_name)
            return f"[Duplicate output from {tool_name} omitted]", True

        self.seen_fingerprints.add(fingerprint)
        return output, False

    def clear(self) -> None:
        self.seen_fingerprints.clear()
