import re
import structlog  # type: ignore
from typing import Any

logger = structlog.get_logger(__name__)

class SyntacticSurprisePruner:
    """
    Elite 2026-SOTA Perplexity-Aware Pruner.
    Uses 'Syntactic Surprise' heuristics to identify tokens that carry
    low structural entropy (e.g., standard imports, getters/setters, boilerplate).
    """
    def __init__(self, settings: Any) -> None:
        self.settings = settings
        self.boilerplate_patterns = [
            re.compile(r"^import\s+.*$"),
            re.compile(r"^from\s+.*\s+import\s+.*$"),
            re.compile(r"^\s*self\..*\s*=\s*.*$"),
            re.compile(r"^.*logger\..*\(.*\)$"),
        ]

    def prune(self, text: str, intensity: float | None = None) -> tuple[str, float]:
        if not text:
            return "", 0.0

        original_len = len(text)
        lines = text.splitlines()
        pruned_lines = []

        # High-Surprise Indicators (Entropy Boosters)
        critical_markers = {"FIXME", "TODO", "CRITICAL", "BUG:", "HACK:", "NOTE:"}

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # 1. Structural entropy check
            entropy_score = self._calculate_surprise(stripped)

            # 2. Preserve high-surprise or structural markers
            is_surprising = (
                entropy_score > 0.6 or
                stripped.startswith(("#", "```", "def ", "class ")) or
                any(marker in stripped for marker in critical_markers)
            )

            if is_surprising:
                pruned_lines.append(line)
            else:
                # Aggregate/Summarize low-surprise lines (e.g. imports)
                # Elite logic: Keep first and last, summarize the rest
                if len(pruned_lines) > 0 and "import" in stripped:
                    if not pruned_lines[-1].startswith("[... redundant"):
                        pruned_lines.append(f"  [... redundant structural boilerplate pruned ...]")
                else:
                    # Very aggressive pruning for low-surprise prose
                    pass

        pruned_text = "\n".join(pruned_lines)
        savings = max(0.0, (1 - len(pruned_text) / max(original_len, 1)) * 100)

        logger.info("syntactic_surprise_pruning", savings=f"{savings:.1f}%")
        return pruned_text, savings

    def _calculate_surprise(self, text: str) -> float:
        """
        Heuristic for token perplexity.
        Lower score = Higher predictability = Prunable.
        """
        # Match against boilerplate patterns
        if any(p.match(text) for p in self.boilerplate_patterns):
            return 0.2

        # Logic density: operators per token
        tokens = text.split()
        if not tokens:
            return 0.0

        operators = sum(1 for t in tokens if any(c in t for c in "=+-*/<>!&|"))
        logic_density = operators / len(tokens)

        # Surprise is higher if there is high logic density or unusual chars
        return min(1.0, logic_density * 2.0 + (len(set(text)) / 64.0))
