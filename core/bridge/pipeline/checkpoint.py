"""
CheckpointManager â€” her gÃ¶rev adÄ±mÄ±nda durum kaydeder.

Ã–zellikler:
- Aiosqlite'a checkpoint kaydeder
- Rollback desteÄŸi (Ã¶nceki adÄ±ma dÃ¶n)
- Gateway SequentialPipeline ile uyumlu API
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiosqlite  # type: ignore
import structlog  # type: ignore

logger = structlog.get_logger(__name__)


@dataclass
class Checkpoint:
    id: str
    task_id: str
    project_name: str
    state: dict[str, Any]
    created_at: float
    status: str   # "active" | "rolled_back"


class CheckpointManager:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    async def initialize(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS checkpoints (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active'
                )
            """)
            await db.commit()

    async def save(
        self,
        checkpoint_id: str,
        task_id: str,
        project_name: str,
        state: dict[str, Any],
    ) -> str:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT OR REPLACE INTO checkpoints VALUES (?,?,?,?,?,?)",
                (
                    checkpoint_id,
                    task_id,
                    project_name,
                    json.dumps(state, ensure_ascii=False),
                    time.time(),
                    "active",
                ),
            )
            await db.commit()
        logger.info("checkpoint_saved", id=checkpoint_id, task=task_id)
        return checkpoint_id

    async def load(self, checkpoint_id: str) -> Checkpoint | None:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT * FROM checkpoints WHERE id=?", (checkpoint_id,)
            ) as cur:
                row = await cur.fetchone()
                if not row:
                    return None
                return Checkpoint(
                    id=row[0],
                    task_id=row[1],
                    project_name=row[2],
                    state=json.loads(row[3]),
                    created_at=row[4],
                    status=row[5],
                )

    async def rollback(self, checkpoint_id: str) -> dict[str, Any] | None:
        """Checkpoint'e geri dÃ¶ner, state'i dÃ¶ndÃ¼rÃ¼r."""
        cp = await self.load(checkpoint_id)
        if not cp:
            logger.warning("checkpoint_not_found", id=checkpoint_id)
            return None

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE checkpoints SET status='rolled_back' WHERE id > ?",
                (checkpoint_id,),
            )
            await db.commit()

        logger.info("checkpoint_rolled_back", id=checkpoint_id)
        return cp.state

    async def list_project_checkpoints(self, project_name: str) -> list[Checkpoint]:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT * FROM checkpoints WHERE project_name=? AND status='active' ORDER BY created_at",
                (project_name,),
            ) as cur:
                rows = await cur.fetchall()
                return [
                    Checkpoint(
                        id=r[0],
                        task_id=r[1],
                        project_name=r[2],
                        state=json.loads(r[3]),
                        created_at=r[4],
                        status=r[5],
                    )
                    for r in rows
                ]
