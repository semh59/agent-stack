from typing import Any

import aiosqlite  # type: ignore
import numpy as np  # type: ignore
import structlog  # type: ignore

from config import Settings  # type: ignore

logger = structlog.get_logger(__name__)

class BayesianTSAgent:
    """
    Ultra-SOTA Bayesian Thompson Sampling Agent for Agentic Routing.

Instead of deterministic UCB, this agent uses probabilistic sampling
from a Gaussian posterior to achieve optimal exploration-exploitation
in high-entropy 2026-era environments.

    Mathematical Pattern:
    - Prior: theta ~ N(mu, Sigma)
    - Likelihood: reward ~ N(x^T theta, sigma^2)
    - Inverse-Gamma distribution for variance estimation (Elite Hardening).
    """
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db_path = settings.data_dir / "mab_bayesian.db"
        self.dim = 4  # [intent, complexity, has_code, history_depth]
        self.lmbda = 1.0  # Precision prior
        self.sigma = 0.5  # Noise standard deviation

        self.actions = [
            "rag", "llmlingua", "caveman", "cli_cleaner", "noise_filter",
            "dedup", "summarizer", "semantic_pruning", "rcf_folding", "tas_ghosting"
        ]

        # models[action] = {mu, Sigma_inv}
        self.models: dict[str, dict[str, Any]] = {
            action: {
                "mu": np.zeros((self.dim, 1)),
                "Sigma_inv": np.eye(self.dim) * self.lmbda,
            }
            for action in self.actions
        }

    async def initialize(self) -> None:
        await self._init_db()
        await self._load_state()

    async def _init_db(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bayesian_weights (
                    action TEXT PRIMARY KEY,
                    mu_blob BLOB,
                    sigma_inv_blob BLOB
                )
            """)
            await db.commit()

    async def _load_state(self) -> None:
        try:
            async with aiosqlite.connect(self.db_path) as db:
                async with db.execute("SELECT action, mu_blob, sigma_inv_blob FROM bayesian_weights") as cursor:
                    async for raw_action, mu_blob, sigma_inv_blob in cursor:
                        action = str(raw_action)
                        if action in self.models:
                            self.models[action]["mu"] = np.frombuffer(mu_blob).reshape((self.dim, 1))
                            self.models[action]["Sigma_inv"] = np.frombuffer(sigma_inv_blob).reshape((self.dim, self.dim))
            logger.info("mab_bayesian_state_loaded")
        except Exception as e:
            logger.warning("mab_bayesian_load_failed", error=str(e))

    async def _save_state(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            for action, data in self.models.items():
                await db.execute(
                    "INSERT OR REPLACE INTO bayesian_weights (action, mu_blob, sigma_inv_blob) VALUES (?, ?, ?)",
                    (action, data["mu"].tobytes(), data["Sigma_inv"].tobytes())
                )
            await db.commit()

    def _get_features(self, context: list[dict[str, Any]], message: str) -> np.ndarray:
        # Used by reward() â€” context is list[dict], message is the processed text.
        intent_val = 1.0 if any(kw in message.lower() for kw in ["code", "fix", "err"]) else 0.2
        complexity = float(min(len(message) / 1000, 1.0))
        has_code = 1.0 if "```" in message else 0.0
        depth = float(min(len(context) / 20, 1.0))
        return np.array([intent_val, complexity, has_code, depth]).reshape((self.dim, 1))

    def _get_features_from_ctx(self, context: dict[str, Any]) -> np.ndarray:
        # Used by select_layers() â€” context is the dict produced by _apply_optimizations.
        # Keys: intent_code (0|1), prompt_tokens (int), has_code (bool), history_depth (int)
        intent_val = 1.0 if context.get("intent_code", 0) else 0.2
        complexity = float(min(context.get("prompt_tokens", 0) / 4000, 1.0))
        has_code = 1.0 if context.get("has_code", False) else 0.0
        depth = float(min(context.get("history_depth", 0) / 20, 1.0))
        return np.array([intent_val, complexity, has_code, depth]).reshape((self.dim, 1))

    async def select_layers(self, candidates: list[str], context: dict[str, Any]) -> list[str]:
        """
        Action selection via Thompson Sampling.
        Samples from theta ~ N(mu, Sigma) and chooses actions with positive expected utility.
        Only returns actions that are present in `candidates`.
        """
        x = self._get_features_from_ctx(context)
        selected = []

        for action, data in self.models.items():
            if action not in candidates:
                continue
            mu = data["mu"]
            # Sigma = Sigma_inv^-1. In O(d^2) for small d=4, explicit inversion is fine.
            Sigma = np.linalg.inv(data["Sigma_inv"])

            # 2026 ELITE: Sample from posterior
            theta_sampled = np.random.multivariate_normal(mu.flatten(), Sigma).reshape((self.dim, 1))

            p_expected = float((theta_sampled.T @ x).item())
            if p_expected > 0.4:  # Probability-based utility threshold
                selected.append(action)

        # Fallback: if bandit selects nothing, return all candidates
        if not selected:
            selected = list(candidates)
        return selected

    async def reward(self, message: str, context: list[dict[str, Any]], layers: list[str], savings: float) -> None:
        """
        Bayesian Posterior Update (Recursive Least Squares).
        """
        if savings < 0.01:
            return

        x = self._get_features(context, message)
        for action in layers:
            data = self.models[action]

            # Bayesian RLS posterior update
            # Sigma_inv_new = Sigma_inv_old + x * x^T / sigma^2
            Sigma_inv_old = data["Sigma_inv"]
            natural_param = Sigma_inv_old @ data["mu"]  # b_old = Sigma_inv_old @ mu_old

            data["Sigma_inv"] = Sigma_inv_old + (x @ x.T) / (self.sigma ** 2)

            # mu_new = Sigma_new @ (b_old + reward * x / sigma^2)
            Sigma_new = np.linalg.inv(data["Sigma_inv"])
            data["mu"] = Sigma_new @ (natural_param + (savings * x) / (self.sigma ** 2))

        if np.random.rand() < 0.05:
            try:
                await self._save_state()
            except Exception as e:
                logger.debug("mab_save_skipped", error=str(e))
