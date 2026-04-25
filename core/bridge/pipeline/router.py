"""
Message Router — mevcut ai-stack router.py portlanmış ve genişletilmiştir.

Eklemeler:
  - LOCAL_ANSWERABLE message type (Ollama yeterli)
  - complexity_score() — 0-10 puan
  - model_recommendation() — puana göre model seç
"""
from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from config import Settings

logger = logging.getLogger(__name__)


class MessageType(Enum):
    CLI_COMMAND = "cli_command"
    DATA_ANALYSIS = "data_analysis"
    PROSE_REASONING = "prose_reasoning"
    CODE_GENERATION = "code_generation"
    QUERY = "query"
    LOCAL_ANSWERABLE = "local_answerable"   # NEW: Ollama yeterli
    UNKNOWN = "unknown"


@dataclass
class Classification:
    message_type: MessageType
    confidence: float
    rationale: str
    recommended_layers: list[str]


# CLI command prefixes that always short-circuit to CLI_COMMAND
_CLI_PREFIXES = frozenset({
    "git", "docker", "npm", "yarn", "cargo", "kubectl", "aws", "gcloud",
    "python", "pip", "poetry", "gh", "psql", "pnpm", "tsc", "pytest",
})


class MessageRouter:
    """
    Classify messages into types to determine which optimization layers to apply.
    Dual strategy: semantic (TF-IDF) + heuristic (regex), with CLI hard override.
    """

    def __init__(self, settings: Settings) -> None:
        self.confidence_threshold = 0.55
        self.semantic_threshold = 0.35
        self.heuristic_threshold = 0.65

        self.centers: dict[MessageType, str] = {}
        self.vector_space: Any = None
        self.vectorizer: Any = None
        self.semantic_enabled = False

        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            self.vectorizer = TfidfVectorizer(stop_words="english")
            self.centers = {
                MessageType.CLI_COMMAND: (
                    "git status docker build npm install cargo run kubectl get aws gcloud "
                    "ls cd mkdir rm cp mv"
                ),
                MessageType.DATA_ANALYSIS: (
                    "analyze dataset process log records filter count statistics "
                    "query database table aggregate csv json"
                ),
                MessageType.PROSE_REASONING: (
                    "explain describe elaborate clarify think reason discuss why how tell "
                    "what is the difference between"
                ),
                MessageType.CODE_GENERATION: (
                    "write implement generate code function class algorithm script "
                    "refactor fix bug create build"
                ),
                MessageType.QUERY: (
                    "find search show list where which check display get lookup"
                ),
                MessageType.LOCAL_ANSWERABLE: (
                    "what is define meaning simple question basic hello who when"
                ),
            }
            texts = list(self.centers.values())
            self.vector_space = self.vectorizer.fit_transform(texts)
            self.semantic_enabled = True
        except ImportError:
            logger.warning("sklearn not found — semantic routing disabled")

    def classify(self, message: str, confidence_threshold: float | None = None) -> Classification:
        threshold = confidence_threshold or self.confidence_threshold
        normalized = message.strip()

        # Hard override: known CLI prefix
        first_token = normalized.split()[0].lower() if normalized.split() else ""
        if first_token in _CLI_PREFIXES:
            mtype = MessageType.CLI_COMMAND
            return Classification(mtype, 0.95, "CLI prefix guard", self._layers(mtype))

        # Fast path: very short message
        if len(normalized) < 10:
            mtype = MessageType.QUERY
            return Classification(mtype, 0.70, "Short fast-path", self._layers(mtype))

        msg_type = MessageType.UNKNOWN
        confidence = 0.0
        rationale = "Baseline"

        if self.semantic_enabled:
            try:
                import numpy as np
                from sklearn.metrics.pairwise import cosine_similarity

                query_vec = self.vectorizer.transform([normalized.lower()])
                sims = cosine_similarity(query_vec, self.vector_space)[0]
                best_idx = int(np.argmax(sims))
                if sims[best_idx] >= self.semantic_threshold:
                    msg_type = list(self.centers.keys())[best_idx]
                    confidence = float(sims[best_idx])
                    rationale = f"Semantic ({confidence:.2f})"
            except Exception as exc:
                logger.debug(f"Semantic classification failed: {exc}")

        # Heuristic fallback
        if msg_type == MessageType.UNKNOWN or confidence < threshold:
            h_type, h_conf, h_rationale = self._detect_type(normalized)
            if h_conf > confidence:
                msg_type, confidence, rationale = h_type, h_conf, h_rationale

        return Classification(msg_type, confidence, rationale, self._layers(msg_type))

    # ------------------------------------------------------------------
    # Heuristic patterns
    # ------------------------------------------------------------------

    def _detect_type(self, message: str) -> tuple[MessageType, float, str]:
        target_types = [
            MessageType.CLI_COMMAND,
            MessageType.DATA_ANALYSIS,
            MessageType.PROSE_REASONING,
            MessageType.CODE_GENERATION,
            MessageType.QUERY,
            MessageType.LOCAL_ANSWERABLE,
        ]
        scores: dict[MessageType, float] = dict.fromkeys(target_types, 0.0)

        if self._matches_cli(message):
            scores[MessageType.CLI_COMMAND] += 0.80
        if self._matches_data(message) and not self._matches_cli(message):
            scores[MessageType.DATA_ANALYSIS] += 0.75
        if self._matches_prose(message):
            scores[MessageType.PROSE_REASONING] += 0.70
        if self._matches_code(message):
            scores[MessageType.CODE_GENERATION] += 0.80
        if self._matches_query(message):
            scores[MessageType.QUERY] += 0.75
        if self._matches_local(message):
            scores[MessageType.LOCAL_ANSWERABLE] += 0.70

        best = max(scores, key=lambda k: scores[k])
        raw = scores[best]

        if raw < self.confidence_threshold:
            return MessageType.UNKNOWN, 0.0, "Low confidence"

        # Softmax calibration
        active = {t: s for t, s in scores.items() if s > 0}
        if active:
            max_s = max(active.values())
            exps = {t: math.exp(s - max_s) for t, s in active.items()}
            total = sum(exps.values())
            conf = exps[best] / total if total > 0 else raw
        else:
            conf = raw

        return best, round(conf, 4), f"Heuristic ({conf:.2f})"

    def _matches_cli(self, m: str) -> bool:
        return bool(re.search(
            r"^(?:git|docker|npm|yarn|cargo|kubectl|python|pip|poetry)\s+|"
            r"^\s*[\$#>]\s*|^(?:ls|cd|mkdir|rm|cp|mv)\s+",
            m, re.I | re.M,
        ))

    def _matches_data(self, m: str) -> bool:
        return bool(re.search(
            r"\b(?:analyze|process|filter|dataset|query|database|table|"
            r"count|summarize|aggregate|stats|csv|json)\b",
            m, re.I,
        ))

    def _matches_prose(self, m: str) -> bool:
        return bool(re.search(
            r"^(?:why|how|explain|describe)|(?:because|therefore|however)|"
            r"\b(?:text|prose|long|message)\b",
            m, re.I | re.M,
        ))

    def _matches_code(self, m: str) -> bool:
        return bool(re.search(
            r"\b(?:write|generate|implement|create|refactor|fix)\b|"
            r"\b(?:def|function|class|struct|impl|pub)\b|"
            r"```(?:python|rust|js|ts|go|c|cpp)",
            m, re.I,
        ))

    def _matches_query(self, m: str) -> bool:
        return bool(re.search(
            r"^(?:find|show|list|get|where|query|search)",
            m, re.I | re.M,
        ))

    def _matches_local(self, m: str) -> bool:
        """Simple factual questions that a small local model can answer."""
        return bool(re.search(
            r"^(?:what is|what are|define|who is|when was|where is)\b",
            m, re.I,
        ) and len(m.split()) < 20)

    def _layers(self, t: MessageType) -> list[str]:
        mapping: dict[MessageType, list[str]] = {
            MessageType.CLI_COMMAND:     ["cli_cleaner", "noise_filter"],
            MessageType.DATA_ANALYSIS:   ["dedup", "rag", "llmlingua"],
            MessageType.PROSE_REASONING: ["noise_filter", "caveman", "llmlingua"],
            MessageType.CODE_GENERATION: ["dedup", "noise_filter", "llmlingua"],
            MessageType.QUERY:           ["rag"],
            MessageType.LOCAL_ANSWERABLE: [],
            MessageType.UNKNOWN:         ["noise_filter"],
        }
        return mapping.get(t, [])

    def update_centers(self, message_type: MessageType, text: str) -> None:
        if self.semantic_enabled and message_type in self.centers:
            current = self.centers[message_type]
            merged = f"{text} {current}"
            self.centers[message_type] = merged[:2000]
            self.vector_space = self.vectorizer.fit_transform(list(self.centers.values()))


# ---------------------------------------------------------------------------
# Complexity scorer
# ---------------------------------------------------------------------------


def complexity_score(message: str, context_tokens: int = 0) -> int:
    """
    Score 0-10. Higher = more powerful model required.

    Factors:
      +3  stack trace present
      +3  context > 8000 tokens
      +2  context > 4000 tokens
      +4  architecture / security / migration keywords
      +2  message > 300 words
      +1  message > 150 words
      +1  3+ question marks (ambiguity)
    """
    score = 0

    if re.search(r"Traceback|File \".*\", line \d+", message):
        score += 3

    if context_tokens > 8000:
        score += 3
    elif context_tokens > 4000:
        score += 2

    if re.search(
        r"\b(architect|design|security|auth|migration|production|deploy|"
        r"database schema|breaking change|refactor)\b",
        message, re.I,
    ):
        score += 4

    words = len(message.split())
    if words > 300:
        score += 2
    elif words > 150:
        score += 1

    if message.count("?") >= 3:
        score += 1

    return min(score, 10)


def model_recommendation(score: int, context_tokens: int = 0) -> str:
    """Return model identifier string for the given complexity score."""
    if score <= 3 and context_tokens < 2000:
        return "ollama:qwen2.5-7b-q4"
    if score <= 3:
        return "ollama:mistral-7b-q4"
    if score <= 6:
        return "openrouter:llama-3.1-70b-free"
    if score <= 8:
        return "openrouter:claude-3-haiku"
    return "claude"   # pass-through to Claude Code's own connection
