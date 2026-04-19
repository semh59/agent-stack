"""
Skill Manager — ported from ai-stack agent/skill_manager.py.
Import paths updated; no Claude API dependency.
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class Skill:
    """Represents a discrete agentic capability."""

    def __init__(
        self,
        name: str,
        description: str,
        code: str,
        language: str = "python",
    ) -> None:
        self.name = name
        self.description = description
        self.code = code
        self.language = language


class SkillManager:
    """Manages registration and discovery of Skills."""

    def __init__(self, skills_dir: Path | None = None) -> None:
        self.skills_dir = skills_dir or (Path.home() / ".ai-stack-mcp" / "skills")
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self.registry: dict[str, Skill] = {}
        self._load_builtins()

    def _load_builtins(self) -> None:
        self.register_skill(Skill(
            name="log_analyzer",
            description="Analyzes large log files for error patterns and summaries.",
            code="""
import re, json, sys

def analyze_logs(text):
    patterns = [r'error', r'exception', r'fail', r'critical']
    lines = text.split('\\n')
    errors = []
    for i, line in enumerate(lines):
        for p in patterns:
            if re.search(p, line, re.IGNORECASE):
                errors.append({"line": i + 1, "content": line.strip()})
                break
    return {"total_lines": len(lines), "error_count": len(errors), "errors": errors[:10]}

if 'params' in globals() and 'content' in params:
    print(json.dumps(analyze_logs(params['content'])))
else:
    print(json.dumps({"status": "no_content_provided"}))
""",
        ))

        self.register_skill(Skill(
            name="code_refactor",
            description="Removes trailing whitespace and blank lines.",
            code="""
import json
def refactor(code):
    lines = code.split('\\n')
    refined = [l.rstrip() for l in lines if l.strip()]
    return {"original_lines": len(lines), "refined_lines": len(refined),
            "refined_code": '\\n'.join(refined)}
if 'params' in globals() and 'code' in params:
    print(json.dumps(refactor(params['code'])))
else:
    print(json.dumps({"status": "no_code_provided"}))
""",
        ))

    def register_skill(self, skill: Skill) -> None:
        self.registry[skill.name] = skill
        logger.debug(f"Skill registered: {skill.name}")

    def get_skill(self, name: str) -> Skill | None:
        return self.registry.get(name)

    def list_skills(self) -> list[dict[str, str]]:
        return [{"name": s.name, "description": s.description} for s in self.registry.values()]
