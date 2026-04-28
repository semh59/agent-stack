import json

import aiosqlite
import pytest

from pipeline.distillation import DistillationBuffer


@pytest.fixture
def test_db_path(tmp_path):
    return tmp_path / "test_distillation.db"


@pytest.fixture
def mock_settings(test_db_path):
    class MockSettings:
        data_dir = test_db_path.parent

    return MockSettings()


@pytest.mark.asyncio
async def test_distillation_record_and_export(mock_settings, test_db_path):
    db_buffer = DistillationBuffer(mock_settings)
    # Redirect DB to our tmp_path
    db_buffer.db_path = test_db_path

    await db_buffer.initialize()

    # 1. Record a low savings interaction (should be ignored)
    await db_buffer.record_experience(
        intent="prose",
        model="test-model",
        messages=[{"role": "user", "content": "hello"}],
        response="hi",
        complexity=1.0,
        savings=5.0,  # Below 15.0 threshold
        anchors=["rag"],
    )

    # 2. Record a high savings interaction (should be captured)
    await db_buffer.record_experience(
        intent="code_generation",
        model="claude-3-5-sonnet",
        messages=[{"role": "user", "content": "Write me a massive script"}],
        response="Here is the ghosting implementation with specific anchors... " + ("X" * 100),
        complexity=8.5,
        savings=95.4,  # High yield
        anchors=["tas_ghosting"],
    )

    # 3. Verify SQLite DB manually
    async with aiosqlite.connect(test_db_path) as db:
        async with db.execute("SELECT intent, savings_percent FROM experience_logs") as cursor:
            rows = await cursor.fetchall()
            assert len(rows) == 1, "Only 1 record should be captured (the high yield one)"
            assert rows[0][0] == "code_generation"
            assert rows[0][1] == 95.4

    # 4. Generate JSONL Export
    jsonl_output = test_db_path.parent / "dataset.jsonl"
    exported_count = await db_buffer.export_jsonl(jsonl_output, min_savings=50.0)

    assert exported_count == 1
    assert jsonl_output.exists()

    # Verify exact JSONL formatting for LoRA training
    with jsonl_output.open("r", encoding="utf-8") as f:
        line = f.readline()
        record = json.loads(line)
        assert "messages" in record
        assert len(record["messages"]) == 2
        assert record["messages"][0]["role"] == "user"
        assert record["messages"][1]["role"] == "assistant"
        assert "X" * 100 in record["messages"][1]["content"]
