"""
Skill Manager â€” ported from ai-stack agent/skill_manager.py.
Import paths updated; no Claude API dependency.
"""
from __future__ import annotations

import io
import contextlib
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class Skill:
    """Represents a discrete agentic capability."""

    # Patterns that should never appear in skill code (security sandbox)
    _FORBIDDEN_PATTERNS = (
        "__import__",
        "__builtins__",
        "import os",
        "import sys",
        "import subprocess",
        "import shutil",
        "import pathlib",
        "eval(",
        "compile(",
    )

    def __init__(
        self,
        name: str,
        description: str,
        code: str,
        language: str = "python",
    ) -> None:
        if not name or not name.replace("_", "").replace("-", "").isalnum():
            raise ValueError(f"Invalid skill name: {name!r}")
        self.name = name
        self.description = description
        self.code = code
        self.language = language

    def validate_code(self) -> list[str]:
        """Return a list of security warnings found in the skill code."""
        warnings: list[str] = []
        for pattern in self._FORBIDDEN_PATTERNS:
            if pattern in self.code:
                warnings.append(f"Forbidden pattern found: {pattern!r}")
        return warnings


class SkillManager:
    """Manages registration and discovery of Skills."""

    def __init__(self, skills_dir: Path | None = None) -> None:
        self.skills_dir = skills_dir or (Path.home() / ".bridge" / "skills")
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self.registry: dict[str, Skill] = {}
        self._load_builtins_safe()

    @staticmethod
    def _make_safe_globals() -> dict:
        """Create a restricted globals dict for safe skill execution."""
        import re as _re

        return {
            "__builtins__": {
                "print": print,
                "len": len,
                "range": range,
                "enumerate": enumerate,
                "str": str,
                "int": int,
                "float": float,
                "bool": bool,
                "list": list,
                "dict": dict,
                "set": set,
                "tuple": tuple,
                "isinstance": isinstance,
                "sorted": sorted,
                "min": min,
                "max": max,
                "sum": sum,
                "abs": abs,
                "True": True,
                "False": False,
                "None": None,
            },
            "json": json,
            "re": _re,
        }

    def execute_skill_safe(self, name: str, params: dict) -> dict:
        """Execute a registered skill in a sandboxed namespace."""
        skill = self.registry.get(name)
        if skill is None:
            return {"error": f"Unknown skill: {name}"}
        safe_ns = self._make_safe_globals()
        safe_ns["params"] = params
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            exec(skill.code, safe_ns)  # noqa: S102
        try:
            return json.loads(buf.getvalue().strip())
        except json.JSONDecodeError:
            return {"raw_output": buf.getvalue().strip()}

    def _load_builtins_safe(self) -> None:
        """Load built-in skills with validated code."""
        self.register_skill(Skill(
            name="log_analyzer",
            description="Analyzes large log files for error patterns and summaries.",
            code="""
import re, json

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

if 'params' in dir() and 'content' in params:
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
if 'params' in dir() and 'code' in params:
    print(json.dumps(refactor(params['code'])))
else:
    print(json.dumps({"status": "no_code_provided"}))
""",
        ))

    def register_skill(self, skill: Skill) -> None:
        warnings = skill.validate_code()
        if warnings:
            raise ValueError(
                f"Skill {skill.name!r} contains forbidden patterns: {'; '.join(warnings)}"
            )
        self.registry[skill.name] = skill
        logger.debug("Skill registered: %s", skill.name)

    def get_skill(self, name: str) -> Skill | None:
        return self.registry.get(name)

    def list_skills(self) -> list[dict[str, str]]:
        return [{"name": s.name, "description": s.description} for s in self.registry.values()]
