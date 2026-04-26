"""
Prefix Cache Manager — 2026-spec Performance.

Manages shared KV-cache prefixes to reduce latency and token usage
across repetitive sessions and common project instructions.
"""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Any

from config import Settings

logger = logging.getLogger(__name__)

class PrefixCacheManager:
    
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cache: dict[str, dict[str, Any]] = {} # hash -> {content, last_used}
        self.ttl = 3600 # 1 hour

    def get_prefix(self, content: str) -> str | None:
        """Retrieve a cached prefix if available."""
        h = self._hash(content)
        if h in self._cache:
            self._cache[h]["last_used"] = time.time()
            return str(self._cache[h]["content"])
        return None

    def store_prefix(self, content: str) -> None:
        """Store a common prefix in the cache."""
        h = self._hash(content)
        self._cache[h] = {
            "content": content,
            "last_used": time.time()
        }
        self._evict_old()

    def _hash(self, content: str) -> str:
        return hashlib.sha256(content.encode()).hexdigest()

    def _evict_old(self) -> None:
        """Evict items older than TTL."""
        now = time.time()
        expired = [h for h, data in self._cache.items() if now - data["last_used"] > self.ttl]
        for h in expired:
            del self._cache[h]
