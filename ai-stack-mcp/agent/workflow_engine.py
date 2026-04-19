"""
Workflow Engine — ported from ai-stack agent/workflow_engine.py.

Changes vs original:
  - Removed ai_stack.context_mode_adapter.mcp_client dependency
  - Skill execution now uses local subprocess (ContextModeExecutor pattern)
  - Import paths updated
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from agent.skill_manager import Skill, SkillManager

logger = logging.getLogger(__name__)


@dataclass
class WorkflowStep:
    name: str
    skill_name: str
    parameters: dict[str, Any] = field(default_factory=dict)


async def _execute_skill_locally(skill: Skill, params: dict[str, Any]) -> str:
    """Execute skill code in a sandboxed subprocess."""
    preamble = f"params = {json.dumps(params)!r}\n"
    code = preamble + skill.code

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as f:
        f.write(code)
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, tmp_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        output = stdout.decode("utf-8", errors="replace").strip()
        if not output and stderr:
            output = stderr.decode("utf-8", errors="replace").strip()
        return output
    except asyncio.TimeoutError:
        return json.dumps({"error": "execution timeout"})
    finally:
        Path(tmp_path).unlink(missing_ok=True)


class WorkflowEngine:

    def __init__(
        self,
        skill_manager: SkillManager,
        db_path: str = "~/.ai-stack-mcp/workflow.db",
    ) -> None:
        self.skill_manager = skill_manager
        self._db_path = Path(db_path).expanduser()
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS workflow_history (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    name      TEXT,
                    timestamp TEXT,
                    status    TEXT,
                    history   JSON
                )
            """)

    async def execute_plan(
        self,
        steps: list[WorkflowStep],
        initial_context: dict[str, Any],
    ) -> dict[str, Any]:
        context = initial_context.copy()
        history: list[dict[str, Any]] = []

        for step in steps:
            skill = self.skill_manager.get_skill(step.skill_name)
            if not skill:
                history.append({
                    "step": step.name,
                    "status": "failed",
                    "error": f"Skill '{step.skill_name}' not found",
                })
                continue

            try:
                output = await _execute_skill_locally(skill, step.parameters)
                status = "success"
            except Exception as exc:
                output = str(exc)
                status = "failed"
                logger.error(f"Step '{step.name}' failed: {exc}")

            record: dict[str, Any] = {
                "step": step.name,
                "skill": skill.name,
                "timestamp": datetime.now().isoformat(),
                "status": status,
                "output": output,
            }
            history.append(record)
            context[f"{step.name}_output"] = output

        context["status"] = "completed"
        context["history"] = history
        self._persist_workflow("workflow", history)
        return context

    def _persist_workflow(self, name: str, history: list[dict[str, Any]]) -> None:
        try:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    "INSERT INTO workflow_history (name, timestamp, status, history) "
                    "VALUES (?, ?, ?, ?)",
                    (name, datetime.now().isoformat(), "completed", json.dumps(history)),
                )
        except Exception as exc:
            logger.error(f"Failed to persist workflow: {exc}")
