"""
SpecGenerator â€” DiscoveryContext'ten teknik spec Ã¼retir.

Spec iÃ§eriÄŸi:
- Proje adÄ± + kÄ±sa aÃ§Ä±klama
- Ã–zellik listesi (gruplandÄ±rÄ±lmÄ±ÅŸ)
- Teknik yÄ±ÄŸÄ±n Ã¶nerisi
- Beklenen dosya/klasÃ¶r yapÄ±sÄ±
- AÅŸama planÄ± (MVP â†’ V1 â†’ V2)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import structlog  # type: ignore

from pipeline.discovery_agent import DiscoveryContext  # type: ignore

logger = structlog.get_logger(__name__)


@dataclass
class ProjectSpec:
    name: str
    description: str
    features: list[dict[str, Any]] = field(default_factory=list)
    tech_stack: dict[str, str] = field(default_factory=dict)
    file_structure: list[str] = field(default_factory=list)
    phases: list[dict[str, Any]] = field(default_factory=list)

    def to_decomposer_prompt(self) -> str:
        """Decomposer'a verilecek baÄŸlam."""
        return json.dumps({
            "name": self.name,
            "description": self.description,
            "features": self.features,
            "tech_stack": self.tech_stack,
            "phases": self.phases,
        }, ensure_ascii=False, indent=2)


class SpecGenerator:
    SYSTEM_PROMPT = (
        "Sen kÄ±demli bir yazÄ±lÄ±m mimarÄ±sÄ±n. "
        "Verilen hedefe gÃ¶re detaylÄ± bir teknik spec Ã¼ret. "
        "JSON formatÄ±nda yanÄ±tla.\n\n"
        "RCF NOTU: BaÄŸlam iÃ§inde {'@rcf': '...', 'delta': {...}} formatÄ±nda "
        "katlanmÄ±ÅŸ veriler alabilirsin. BunlarÄ± bilinen mimari kalÄ±plar Ã¼zerine "
        "delta bilgilerini ekleyerek zihninde geri aÃ§ ve tam baÄŸlamla yanÄ±t ver."
    )

    def __init__(self, provider_router: Any) -> None:
        self.provider_router = provider_router

    async def generate(self, ctx: DiscoveryContext) -> ProjectSpec:
        spec_prompt = (
            f"AÅŸaÄŸÄ±daki projeyi detaylandÄ±r:\n{ctx.to_spec_prompt()}\n\n"
            "JSON formatÄ±nda yanÄ±tla:\n"
            "{\n"
            '  "name": "...",\n'
            '  "description": "...",\n'
            '  "features": [{"name": "...", "priority": "high|medium|low", "description": "..."}],\n'
            '  "tech_stack": {"backend": "...", "frontend": "...", "database": "..."},\n'
            '  "file_structure": ["src/", "src/api/", "..."],\n'
            '  "phases": [{"phase": "MVP", "features": ["..."]}]\n'
            "}"
        )

        try:
            response = await self.provider_router.route_call(
                model="tier0-prose",
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": spec_prompt},
                ],
                temperature=0.2,
                max_tokens=2000,
            )
            raw = response["choices"][0]["message"]["content"]
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(raw[start:end])
                return ProjectSpec(
                    name=data.get("name", ctx.clarified_goal[:50]),
                    description=data.get("description", ""),
                    features=data.get("features", []),
                    tech_stack=data.get("tech_stack", {}),
                    file_structure=data.get("file_structure", []),
                    phases=data.get("phases", []),
                )
        except Exception as exc:
            logger.warning("spec_generation_failed", error=str(exc))

        # Fallback: minimal spec
        return ProjectSpec(
            name=ctx.clarified_goal[:50],
            description=ctx.clarified_goal,
            features=[
                {"name": f, "priority": "high", "description": f}
                for f in ctx.must_have
            ],
        )
