"""
Cost Tracker — SQLite WAL token savings log.

Her istek için tam maliyet kaydı:
  original_tokens, sent_tokens, model_used, savings_percent,
  cache_hit, layers_applied, response_quality (nullable)

get_cost_report() → günlük/haftalık/aylık özet
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

from config import Settings


@dataclass
class CostRecord:
    timestamp: str
    original_tokens: int
    sent_tokens: int
    model_used: str
    savings_percent: float
    cache_hit: bool
    layers_applied: list[str]
    response_quality: float | None = None


_SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp        TEXT    NOT NULL,
    original_tokens  INTEGER NOT NULL,
    sent_tokens      INTEGER NOT NULL,
    model_used       TEXT    NOT NULL DEFAULT '',
    savings_percent  REAL    NOT NULL DEFAULT 0.0,
    cache_hit        INTEGER NOT NULL DEFAULT 0,
    layers_applied   TEXT    NOT NULL DEFAULT '[]',
    response_quality REAL
);
CREATE INDEX IF NOT EXISTS idx_ts ON requests(timestamp);
"""


class CostTracker:

    def __init__(self, settings: Settings) -> None:
        self._db_path = str(settings.costs_db)
        self._conn: sqlite3.Connection | None = None
        self._lock = asyncio.Lock()

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()
        return self._conn

    async def log(self, record: CostRecord) -> None:
        async with self._lock:
            conn = self._get_conn()
            params = (
                record.timestamp,
                record.original_tokens,
                record.sent_tokens,
                record.model_used or "",
                record.savings_percent,
                int(record.cache_hit),
                json.dumps(record.layers_applied),
                record.response_quality,
            )
            # H2 fix: execute + commit in a single to_thread call so an
            # exception can't leave the DB with an uncommitted write.
            def _write() -> None:
                conn.execute(
                    """INSERT INTO requests
                       (timestamp, original_tokens, sent_tokens, model_used,
                        savings_percent, cache_hit, layers_applied, response_quality)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    params,
                )
                conn.commit()

            await asyncio.to_thread(_write)

    async def report(self, period: str = "today") -> dict[str, Any]:
        """
        period: "today" | "week" | "month"
        Returns aggregated stats dict.
        """
        days_map = {"today": 1, "week": 7, "month": 30}
        days = days_map.get(period, 1)
        cutoff = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ",
            time.gmtime(time.time() - days * 86400),
        )

        conn = self._get_conn()
        rows = conn.execute(
            """SELECT original_tokens, sent_tokens, savings_percent,
                      cache_hit, layers_applied, model_used
               FROM requests WHERE timestamp >= ?
               ORDER BY timestamp DESC""",
            (cutoff,),
        ).fetchall()

        if not rows:
            return {"period": period, "requests": 0, "message": "No data yet"}

        total = len(rows)
        avg_savings = sum(r[2] for r in rows) / total
        total_saved = sum(r[0] - r[1] for r in rows)
        cache_hits = sum(r[3] for r in rows)

        layer_savings: dict[str, list[float]] = {}
        for row in rows:
            for layer in json.loads(row[4] or "[]"):
                layer_savings.setdefault(layer, []).append(row[2])

        model_counts: dict[str, int] = {}
        for row in rows:
            m = row[5] or "unknown"  # LOW fix: model_used may be NULL in DB
            model_counts[m] = model_counts.get(m, 0) + 1

        return {
            "period": period,
            "requests": total,
            "avg_savings_percent": round(avg_savings, 1),
            "total_tokens_saved": total_saved,
            "cache_hit_rate": round(cache_hits / total, 3),
            "by_layer": {
                layer: round(sum(vals) / len(vals), 1)
                for layer, vals in layer_savings.items()
            },
            "by_model": model_counts,
        }

    async def record_quality(self, request_id: int, quality: float) -> None:
        """Update response_quality for a previous request (user feedback)."""
        # H1 fix: execute + commit must be off the event loop thread.
        conn = self._get_conn()

        def _update() -> None:
            conn.execute(
                "UPDATE requests SET response_quality = ? WHERE id = ?",
                (quality, request_id),
            )
            conn.commit()

        await asyncio.to_thread(_update)
