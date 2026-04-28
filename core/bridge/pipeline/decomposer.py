"""
Decomposer â€” ProjectSpec'i Gateway'in anlayabileceÄŸi
atomik AgentTask listesine bÃ¶ler.

Her task:
- BaÄŸÄ±msÄ±z Ã§alÄ±ÅŸabilir (baÄŸÄ±mlÄ±lÄ±klar aÃ§Ä±k)
- Tek bir agent tarafÄ±ndan yÃ¼rÃ¼tÃ¼lÃ¼r
- Kendi kabul kriteri var
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import structlog  # type: ignore

from pipeline.spec_generator import ProjectSpec  # type: ignore

logger = structlog.get_logger(__name__)


@dataclass
class AgentTask:
    id: str
    role: str          # ARCHITECT, BACKEND_DEV, FRONTEND_DEV, QA vb.
    title: str
    description: str
    depends_on: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    estimated_minutes: int = 15


@dataclass
class DecomposedPlan:
    project_name: str
    tasks: list[AgentTask]

    def to_gateway_payload(self) -> dict[str, Any]:
        """Gateway'in mission baÅŸlatma endpoint'ine gÃ¶nderilecek payload."""
        return {
            "projectName": self.project_name,
            "agents": [
                {
                    "role": t.role,
                    "title": t.title,
                    "description": t.description,
                    "dependsOn": t.depends_on,
                    "acceptanceCriteria": t.acceptance_criteria,
                    "estimatedMinutes": t.estimated_minutes,
                }
                for t in self.tasks
            ],
        }


class Decomposer:
    SYSTEM_PROMPT = (
        "Sen bir proje yÃ¶neticisisin. "
        "Verilen spec'i paralel ve sÄ±ralÄ± Ã§alÄ±ÅŸabilecek "
        "atomik gÃ¶revlere bÃ¶l. Her gÃ¶rev tek bir developer "
        "tarafÄ±ndan tamamlanabilir olmalÄ±."
    )

    def __init__(self, provider_router: Any) -> None:
        self.provider_router = provider_router

    async def decompose(self, spec: ProjectSpec) -> DecomposedPlan:
        decompose_prompt = (
            f"Åu projeyi gÃ¶revlere bÃ¶l:\n{spec.to_decomposer_prompt()}\n\n"
            "JSON formatÄ±nda yanÄ±tla:\n"
            '{"tasks": [{"id": "T1", "role": "ARCHITECT", "title": "...", '
            '"description": "...", "depends_on": [], '
            '"acceptance_criteria": ["..."], "estimated_minutes": 15}]}'
        )

        try:
            response = await self.provider_router.route_call(
                model="tier0-prose",
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": decompose_prompt},
                ],
                temperature=0.1,
                max_tokens=3000,
            )
            raw = response["choices"][0]["message"]["content"]
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(raw[start:end])
                tasks = [
                    AgentTask(
                        id=t.get("id", f"T{i + 1}"),
                        role=t.get("role", "DEVELOPER"),
                        title=t.get("title", ""),
                        description=t.get("description", ""),
                        depends_on=t.get("depends_on", []),
                        acceptance_criteria=t.get("acceptance_criteria", []),
                        estimated_minutes=int(t.get("estimated_minutes", 15)),
                    )
                    for i, t in enumerate(data.get("tasks", []))
                ]
                return DecomposedPlan(project_name=spec.name, tasks=tasks)
        except Exception as exc:
            logger.warning("decompose_failed", error=str(exc))

        # Fallback: tek task
        return DecomposedPlan(
            project_name=spec.name,
            tasks=[
                AgentTask(
                    id="T1",
                    role="DEVELOPER",
                    title=spec.name,
                    description=spec.description,
                )
            ],
        )
