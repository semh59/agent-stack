from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import aiosqlite  # type: ignore
import structlog  # type: ignore

from config import Settings  # type: ignore

logger = structlog.get_logger(__name__)


class DistillationBuffer:
    """
    Continuous Distillation Buffer (CDB) for the Alloy Bridge.

    Silent, background actor that records high-quality model outputs ("Experiences")
    into a structured SQLite database. These logs represent "Ground Truth" data
    and are accumulated over time to fine-tune local models (e.g., Llama 3 8B)
    to perform on-par with massive cloud models within the Alloy ecosystem.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.db_path = settings.data_dir / "distillation_buffer.db"
        self._lock = asyncio.Lock()
        self._initialized = False

    async def initialize(self) -> None:
        """Sets up the distillation SQLite schema."""
        if self._initialized:
            return

        async with self._lock:
            if self._initialized:
                return

            try:
                # Ensure directory exists safely
                self.db_path.parent.mkdir(parents=True, exist_ok=True)

                async with aiosqlite.connect(self.db_path) as db:
                    # Ground Truth dataset schema
                    await db.execute("""
                        CREATE TABLE IF NOT EXISTS experience_logs (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            timestamp REAL,
                            intent TEXT,
                            model TEXT,
                            messages_json TEXT,
                            response TEXT,
                            complexity_score REAL,
                            savings_percent REAL,
                            anchors_used TEXT
                        )
                    """)
                    # Index to fetch highest quality training samples fast
                    await db.execute(
                        "CREATE INDEX IF NOT EXISTS idx_savings ON experience_logs(savings_percent DESC)"
                    )
                    await db.commit()
                self._initialized = True
                logger.info("distillation_buffer_initialized", db=str(self.db_path))
            except Exception as e:
                logger.error("distillation_init_failed", error=str(e))

    async def record_experience(
        self,
        intent: str,
        model: str,
        messages: list[dict[str, str]],
        response: str,
        complexity: float,
        savings: float,
        anchors: list[str],
    ) -> None:
        """
        Asynchronously captures a high-value interaction to the distillation DB.
        """
        logger.info("distillation_triggered", r_len=len(response), sav=savings)
        if not self._initialized:
            await self.initialize()

        if len(response) < 10 or savings < 5.0:  # Minimum quality guardrail
            logger.info("distillation_aborted_by_guardrail")
            return

        try:
            logger.info("distillation_inserting_sqlite")
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute(
                    """
                    INSERT INTO experience_logs
                    (timestamp, intent, model, messages_json, response, complexity_score, savings_percent, anchors_used)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        time.time(),
                        intent,
                        model,
                        json.dumps(messages, ensure_ascii=False),
                        response,
                        complexity,
                        savings,
                        json.dumps(anchors),
                    ),
                )
                await db.commit()
            logger.info("experience_recorded", intent=intent, savings=round(savings, 2))
        except Exception as e:
            logger.error("distillation_record_failed", error=str(e))

    async def export_jsonl(self, output_path: Path, min_savings: float = 50.0) -> int:
        """
        Exports the dataset into a `.jsonl` fine-tuning format.
        """
        if not self._initialized:
            await self.initialize()

        count = 0
        try:
            async with aiosqlite.connect(self.db_path) as db:
                async with db.execute(
                    "SELECT messages_json, response FROM experience_logs WHERE savings_percent >= ?",
                    (min_savings,),
                ) as cursor:
                    with output_path.open("w", encoding="utf-8") as f:
                        async for msgs_json, resp in cursor:
                            msgs = json.loads(msgs_json)
                            # Format for OpenAI / HuggingFace chat templates
                            msgs.append({"role": "assistant", "content": resp})
                            f.write(json.dumps({"messages": msgs}, ensure_ascii=False) + "\n")
                            count += 1
            logger.info("distillation_export_complete", records=count, path=str(output_path))
        except Exception as e:
            logger.error("distillation_export_failed", error=str(e))
        return count
