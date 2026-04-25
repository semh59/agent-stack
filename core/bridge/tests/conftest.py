"""
Shared pytest fixtures.
All external services (Ollama, OpenRouter, ChromaDB) are mocked by default.
Integration tests that need real services are marked with @pytest.mark.integration.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# Async support
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def event_loop_policy():
    # Python 3.14: DefaultEventLoopPolicy is deprecated; use None to get default behavior
    return None


# ---------------------------------------------------------------------------
# Settings fixture — uses temp directory
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_settings(tmp_path):
    """Settings pointing to a temporary directory — no real files created."""
    import os
    os.environ["ALLOY_DATA_DIR"] = str(tmp_path)
    os.environ["ALLOY_OLLAMA_URL"] = "http://localhost:11434"
    os.environ["ALLOY_OPENROUTER_API_KEY"] = ""

    from config import Settings
    s = Settings(data_dir=tmp_path)
    yield s

    # Cleanup env
    for key in ["ALLOY_DATA_DIR", "ALLOY_OLLAMA_URL", "ALLOY_OPENROUTER_API_KEY"]:
        os.environ.pop(key, None)


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_ollama_embed():
    """Mock Ollama embedding endpoint — returns a 768-dim zero vector."""
    import httpx

    async def _embed(*args, **kwargs):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        response.json.return_value = {"embedding": [0.0] * 768}
        return response

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=_embed):
        yield


@pytest.fixture
def mock_ollama_generate():
    """Mock Ollama generate endpoint."""
    import httpx

    async def _gen(*args, **kwargs):
        body = kwargs.get("json", {})
        prompt = body.get("prompt", "")
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        response.json.return_value = {"response": f"[compressed] {prompt[:50]}"}
        return response

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=_gen):
        yield


@pytest.fixture
def mock_chromadb(tmp_path):
    """Mock ChromaDB to avoid real DB operations."""
    collection = MagicMock()
    collection.query.return_value = {"ids": [[]], "distances": [[]], "documents": [[]], "metadatas": [[]]}
    collection.count.return_value = 0
    collection.upsert = MagicMock()
    collection.delete = MagicMock()
    collection.get.return_value = {"ids": []}

    client = MagicMock()
    client.get_or_create_collection.return_value = collection

    with patch("chromadb.PersistentClient", return_value=client):
        yield collection


@pytest.fixture
def mock_lancedb(tmp_path):
    """Mock LanceDB to avoid real vector DB operations."""
    table = MagicMock()
    table.search.return_value.limit.return_value.to_list.return_value = []
    table.add = MagicMock()
    table.delete = MagicMock()

    db = MagicMock()
    db.open_table.side_effect = Exception("table not found")
    db.create_table.return_value = table

    with patch("lancedb.connect", return_value=db):
        yield table
