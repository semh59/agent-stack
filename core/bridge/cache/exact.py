"""
L1 Cache â€” Memory LRU + SQLite Disk.

Mevcut ai-stack projesindeki cache/memory.py ve cache/disk.py portlanmÄ±ÅŸtÄ±r.
Hash-based exact match, sub-millisecond lookup.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from collections import OrderedDict
from threading import Lock
from typing import Any

from config import Settings  # type: ignore


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Memory LRU
# ---------------------------------------------------------------------------


class MemoryCache:
    """Thread-safe LRU in-memory cache (ported from ai-stack cache/memory.py)."""

    def __init__(self, max_size: int = 200, default_ttl: int = 3600) -> None:
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._lock = Lock()

    def get(self, key: str) -> str | dict[str, Any] | list[Any] | None:
        with self._lock:
            if key not in self._store:
                return None
            value, expires_at = self._store[key]
            if expires_at < time.time():
                self._store.pop(key, None)  # C5 fix: pop is KeyError-safe
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        ttl = ttl if ttl is not None else self._default_ttl
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (value, time.time() + ttl)
            if len(self._store) > self._max_size:
                self._store.popitem(last=False)  # evict LRU

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        return len(self._store)

    def stats(self) -> dict[str, int]:
        return {"size": len(self._store), "max_size": self._max_size}


# ---------------------------------------------------------------------------
# Disk SQLite
# ---------------------------------------------------------------------------


_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache (
    key     TEXT PRIMARY KEY,
    value   BLOB NOT NULL,
    expiry  REAL NOT NULL,
    ts      REAL NOT NULL,
    type    TEXT DEFAULT 'str'
);
CREATE INDEX IF NOT EXISTS idx_expiry ON cache(expiry);
"""


class DiskCache:
    """SQLite WAL persistent cache (ported from ai-stack cache/disk.py)."""

    def __init__(self, db_path: str, default_ttl: int = 86400) -> None:
        self._db_path = db_path
        self._default_ttl = default_ttl
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()
        self._lock = Lock()

    def get(self, key: str) -> Any:
        with self._lock:
            row = self._conn.execute(
                "SELECT value, expiry, type FROM cache WHERE key = ?", (key,)
            ).fetchone()
            if not row:
                return None
            value, expiry, vtype = row
            if expiry < time.time():
                self._conn.execute("DELETE FROM cache WHERE key = ?", (key,))
                self._conn.commit()
                return None
            if vtype in ("dict", "list"):
                return json.loads(value)
            return value

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        ttl = ttl if ttl is not None else self._default_ttl
        vtype = "str"
        stored = value
        if isinstance(value, (dict, list)):
            stored = json.dumps(value, ensure_ascii=False)
            vtype = type(value).__name__
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO cache (key, value, expiry, ts, type) VALUES (?, ?, ?, ?, ?)",
                (key, stored, time.time() + ttl, time.time(), vtype),
            )
            self._conn.commit()

    def delete(self, key: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM cache WHERE key = ?", (key,))
            self._conn.commit()

    def clear(self) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM cache")
            self._conn.commit()

    def clear_expired(self) -> int:
        with self._lock:
            cursor = self._conn.execute(
                "DELETE FROM cache WHERE expiry < ?", (time.time(),)
            )
            self._conn.commit()
            return cursor.rowcount

    def stats(self) -> dict[str, int]:
        row = self._conn.execute(
            "SELECT COUNT(*) FROM cache WHERE expiry > ?", (time.time(),)
        ).fetchone()
        return {"live_entries": row[0] if row else 0}


# ---------------------------------------------------------------------------
# ExactCache â€” unified L1
# ---------------------------------------------------------------------------


class ExactCache:
    """L1 two-tier cache: memory LRU â†’ disk SQLite."""

    # M4 fix: run disk cleanup every N operations to prevent unbounded DB growth.
    _CLEANUP_INTERVAL = 500

    def __init__(self, settings: Settings) -> None:
        self._memory = MemoryCache(
            max_size=settings.exact_cache_max_size,
            default_ttl=settings.exact_cache_default_ttl,
        )
        self._disk = DiskCache(
            db_path=str(settings.cache_db),
            default_ttl=settings.exact_cache_default_ttl,
        )
        self._op_count = 0

    def _maybe_cleanup(self) -> None:
        self._op_count += 1
        if self._op_count % self._CLEANUP_INTERVAL == 0:
            self._disk.clear_expired()

    def get(self, message: str) -> Any:
        key = _hash(message)
        self._maybe_cleanup()
        # Memory first
        value = self._memory.get(key)
        if value is not None:
            return value
        # Disk fallback
        value = self._disk.get(key)
        if value is not None:
            self._memory.set(key, value)  # warm up memory
        return value

    def set(self, message: str, response: str, ttl: int | None = None) -> None:
        key = _hash(message)
        self._maybe_cleanup()
        self._memory.set(key, response, ttl=ttl)
        self._disk.set(key, response, ttl=ttl)

    def delete(self, message: str) -> None:
        key = _hash(message)
        self._memory.delete(key)
        self._disk.delete(key)

    def clear_memory(self) -> None:
        self._memory.clear()

    def clear_disk(self) -> None:
        self._disk.clear()

    def clear(self) -> None:
        self._memory.clear()
        self._disk.clear()

    def stats(self) -> dict[str, Any]:
        return {
            "memory": self._memory.stats(),
            "disk": self._disk.stats(),
        }
