"""
Thompson Sampling Multi-Armed Bandit (MAB).

Her katman (arm) için Beta dağılımı sürdürülür.
select_layers() → Thompson sample'a göre sıralı katman listesi döner.
reward()        → savings oranına göre alpha/beta güncellenir.
Durum SQLite'a persist edilir — server restart sonrası korunur.
"""
from __future__ import annotations

import asyncio
import math
import random
import sqlite3
from dataclasses import dataclass
from typing import Any

import structlog  # type: ignore

from config import Settings


ARMS = [
    "cli_cleaner",
    "llmlingua",
    "caveman",
    "dedup",
    "summarizer",
    "noise_filter",
    "rag",
    "semantic_cache",
]

logger = structlog.get_logger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mab_state (
    name  TEXT PRIMARY KEY,
    alpha REAL NOT NULL DEFAULT 1.0,
    beta  REAL NOT NULL DEFAULT 1.0
);
"""


@dataclass
class MABArm:
    name: str
    alpha: float = 1.0  # successes + prior
    beta: float = 1.0   # failures + prior

    def sample(self) -> float:
        """Draw from Beta(alpha, beta) — higher value = more promising arm."""
        return random.betavariate(max(self.alpha, 0.01), max(self.beta, 0.01))

    def update(self, savings_fraction: float, threshold: float = 0.20) -> None:
        """
        savings_fraction: 0.0-1.0 (e.g. 0.42 = 42% savings)
        Reward if savings >= threshold, penalise otherwise.
        """
        if savings_fraction >= threshold:
            self.alpha += 1
        else:
            self.beta += 1


class ThompsonSamplingMAB:
    """
    Manages a set of arms (optimization layers).
    Persists state to SQLite so learning carries over across server restarts.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.epsilon = settings.mab_epsilon
        self.reward_threshold = settings.mab_reward_threshold
        self.arms: dict[str, MABArm] = {name: MABArm(name=name) for name in ARMS}
        self._db_path = str(settings.mab_db)
        self._lock = asyncio.Lock()
        self._load_state()

    async def select_layers(self, candidates: list[str]) -> list[str]:
        async with self._lock:
            if not candidates:
                return []

            if random.random() < self.epsilon:
                result = candidates.copy()
                random.shuffle(result)
                return result

            # Thompson Sampling
            arms_to_sample = [
                self.arms.get(c, MABArm(name=c)) for c in candidates
            ]
            # Sort by sample value
            scored = sorted(
                [(a.sample(), a.name) for a in arms_to_sample],
                key=lambda x: x[0],
                reverse=True
            )
            return [name for _, name in scored]

        return []

    async def reward(self, layer: str, savings_percent: float) -> None:
        async with self._lock:
            arm = self.arms.get(layer)
            if arm is None:
                arm = MABArm(name=layer)
                self.arms[layer] = arm
            arm.update(savings_percent / 100.0, threshold=self.reward_threshold)
            
            # Use type-safe delegation for background persistence
            await asyncio.to_thread(lambda: self._save_state())

    def arm_stats(self) -> dict[str, dict[str, float]]:
        # Explicit casting or ensuring key is str to satisfy Pyre
        stats: dict[str, dict[str, float]] = {}
        for name, arm in self.arms.items():
            stats[str(name)] = {
                "alpha": float(math.floor(arm.alpha * 100) / 100.0),
                "beta": float(math.floor(arm.beta * 100) / 100.0),
                "mean": float(math.floor((arm.alpha / (arm.alpha + arm.beta)) * 1000) / 1000.0),
            }
        return stats

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load_state(self) -> None:
        try:
            conn = sqlite3.connect(self._db_path)
            conn.execute(_SCHEMA)
            conn.commit()
            raw_data = conn.execute("SELECT name, alpha, beta FROM mab_state").fetchall()
            for row in raw_data:
                name_str, alpha_val, beta_val = str(row[0]), float(row[1]), float(row[2])
                if name_str in self.arms:
                    self.arms[name_str].alpha = alpha_val
                    self.arms[name_str].beta = beta_val
            conn.close()
        except Exception:
            pass  # fresh start with priors

    def _save_state(self) -> None:
        try:
            conn = sqlite3.connect(self._db_path)
            conn.execute(_SCHEMA)
            for arm in self.arms.values():
                conn.execute(
                    "INSERT OR REPLACE INTO mab_state (name, alpha, beta) VALUES (?, ?, ?)",
                    (arm.name, arm.alpha, arm.beta),
                )
            conn.commit()
            conn.close()
        except Exception:
            pass
