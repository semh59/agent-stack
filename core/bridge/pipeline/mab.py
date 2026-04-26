"""
Thompson Sampling Multi-Armed Bandit (MAB).

Her katman (arm) için Beta dağılımı sürdürülür.
select_layers() → Thompson sample'a göre sıralı katman listesi döner.
reward()        → savings oranına göre alpha/beta güncellenir.
Durum SQLite'a persist edilir — server restart sonrası korunur.

NOT: __init__ bloklayan I/O içermez. Kullanım:
    mab = ThompsonSamplingMAB(settings)
    await mab.initialize()   # aiosqlite ile state yükle
"""
from __future__ import annotations

import asyncio
import math
import random
from dataclasses import dataclass
from typing import Any

import aiosqlite  # pip install aiosqlite
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
        """Reward if savings >= threshold, penalise otherwise."""
        if savings_fraction >= threshold:
            self.alpha += 1
        else:
            self.beta += 1


class ThompsonSamplingMAB:
    """
    Manages a set of optimization-layer arms with Thompson Sampling.
    Persists state to SQLite so learning carries over across restarts.

    Usage:
        mab = ThompsonSamplingMAB(settings)
        await mab.initialize()   # non-blocking; call once before use
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.epsilon = settings.mab_epsilon
        self.reward_threshold = settings.mab_reward_threshold
        self.arms: dict[str, MABArm] = {name: MABArm(name=name) for name in ARMS}
        self._db_path = str(settings.mab_db)
        self._lock = asyncio.Lock()
        # NOTE: no blocking I/O here — call initialize() to load persisted state

    async def initialize(self) -> None:
        """Load persisted arm state from SQLite. Non-blocking."""
        try:
            async with aiosqlite.connect(self._db_path) as db:
                await db.execute("PRAGMA journal_mode=WAL")
                await db.execute(_SCHEMA)
                await db.commit()
                async with db.execute("SELECT name, alpha, beta FROM mab_state") as cur:
                    async for row in cur:
                        name_str, alpha_val, beta_val = str(row[0]), float(row[1]), float(row[2])
                        if name_str in self.arms:
                            self.arms[name_str].alpha = alpha_val
                            self.arms[name_str].beta = beta_val
        except Exception as exc:
            logger.warning("mab.initialize failed, using priors", error=str(exc))

    async def select_layers(self, candidates: list[str]) -> list[str]:
        async with self._lock:
            if not candidates:
                return []
            if random.random() < self.epsilon:
                result = candidates.copy()
                random.shuffle(result)
                return result
            arms_to_sample = [self.arms.get(c, MABArm(name=c)) for c in candidates]
            scored = sorted(
                [(a.sample(), a.name) for a in arms_to_sample],
                key=lambda x: x[0],
                reverse=True,
            )
            return [name for _, name in scored]

    async def reward(self, layer: str, savings_percent: float) -> None:
        async with self._lock:
            arm = self.arms.get(layer)
            if arm is None:
                arm = MABArm(name=layer)
                self.arms[layer] = arm
            arm.update(savings_percent / 100.0, threshold=self.reward_threshold)
            await self._save_state()

    def arm_stats(self) -> dict[str, dict[str, float]]:
        stats: dict[str, dict[str, float]] = {}
        for name, arm in self.arms.items():
            stats[str(name)] = {
                "alpha": float(math.floor(arm.alpha * 100) / 100.0),
                "beta": float(math.floor(arm.beta * 100) / 100.0),
                "mean": float(math.floor((arm.alpha / (arm.alpha + arm.beta)) * 1000) / 1000.0),
            }
        return stats

    async def _save_state(self) -> None:
        """Persist arm state. Must be called with self._lock held."""
        try:
            async with aiosqlite.connect(self._db_path) as db:
                await db.execute("PRAGMA journal_mode=WAL")
                await db.execute(_SCHEMA)
                await db.executemany(
                    "INSERT OR REPLACE INTO mab_state (name, alpha, beta) VALUES (?, ?, ?)",
                    [(arm.name, arm.alpha, arm.beta) for arm in self.arms.values()],
                )
                await db.commit()
        except Exception as exc:
            logger.warning("mab._save_state failed", error=str(exc))
