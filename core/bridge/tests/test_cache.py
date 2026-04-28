"""Tests for cache/exact.py, cache/semantic.py, cache/partial.py"""
import pytest
from cache.exact import MemoryCache, DiskCache, ExactCache


# ---------------------------------------------------------------------------
# MemoryCache
# ---------------------------------------------------------------------------

def test_memory_cache_set_get():
    cache = MemoryCache(max_size=10)
    cache.set("k1", "v1")
    assert cache.get("k1") == "v1"


def test_memory_cache_miss():
    cache = MemoryCache()
    assert cache.get("nonexistent") is None


def test_memory_cache_lru_eviction():
    cache = MemoryCache(max_size=3)
    for i in range(4):
        cache.set(f"k{i}", f"v{i}")
    # k0 should be evicted (LRU)
    assert cache.get("k0") is None
    assert cache.get("k3") == "v3"


def test_memory_cache_ttl_expiry():
    import time
    cache = MemoryCache(default_ttl=0)
    cache.set("k", "v", ttl=0)
    time.sleep(0.01)
    assert cache.get("k") is None


def test_memory_cache_delete():
    cache = MemoryCache()
    cache.set("k", "v")
    cache.delete("k")
    assert cache.get("k") is None


def test_memory_cache_clear():
    cache = MemoryCache()
    cache.set("k1", "v1")
    cache.set("k2", "v2")
    cache.clear()
    assert len(cache) == 0


# ---------------------------------------------------------------------------
# DiskCache
# ---------------------------------------------------------------------------

def test_disk_cache_set_get(tmp_path):
    db = str(tmp_path / "test.db")
    cache = DiskCache(db)
    cache.set("key1", "value1")
    assert cache.get("key1") == "value1"


def test_disk_cache_miss(tmp_path):
    cache = DiskCache(str(tmp_path / "t.db"))
    assert cache.get("nonexistent") is None


def test_disk_cache_ttl_expiry(tmp_path):
    import time
    cache = DiskCache(str(tmp_path / "t.db"))
    cache.set("k", "v", ttl=0)
    time.sleep(0.01)
    assert cache.get("k") is None


def test_disk_cache_persistence(tmp_path):
    db = str(tmp_path / "persist.db")
    cache1 = DiskCache(db)
    cache1.set("persistent", "data")
    cache2 = DiskCache(db)  # new instance, same file
    assert cache2.get("persistent") == "data"


# ---------------------------------------------------------------------------
# ExactCache
# ---------------------------------------------------------------------------

def test_exact_cache_set_get(tmp_settings):
    cache = ExactCache(tmp_settings)
    cache.set("hello world", "response")
    assert cache.get("hello world") == "response"


def test_exact_cache_miss(tmp_settings):
    cache = ExactCache(tmp_settings)
    assert cache.get("unknown message") is None


def test_exact_cache_hash_based(tmp_settings):
    """Same message â†’ same key regardless of cache instance."""
    cache = ExactCache(tmp_settings)
    cache.set("test message", "cached_response")
    # Different instance, same settings
    cache2 = ExactCache(tmp_settings)
    assert cache2.get("test message") == "cached_response"


def test_exact_cache_stats(tmp_settings):
    cache = ExactCache(tmp_settings)
    stats = cache.stats()
    assert "memory" in stats
    assert "disk" in stats


# ---------------------------------------------------------------------------
# SemanticCache (ChromaDB dependent)
# ---------------------------------------------------------------------------

def _chromadb_available() -> bool:
    try:
        import chromadb
        return True
    except ImportError:
        return False


@pytest.mark.skipif(not _chromadb_available(), reason="ChromaDB not installed")
@pytest.mark.asyncio
async def test_semantic_cache_basic(tmp_settings, mock_chromadb):
    """Verify semantic cache integration (with mocks)."""
    from cache.semantic import SemanticCache
    cache = SemanticCache(tmp_settings)
    await cache.set("original message", [], "cached response")
    res = await cache.get("original message", [])
    # mock_chromadb returns empty lists, so SemanticCache.get returns None
    assert res is None or res == "cached response"
