"""
DiscoveryAgent â€” kullanÄ±cÄ±nÄ±n amacÄ±nÄ± anlar, eksik bilgileri sorar.

AkÄ±ÅŸ:
1. KullanÄ±cÄ± prompt alÄ±nÄ±r
2. Belirsizlikler tespit edilir (hedef kitle, teknoloji, kÄ±sÄ±tlar)
3. NetleÅŸtirme sorularÄ± Ã¼retilir
4. YanÄ±tlarla birlikte tam bir baÄŸlam oluÅŸturulur
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import structlog  # type: ignore

logger = structlog.get_logger(__name__)


@dataclass
class DiscoveryContext:
    """KullanÄ±cÄ±nÄ±n niyetine dair toplanmÄ±ÅŸ bilgiler."""
    raw_prompt: str
    clarified_goal: str = ""
    target_audience: str = ""
    tech_constraints: list[str] = field(default_factory=list)
    must_have: list[str] = field(default_factory=list)
    nice_to_have: list[str] = field(default_factory=list)
    clarification_rounds: int = 0

    def is_complete(self) -> bool:
        """Yeterli bilgi toplandÄ± mÄ±?"""
        return bool(
            self.clarified_goal
            and (self.must_have or self.clarification_rounds >= 2)
        )

    def to_spec_prompt(self) -> str:
        """SpecGenerator'a verilecek baÄŸlam metnini oluÅŸturur."""
        parts = [f"Hedef: {self.clarified_goal}"]
        if self.target_audience:
            parts.append(f"Hedef kitle: {self.target_audience}")
        if self.tech_constraints:
            parts.append(f"Teknoloji kÄ±sÄ±tlarÄ±: {', '.join(self.tech_constraints)}")
        if self.must_have:
            parts.append(f"Olmazsa olmaz: {', '.join(self.must_have)}")
        if self.nice_to_have:
            parts.append(f"Ä°yi olur: {', '.join(self.nice_to_have)}")
        return "\n".join(parts)


class DiscoveryAgent:
    """
    KullanÄ±cÄ± amacÄ±nÄ± netleÅŸtirir.
    LLM Ã§aÄŸrÄ±sÄ± iÃ§in provider_router kullanÄ±r.
    """

    SYSTEM_PROMPT = (
        "Sen bir yazÄ±lÄ±m danÄ±ÅŸmanÄ±sÄ±n. KullanÄ±cÄ±nÄ±n ne yapmak istediÄŸini "
        "anlamak iÃ§in kÄ±sa, net sorular sor. Teknik jargondan kaÃ§Ä±n. "
        "Maksimum 3 soru sor, her biri tek cÃ¼mle.\n\n"
        "RCF NOTU: BaÄŸlam iÃ§inde {'@rcf': '...', 'delta': {...}} formatÄ±nda "
        "katlanmÄ±ÅŸ veriler alabilirsin. BunlarÄ± bilinen yapÄ±lar Ã¼zerine "
        "delta bilgilerini ekleyerek zihninde geri aÃ§ ve tam baÄŸlamla yanÄ±t ver."
    )

    def __init__(self, provider_router: Any) -> None:
        self.provider_router = provider_router

    async def discover(self, prompt: str) -> DiscoveryContext:
        """
        Tek turda discovery yapar.
        DÃ¶nen context.is_complete() False ise daha fazla tur gerekir.
        """
        ctx = DiscoveryContext(raw_prompt=prompt)

        analysis_prompt = (
            f"KullanÄ±cÄ± ÅŸunu sÃ¶yledi: '{prompt}'\n\n"
            "JSON formatÄ±nda yanÄ±tla:\n"
            "{\n"
            '  "clarified_goal": "...",\n'
            '  "target_audience": "...",\n'
            '  "tech_constraints": [],\n'
            '  "must_have": [],\n'
            '  "nice_to_have": [],\n'
            '  "clarification_questions": []\n'
            "}"
        )

        try:
            response = await self.provider_router.route_call(
                model="tier0-prose",
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": analysis_prompt},
                ],
                temperature=0.3,
                max_tokens=800,
            )
            raw = response["choices"][0]["message"]["content"]
            # JSON bloÄŸunu Ã§Ä±kar
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(raw[start:end])
                ctx.clarified_goal   = data.get("clarified_goal", "")
                ctx.target_audience  = data.get("target_audience", "")
                ctx.tech_constraints = data.get("tech_constraints", [])
                ctx.must_have        = data.get("must_have", [])
                ctx.nice_to_have     = data.get("nice_to_have", [])
        except Exception as exc:
            logger.warning("discovery_failed", error=str(exc))

        # Robust fallback: if nothing captured from LLM, use original prompt
        if not ctx.clarified_goal:
            ctx.clarified_goal = prompt

        ctx.clarification_rounds += 1
        return ctx
