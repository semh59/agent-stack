from __future__ import annotations
import numpy as np
import aiosqlite
import structlog
from pathlib import Path
from typing import List, Dict, Any, Optional
from config import Settings

logger = structlog.get_logger(__name__)

class LinUCBAgent:
    """
    Hyper-Optimized Contextual Bandit using LinUCB with Sherman-Morrison rank-1 updates.
    
    Features:
    - Ridge Regularization: Adds lambda*I to ensure invertibility and handle noise.
    - Sherman-Morrison: Updates (A^T A)^-1 in O(d^2) instead of O(d^3) inversion.
    - Contextual Mapping: Intent, tokens, code-presence, and history-depth.
    """
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db_path = settings.data_dir / "mab_v2.db"
        self.dim = 4  # [intent_code, log_tokens, has_code, depth]
        self.alpha = 0.2
        self.lmbda = 1.0
        
        self.actions = ["exact_cache", "semantic_cache", "rag", "compression"]
        
        # models[action] = {A_inv, b, theta}
        self.models: Dict[str, Any] = {
            action: {
                "A_inv": np.eye(self.dim) * (1.0 / self.lmbda),
                "b": np.zeros((self.dim, 1)),
                "theta": np.zeros((self.dim, 1))
            }
            for action in self.actions
        }

    async def initialize(self) -> None:
        await self._init_db()
        await self._load_state()

    async def _init_db(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS weights (
                    action TEXT PRIMARY KEY,
                    a_inv_blob BLOB,
                    b_blob BLOB
                )
            """)
            await db.commit()

    async def _load_state(self) -> None:
        try:
            async with aiosqlite.connect(self.db_path) as db:
                async with db.execute("SELECT action, a_inv_blob, b_blob FROM weights") as cursor:
                    async for action, a_inv_blob, b_blob in cursor:
                        if action in self.models:
                            A_inv = np.frombuffer(a_inv_blob).reshape((self.dim, self.dim))
                            b = np.frombuffer(b_blob).reshape((self.dim, 1))
                            self.models[action]["A_inv"] = A_inv
                            self.models[action]["b"] = b
                            self.models[action]["theta"] = A_inv @ b
            logger.info("mab_state_loaded_v2")
        except Exception as e:
            logger.warning("mab_load_failed", error=str(e))

    async def _save_state(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            for action, data in self.models.items():
                await db.execute(
                    "INSERT OR REPLACE INTO weights (action, a_inv_blob, b_blob) VALUES (?, ?, ?)",
                    (action, data["A_inv"].tobytes(), data["b"].tobytes())
                )
            await db.commit()

    def _get_features(self, context: List[Dict[str, Any]], message: str) -> np.ndarray:
        intent_code = 1.0 if any(kw in message.lower() for kw in ["fix", "bug", "error"]) else 0.5
        log_tokens = np.log10(len(message.split()) + 1)
        has_code = 1.0 if "```" in message else 0.0
        depth = float(min(len(context), 10)) / 10.0
        return np.array([intent_code, log_tokens, has_code, depth]).reshape((self.dim, 1))

    async def select_layers(self, message: str, context: List[Dict[str, Any]]) -> List[str]:
        x = self._get_features(context, message)
        selected = []
        for action, data in self.models.items():
            A_inv = data["A_inv"]
            theta = data["theta"]
            p = (theta.T @ x) + self.alpha * np.sqrt(x.T @ A_inv @ x)
            if p > 0.5:
                selected.append(action)
        if not selected:
            selected = ["exact_cache"]
        return selected

    async def reward(self, message: str, context: List[Dict[str, Any]], layers: List[str], savings: float) -> None:
        if savings < 0.02: return
        x = self._get_features(context, message)
        for action in layers:
            data = self.models[action]
            A_inv = data["A_inv"]
            inv_x = A_inv @ x
            num = inv_x @ (x.T @ A_inv)
            den = 1.0 + (x.T @ inv_x)
            data["A_inv"] = A_inv - (num / den)
            data["b"] = data["b"] + (savings * x)
            data["theta"] = data["A_inv"] @ data["b"]
        if np.random.rand() < 0.1:
            await self._save_state()
