#!/usr/bin/env python3
"""
Project Context Initializer â€” generates CLAUDE.md, rules, and workflows
for any project opened in Claude Code.

Detects:
  - Language/framework (Python, Node, Go, Rust, Javaâ€¦)
  - Architecture (monolith, microservice, monorepo, library)
  - Microservices via docker-compose, multiple sub-package manifests
  - Build/test/start commands
  - CI/CD pipelines

Generates:
  - CLAUDE.md  (root + per-service for microservices)
  - .claude/rules/  (architecture, coding standards, anti-patterns)
  - .claude/commands/  (workflows: test, deploy, debug, review)
  - .claude/settings.json  (hooks that re-run this on new sessions)

Usage:
  python project_init.py [project_root] [--force] [--dry-run] [--check-only]

  --force       overwrite existing files
  --dry-run     print what would be written, don't touch disk
  --check-only  exit 0 if CLAUDE.md exists, exit 1 if not (for hooks)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class ServiceInfo:
    name: str
    path: str                          # relative to project root
    language: str
    frameworks: list[str] = field(default_factory=list)
    port: int | None = None
    dockerfile: str | None = None
    health_endpoint: str | None = None
    depends_on: list[str] = field(default_factory=list)
    test_dir: str | None = None
    entry_point: str | None = None
    description: str = ""


@dataclass
class ProjectInfo:
    root: Path
    name: str
    description: str
    architecture: str                  # monolith | microservice | monorepo | library
    languages: list[str]
    frameworks: list[str]
    services: list[ServiceInfo]        # populated for microservice / monorepo
    commands: dict[str, str]           # build | test | start | lint | deploy
    ci_provider: str | None            # github-actions | gitlab-ci | circleci | none
    has_docker: bool
    has_docker_compose: bool
    test_dirs: list[str]
    entry_point: str | None
    extra_notes: list[str] = field(default_factory=list)


def _truncate(s: str, limit: int = 200) -> str:
    """Type-safe string truncation (avoiding slice errors in strict environments)."""
    if len(s) <= limit:
        return s
    return "".join(s[i] for i in range(limit))


# ---------------------------------------------------------------------------
# Language / framework detection helpers
# ---------------------------------------------------------------------------

_LANG_MARKERS: list[tuple[list[str], str]] = [
    (["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"], "Python"),
    (["package.json"], "Node.js"),
    (["go.mod"], "Go"),
    (["Cargo.toml"], "Rust"),
    (["pom.xml", "build.gradle", "build.gradle.kts"], "Java"),
    (["*.csproj", "*.sln"], "C#"),
    (["mix.exs"], "Elixir"),
    (["pubspec.yaml"], "Dart/Flutter"),
    (["composer.json"], "PHP"),
    (["Gemfile"], "Ruby"),
]

_PYTHON_FRAMEWORKS = {
    "fastapi": "FastAPI", "flask": "Flask", "django": "Django",
    "starlette": "Starlette", "tornado": "Tornado", "aiohttp": "aiohttp",
    "pydantic": "Pydantic", "sqlalchemy": "SQLAlchemy", "alembic": "Alembic",
    "celery": "Celery", "pytest": "pytest", "uvicorn": "Uvicorn",
    "gunicorn": "Gunicorn", "typer": "Typer", "click": "Click",
    "langchain": "LangChain", "openai": "OpenAI SDK", "anthropic": "Anthropic SDK",
    "mcp": "MCP SDK", "llmlingua": "LLMLingua", "chromadb": "ChromaDB",
    "lancedb": "LanceDB", "httpx": "httpx", "aiofiles": "aiofiles",
}

_NODE_FRAMEWORKS = {
    "next": "Next.js", "react": "React", "vue": "Vue", "nuxt": "Nuxt",
    "express": "Express", "fastify": "Fastify", "nestjs": "@nestjs",
    "hono": "Hono", "prisma": "Prisma", "drizzle-orm": "Drizzle",
    "trpc": "tRPC", "tailwindcss": "Tailwind CSS", "vite": "Vite",
    "jest": "Jest", "vitest": "Vitest", "playwright": "Playwright",
    "typescript": "TypeScript", "tsx": "tsx",
}

_GO_FRAMEWORKS = {
    "gin-gonic/gin": "Gin", "labstack/echo": "Echo", "go-chi/chi": "Chi",
    "gofiber/fiber": "Fiber", "grpc": "gRPC", "gorm.io": "GORM",
}


def _detect_languages(root: Path) -> list[str]:
    langs: list[str] = []
    for markers, lang in _LANG_MARKERS:
        for marker in markers:
            if "*" in marker:
                if list(root.glob(marker)):
                    langs.append(lang)
                    break
            elif (root / marker).exists():
                langs.append(lang)
                break
    # Also scan one level deep for monorepos
    for child in root.iterdir():
        if child.is_dir() and not child.name.startswith("."):
            for markers, lang in _LANG_MARKERS:
                for marker in markers:
                    if "*" not in marker and (child / marker).exists():
                        if lang not in langs:
                            langs.append(lang)
                        break
    return langs or ["Unknown"]


def _detect_python_frameworks(root: Path) -> list[str]:
    found: list[str] = []
    # Check pyproject.toml
    pp = root / "pyproject.toml"
    if pp.exists():
        text = pp.read_text(encoding="utf-8", errors="ignore").lower()
        for key, name in _PYTHON_FRAMEWORKS.items():
            if key in text and name not in found:
                found.append(name)
    # Check requirements*.txt
    for req_file in root.glob("requirements*.txt"):
        text = req_file.read_text(encoding="utf-8", errors="ignore").lower()
        for key, name in _PYTHON_FRAMEWORKS.items():
            if key in text and name not in found:
                found.append(name)
    return found


def _detect_node_frameworks(root: Path) -> list[str]:
    found: list[str] = []
    pkg = root / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            all_deps = {
                **data.get("dependencies", {}),
                **data.get("devDependencies", {}),
            }
            for key, name in _NODE_FRAMEWORKS.items():
                if any(key in dep for dep in all_deps):
                    if name not in found:
                        found.append(name)
        except (json.JSONDecodeError, KeyError):
            pass
    return found


def _detect_frameworks(root: Path, languages: list[str]) -> list[str]:
    fw: list[str] = []
    if "Python" in languages:
        fw.extend(_detect_python_frameworks(root))
    if "Node.js" in languages:
        fw.extend(_detect_node_frameworks(root))
    if "Go" in languages:
        go_mod = root / "go.mod"
        if go_mod.exists():
            text = go_mod.read_text(encoding="utf-8", errors="ignore")
            for key, name in _GO_FRAMEWORKS.items():
                if key in text and name not in fw:
                    fw.append(name)
    return fw


def _detect_commands(root: Path, languages: list[str]) -> dict[str, str]:
    cmds: dict[str, str] = {}

    # Makefile targets
    makefile = root / "Makefile"
    if makefile.exists():
        text = makefile.read_text(encoding="utf-8", errors="ignore")
        for target in ("test", "build", "start", "run", "lint", "deploy"):
            if re.search(rf"^{target}:", text, re.M):
                cmds[target] = f"make {target}"

    # Python
    if "Python" in languages:
        if not cmds.get("test"):
            for runner in ("pytest", "python -m pytest"):
                if (root / "pytest.ini").exists() or (root / "pyproject.toml").exists():
                    cmds["test"] = "pytest tests/ -v"
                    break
        if (root / "pyproject.toml").exists():
            pp_text = (root / "pyproject.toml").read_text(encoding="utf-8", errors="ignore")
            scripts = re.findall(r'^\[tool\.poetry\.scripts\]\s*\n(.*?)(?=\[|\Z)', pp_text, re.M | re.S)
            if scripts:
                cmds.setdefault("start", f"python -m {root.name}")
        if not cmds.get("lint"):
            if (root / ".ruff.toml").exists() or "ruff" in (root / "pyproject.toml").read_text(encoding="utf-8", errors="ignore") if (root / "pyproject.toml").exists() else "":
                cmds["lint"] = "ruff check . && mypy src/"

    # Node.js
    if "Node.js" in languages:
        pkg = root / "package.json"
        if pkg.exists():
            try:
                scripts = json.loads(pkg.read_text()).get("scripts", {})
                for key in ("test", "build", "start", "dev", "lint"):
                    if key in scripts and key not in cmds:
                        cmds[key] = f"npm run {key}"
            except (json.JSONDecodeError, KeyError):
                pass

    # Docker Compose
    if (root / "docker-compose.yml").exists() or (root / "docker-compose.yaml").exists():
        cmds.setdefault("start", "docker compose up --build -d")
        cmds.setdefault("stop", "docker compose down")
        cmds.setdefault("logs", "docker compose logs -f")

    return cmds


def _detect_test_dirs(root: Path) -> list[str]:
    candidates = ["tests", "test", "__tests__", "spec", "specs", "e2e"]
    found: list[str] = []
    for c in candidates:
        if (root / c).is_dir():
            found.append(c)
    return found


def _detect_ci(root: Path) -> str | None:
    if (root / ".github" / "workflows").is_dir():
        return "github-actions"
    if (root / ".gitlab-ci.yml").exists():
        return "gitlab-ci"
    if (root / ".circleci").is_dir():
        return "circleci"
    if (root / "Jenkinsfile").exists():
        return "jenkins"
    return None


def _read_description(root: Path) -> str:
    """Try to extract a one-line description from README or package manifest."""
    for readme in ["README.md", "README.rst", "README.txt", "README"]:
        f = root / readme
        if f.exists():
            text = f.read_text(encoding="utf-8", errors="ignore")
            # First non-empty line after the title
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            for i, line in enumerate(lines):
                if line.startswith("#") and i + 1 < len(lines):
                    desc = lines[i + 1]
                    if not desc.startswith("#") and len(desc) > 10:
                        return _truncate(desc)
            if lines:
                return _truncate(lines[0].lstrip("#").strip())

    # package.json description
    pkg = root / "package.json"
    if pkg.exists():
        try:
            return _truncate(json.loads(pkg.read_text()).get("description", ""))
        except (json.JSONDecodeError, KeyError):
            pass

    # pyproject.toml description
    pp = root / "pyproject.toml"
    if pp.exists():
        m = re.search(r'description\s*=\s*["\']([^"\']+)', pp.read_text(encoding="utf-8", errors="ignore"))
        if m:
            return _truncate(m.group(1))

    return ""


# ---------------------------------------------------------------------------
# Microservice / monorepo detection
# ---------------------------------------------------------------------------

def _parse_docker_compose(root: Path) -> list[dict[str, Any]]:
    """Parse docker-compose.yml and return service dicts."""
    for name in ["docker-compose.yml", "docker-compose.yaml"]:
        f = root / name
        if not f.exists():
            continue
        try:
            import yaml  # type: ignore[import]
            data = yaml.safe_load(f.read_text(encoding="utf-8"))
        except ImportError:
            # yaml not available â€” parse crudely
            data = _crude_yaml_parse(f)
        except Exception:
            return []
        if isinstance(data, dict):
            return list(data.get("services", {}).items())
    return []


def _crude_yaml_parse(f: Path) -> dict[str, Any]:
    """Very rough docker-compose parser for when PyYAML isn't installed."""
    services: dict[str, Any] = {}
    current: str | None = None
    indent0 = None
    text = f.read_text(encoding="utf-8", errors="ignore")
    in_services = False

    for line in text.splitlines():
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(stripped)
        key = stripped.split(":")[0].strip()

        if stripped.startswith("services:"):
            in_services = True
            indent0 = indent
            continue

        if in_services:
            if isinstance(indent0, int) and indent == indent0 + 2 and ":" in stripped:
                # Service name
                current = key
                services[current] = {"ports": [], "depends_on": [], "image": None}
            elif current is not None and "image:" in stripped:
                services[current]["image"] = stripped.split(":", 1)[1].strip()
            elif current is not None and re.match(r"\s+-\s+\d+:\d+", line):
                port_match = re.search(r"(\d+):(\d+)", line)
                if port_match:
                    services[current]["ports"].append(int(port_match.group(2)))

    return {"services": services}


def _detect_services(root: Path) -> list[ServiceInfo]:
    """Detect microservices from docker-compose and sub-directories."""
    services: list[ServiceInfo] = []
    dc_services = _parse_docker_compose(root)

    for svc_name, svc_data in dc_services:
        if not isinstance(svc_data, dict):
            continue
        # Find the build context / service directory
        build = svc_data.get("build", {})
        if isinstance(build, str):
            svc_path = build
        elif isinstance(build, dict):
            svc_path = build.get("context", ".")
        else:
            svc_path = "."

        # Detect dockerfile
        dockerfile = None
        if isinstance(build, dict):
            df = build.get("dockerfile")
            if df:
                dockerfile = str(Path(svc_path) / df)
        else:
            for df_name in ["Dockerfile", f"Dockerfile.{svc_name}"]:
                candidate = root / svc_path / df_name
                if candidate.exists():
                    dockerfile = str(Path(svc_path) / df_name)
                    break

        # Detect port
        port = None
        ports = svc_data.get("ports", [])
        if ports:
            p = ports[0] if isinstance(ports[0], int) else str(ports[0]).split(":")[0]
            try:
                port = int(p)
            except (ValueError, TypeError):
                pass

        # Detect language for this service
        svc_root = root / svc_path if svc_path != "." else root
        langs = _detect_languages(svc_root) if svc_root.is_dir() else ["Unknown"]
        fws = _detect_frameworks(svc_root, langs) if svc_root.is_dir() else []

        # Health endpoint
        healthcheck = svc_data.get("healthcheck", {})
        health_ep = None
        if isinstance(healthcheck, dict):
            test = healthcheck.get("test", [])
            if isinstance(test, list):
                test_str = " ".join(str(t) for t in test)
            else:
                test_str = str(test)
            ep_match = re.search(r"https?://[^\s\"']+(/[^\s\"']*)", test_str)
            if ep_match:
                health_ep = ep_match.group(1)

        # depends_on
        dep = svc_data.get("depends_on", [])
        if isinstance(dep, dict):
            depends = list(dep.keys())
        elif isinstance(dep, list):
            depends = [str(d) for d in dep]
        else:
            depends = []

        # Detect service description from its own README / pyproject
        desc = _read_description(svc_root) if svc_root.is_dir() else ""

        svc = ServiceInfo(
            name=svc_name,
            path=svc_path,
            language=langs[0] if langs else "Unknown",
            frameworks=fws,
            port=port,
            dockerfile=dockerfile,
            health_endpoint=health_ep,
            depends_on=depends,
            test_dir=next(iter(_detect_test_dirs(svc_root)), None) if svc_root.is_dir() else None,
            description=desc,
        )
        services.append(svc)

    # Also detect monorepo sub-packages not in docker-compose
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        if child.name in {s.path.lstrip("./") for s in services}:
            continue
        # Is it a meaningful service dir? Must have its own manifest
        has_manifest = any((child / m).exists() for m in [
            "package.json", "pyproject.toml", "go.mod", "Cargo.toml",
            "pom.xml", "build.gradle",
        ])
        if has_manifest:
            langs = _detect_languages(child)
            fws = _detect_frameworks(child, langs)
            services.append(ServiceInfo(
                name=child.name,
                path=child.name,
                language=langs[0],
                frameworks=fws,
                test_dir=next(iter(_detect_test_dirs(child)), None),
                description=_read_description(child),
            ))

    return services


def _detect_architecture(root: Path, services: list[ServiceInfo]) -> str:
    if len(services) >= 2:
        # Multiple services with separate manifests or docker-compose = microservice
        has_compose = (root / "docker-compose.yml").exists() or (root / "docker-compose.yaml").exists()
        if has_compose:
            return "microservice"
        return "monorepo"
    # Library: no entry point, no Dockerfile, no server deps
    if (root / "pyproject.toml").exists():
        text = (root / "pyproject.toml").read_text(encoding="utf-8", errors="ignore")
        if "[tool.poetry]" in text and "packages" in text and "bin" not in text:
            return "library"
    return "monolith"


def _detect_entry_point(root: Path, languages: list[str]) -> str | None:
    candidates: list[str] = []
    if "Python" in languages:
        candidates += ["src/main.py", "main.py", "app.py", "server.py", "manage.py", "run.py"]
    if "Node.js" in languages:
        candidates += ["src/index.ts", "index.ts", "src/index.js", "index.js", "src/main.ts", "server.ts"]
    if "Go" in languages:
        candidates += ["cmd/main.go", "main.go"]
    for c in candidates:
        if (root / c).exists():
            return c
    return None


# ---------------------------------------------------------------------------
# Main analysis entry point
# ---------------------------------------------------------------------------

def analyze_project(root: Path) -> ProjectInfo:
    root = root.resolve()
    name = root.name
    description = _read_description(root)
    languages = _detect_languages(root)
    frameworks = _detect_frameworks(root, languages)
    services = _detect_services(root)
    architecture = _detect_architecture(root, services)
    commands = _detect_commands(root, languages)
    ci = _detect_ci(root)
    has_docker = any((root / df).exists() for df in ["Dockerfile"] + [f"Dockerfile.{s.name}" for s in services])
    has_compose = (root / "docker-compose.yml").exists() or (root / "docker-compose.yaml").exists()
    test_dirs = _detect_test_dirs(root)
    entry = _detect_entry_point(root, languages)

    extra: list[str] = []
    if (root / ".env.example").exists() or (root / ".env.sample").exists():
        extra.append("Copy `.env.example` to `.env` and fill in secrets before running.")
    if (root / "CONTRIBUTING.md").exists():
        extra.append("See `CONTRIBUTING.md` for contribution guidelines.")
    if (root / "CHANGELOG.md").exists() or (root / "CHANGELOG").exists():
        extra.append("See `CHANGELOG.md` for version history.")

    return ProjectInfo(
        root=root,
        name=name,
        description=description,
        architecture=architecture,
        languages=languages,
        frameworks=frameworks,
        services=services,
        commands=commands,
        ci_provider=ci,
        has_docker=has_docker,
        has_docker_compose=has_compose,
        test_dirs=test_dirs,
        entry_point=entry,
        extra_notes=extra,
    )


# ---------------------------------------------------------------------------
# CLAUDE.md generators
# ---------------------------------------------------------------------------

def _fmt_list(items: list[str], bullet: str = "-") -> str:
    return "\n".join(f"{bullet} {i}" for i in items) if items else "_(none detected)_"


def _fmt_commands(cmds: dict[str, str]) -> str:
    if not cmds:
        return "_(none detected)_"
    lines = []
    for key, val in cmds.items():
        lines.append(f"```bash\n{val}  # {key}\n```")
    return "\n".join(lines)


def generate_root_claude_md(info: ProjectInfo) -> str:
    arch_desc = {
        "monolith": "Single-service application",
        "microservice": f"Microservice architecture ({len(info.services)} services)",
        "monorepo": f"Monorepo ({len(info.services)} packages)",
        "library": "Library / package",
    }.get(info.architecture, info.architecture)

    svc_table = ""
    if info.services:
        rows: list[str] = []
        for s in info.services:
            port_str = str(s.port) if s.port else "â€”"
            if s.frameworks:
                fw_str = ", ".join(s.frameworks[i] for i in range(min(2, len(s.frameworks))))
            else:
                fw_str = "â€”"
            path_str = s.path if s.path != "." else "(root)"
            rows.append(f"| `{s.name}` | `{path_str}` | {s.language} | {fw_str} | {port_str} |")
        svc_table = (
            "\n## Services\n\n"
            "| Service | Path | Language | Framework | Port |\n"
            "|---------|------|----------|-----------|------|\n"
            + "\n".join(rows) + "\n"
        )

    commands_section = ""
    if info.commands:
        commands_section = "\n## Commands\n\n```bash\n"
        for key, val in info.commands.items():
            commands_section += f"{val}  # {key}\n"
        commands_section += "```\n"

    ci_section = ""
    if info.ci_provider:
        ci_section = f"\n## CI/CD\n\nProvider: **{info.ci_provider}**\n"

    notes_section = ""
    if info.extra_notes:
        notes_section = "\n## Notes\n\n" + "\n".join(f"- {n}" for n in info.extra_notes) + "\n"

    entry_section = ""
    if info.entry_point:
        entry_section = f"\n**Entry point:** `{info.entry_point}`"

    return textwrap.dedent(f"""\
        # {info.name}

        {info.description or "_(add a description here)_"}

        ## Overview

        - **Architecture:** {arch_desc}
        - **Language(s):** {", ".join(info.languages)}
        - **Framework(s):** {", ".join(info.frameworks) or "_(none detected)_"}
        - **Test dirs:** {", ".join(f"`{d}`" for d in info.test_dirs) or "_(none detected)_"}
        - **Docker:** {"yes" if info.has_docker else "no"} | **Compose:** {"yes" if info.has_docker_compose else "no"}{entry_section}
        {svc_table}{commands_section}{ci_section}{notes_section}
        ## Architecture Notes

        _(Fill in: key design decisions, non-obvious constraints, things Claude must know.)_

        ## Coding Conventions

        _(Fill in: naming style, async patterns, error handling approach, forbidden patterns.)_

        ## Working with This Project

        - Always read `CLAUDE.md` in a service subdirectory before editing that service.
        - Run tests before committing: `{info.commands.get("test", "see Commands above")}`
        - Do not hardcode secrets â€” use environment variables / config layer.
        """)


def generate_service_claude_md(svc: ServiceInfo, project: ProjectInfo) -> str:
    deps = ", ".join(f"`{d}`" for d in svc.depends_on) if svc.depends_on else "none"
    health = f"`{svc.health_endpoint}`" if svc.health_endpoint else "_(not configured)_"
    port = str(svc.port) if svc.port else "_(not configured)_"
    test_dir = f"`{svc.test_dir}`" if svc.test_dir else "_(none detected)_"

    return textwrap.dedent(f"""\
        # {svc.name}

        {svc.description or "_(add a description here)_"}

        ## Role in `{project.name}`

        _(Describe what this service is responsible for and what it is NOT responsible for.)_

        ## Stack

        - **Language:** {svc.language}
        - **Frameworks:** {", ".join(svc.frameworks) or "_(none detected)_"}
        - **Port:** {port}
        - **Health endpoint:** {health}
        - **Dockerfile:** `{svc.dockerfile or "not found"}`
        - **Test directory:** {test_dir}

        ## Dependencies

        Depends on: {deps}

        ## API / Interface

        _(List key endpoints or public interface here.)_

        ## Environment Variables

        _(List required env vars and their purpose.)_

        ## Development

        ```bash
        # Run this service alone
        docker compose up {svc.name} --build

        # Tests
        {f"pytest {svc.test_dir}/ -v" if svc.test_dir and svc.language == "Python" else
          f"cd {svc.path} && npm test" if svc.language == "Node.js" else
          "# see project root commands"}
        ```

        ## Coding Conventions for This Service

        _(Service-specific patterns, forbidden patterns, important decisions.)_
        """)


# ---------------------------------------------------------------------------
# Rules generators
# ---------------------------------------------------------------------------

def generate_rules(info: ProjectInfo) -> dict[str, str]:
    rules: dict[str, str] = {}

    # architecture.md
    if info.architecture == "microservice":
        svc_names = [s.name for s in info.services]
        rules["architecture.md"] = textwrap.dedent(f"""\
            # Architecture Rules

            ## Service Boundaries
            - Do NOT add business logic to a service other than its designated responsibility.
            - Do NOT call a downstream service's database directly â€” go through its API.
            - Services: {", ".join(svc_names)}

            ## Communication
            - Prefer async messaging for non-critical paths.
            - Synchronous HTTP calls must have explicit timeouts.
            - Shared data structures must be defined in a contracts/schema layer.

            ## Deployability
            - Each service must be independently deployable.
            - Health endpoints must respond within 200ms.
            - Container startup must succeed without depending on other services being up (use retry/backoff).
            """)
    elif info.architecture == "monorepo":
        rules["architecture.md"] = textwrap.dedent("""\
            # Architecture Rules

            ## Package Boundaries
            - Do NOT import from a sibling package's internal (`src/`) modules â€” only from its public API.
            - Shared utilities go in a dedicated `packages/shared` or `libs/` directory.
            - Each package must maintain its own test suite.
            """)
    else:
        rules["architecture.md"] = textwrap.dedent("""\
            # Architecture Rules

            ## Layering
            - Keep I/O (HTTP, DB, file) at the edges; business logic in the core.
            - Do NOT mix infrastructure code with domain logic.
            - Configuration via environment variables, never hardcoded.
            """)

    # coding-standards.md
    standards: list[str] = []
    if "Python" in info.languages:
        standards += [
            "All I/O must be `async/await` â€” no blocking calls on the event loop.",
            "Type annotations required on all public functions and class attributes.",
            "Use `httpx.AsyncClient` with explicit `timeout=` on every HTTP call.",
            "Pydantic models for all structured data (API bodies, config, responses).",
            "No bare `except Exception` without re-raise or structured log at WARNING+.",
            "Use `structlog` for structured logging â€” never `print()` in production code.",
        ]
    if "Node.js" in info.languages:
        standards += [
            "TypeScript strict mode â€” no `any` without a comment explaining why.",
            "Async/await over callbacks and raw Promise chains.",
            "Zod or equivalent for runtime schema validation at API boundaries.",
            "No `console.log` in production code â€” use a logger (pino, winston).",
        ]
    if "Go" in info.languages:
        standards += [
            "Always check and handle errors â€” no `_` discards on errors.",
            "Context propagation: every function that does I/O takes `ctx context.Context` as first param.",
            "No global mutable state.",
        ]

    anti_patterns: list[str] = [
        "Do NOT hardcode secrets, tokens, or passwords.",
        "Do NOT write code that only handles the happy path â€” always consider failure modes.",
        "Do NOT create helpers or abstractions for one-time use.",
        "Do NOT add comments that just restate what the code does.",
        "Do NOT skip tests for bug fixes.",
    ]

    rules["coding-standards.md"] = textwrap.dedent(f"""\
        # Coding Standards

        ## Conventions
        {_fmt_list(standards)}

        ## Anti-Patterns (Never Do These)
        {_fmt_list(anti_patterns)}

        ## Naming
        _(Fill in: file naming, function naming, variable naming conventions.)_

        ## Error Handling
        _(Fill in: how errors are surfaced to callers, logging strategy, retry policy.)_
        """)

    # security.md
    rules["security.md"] = textwrap.dedent("""\
        # Security Rules

        - Never log secrets, tokens, passwords, or PII.
        - Validate all external input at system boundaries (API, file upload, CLI args).
        - SQL queries must use parameterized statements â€” no string formatting of user input.
        - HTTP clients must verify TLS certificates (no `verify=False` without documented reason).
        - Dependency versions must be pinned in lock files.
        - Do NOT disable security linters or ignore security warnings without a comment explaining why.
        """)

    return rules


# ---------------------------------------------------------------------------
# Workflow / command generators
# ---------------------------------------------------------------------------

def generate_commands(info: ProjectInfo) -> dict[str, str]:
    cmds: dict[str, str] = {}

    test_cmd = info.commands.get("test", "# add your test command here")
    lint_cmd = info.commands.get("lint", "# add your lint command here")

    cmds["test.md"] = textwrap.dedent(f"""\
        # Run Tests

        ```bash
        {test_cmd}
        ```

        For a single file:
        ```bash
        # Python
        pytest path/to/test_file.py -v -k "test_name"
        # Node
        npm test -- --testPathPattern=filename
        ```

        For coverage:
        ```bash
        # Python
        pytest {info.test_dirs[0] + "/" if info.test_dirs else "tests/"}  --cov=src --cov-report=term-missing
        # Node
        npm test -- --coverage
        ```
        """)

    cmds["debug.md"] = textwrap.dedent(f"""\
        # Debug a Failing Test or Bug

        1. Reproduce the issue with a minimal test case.
        2. Add targeted logging (use `structlog` / logger, not print).
        3. Check recent changes: `git log --oneline -20`
        4. Isolate the failing component â€” run just that service/module.
        5. Check external dependencies (DB, cache, third-party APIs) are reachable.

        Useful commands:
        ```bash
        # Check logs
        {info.commands.get("logs", "docker compose logs -f")}

        # Check service health
        {info.commands.get("start", "docker compose ps")}
        ```
        """)

    cmds["add-feature.md"] = textwrap.dedent(f"""\
        # Add a New Feature

        1. Read the relevant service's `CLAUDE.md` and architecture rules.
        2. Write the test first (or alongside) â€” do not add untested code.
        3. Implement the feature in the correct layer (no mixing I/O with business logic).
        4. Update CLAUDE.md if the feature changes architecture or conventions.
        5. Run the full test suite:
           ```bash
           {test_cmd}
           ```
        6. Run linter:
           ```bash
           {lint_cmd}
           ```
        """)

    cmds["code-review.md"] = textwrap.dedent(f"""\
        # Code Review Checklist

        Before submitting or reviewing a PR:

        - [ ] Tests cover the new/changed behaviour (not just happy path)
        - [ ] No hardcoded secrets or config values
        - [ ] Error cases are handled
        - [ ] CLAUDE.md updated if architecture/conventions changed
        - [ ] No new lint warnings: `{lint_cmd}`
        - [ ] All tests pass: `{test_cmd}`
        - [ ] No unintended changes to unrelated files
        - [ ] Commit messages are meaningful (why, not just what)
        """)

    if info.has_docker_compose:
        cmds["docker.md"] = textwrap.dedent(f"""\
            # Docker Workflows

            ```bash
            # Start full stack
            {info.commands.get("start", "docker compose up --build -d")}

            # Stop
            {info.commands.get("stop", "docker compose down")}

            # View logs
            {info.commands.get("logs", "docker compose logs -f")}

            # Rebuild a single service
            docker compose up --build <service-name> -d

            # Open shell in a container
            docker compose exec <service-name> /bin/sh

            # Run tests inside the container
            docker compose run --rm <service-name> {test_cmd}
            ```
            """)

    return cmds


# ---------------------------------------------------------------------------
# Hook / settings generator
# ---------------------------------------------------------------------------

def generate_claude_settings(project_root: Path) -> dict[str, Any]:
    """
    Generate .claude/settings.json with a UserPromptSubmit hook that
    re-runs project_init.py at the start of each new session if CLAUDE.md
    is missing or outdated.
    """
    init_script = str(project_root / "scripts" / "project_init.py")
    # Use relative path if script is within the project
    try:
        rel = Path(init_script).relative_to(project_root)
        script_cmd = f"python {rel}"
    except ValueError:
        script_cmd = f"python \"{init_script}\""

    return {
        "hooks": {
            "UserPromptSubmit": [
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": (
                                f"{script_cmd} . --check-only || "
                                f"{script_cmd} ."
                            ),
                        }
                    ],
                }
            ]
        }
    }


# ---------------------------------------------------------------------------
# File writer
# ---------------------------------------------------------------------------

class FileWriter:
    def __init__(self, root: Path, dry_run: bool = False, force: bool = False):
        self.root = root
        self.dry_run = dry_run
        self.force = force
        self.written: list[str] = []
        self.skipped: list[str] = []

    def write(self, rel_path: str, content: str) -> None:
        target = self.root / rel_path
        if target.exists() and not self.force:
            self.skipped.append(rel_path)
            return
        if self.dry_run:
            print(f"  [dry-run] would write: {rel_path}")
            self.written.append(rel_path)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        self.written.append(rel_path)
        print(f"  [write] {rel_path}")

    def write_json(self, rel_path: str, data: dict[str, Any]) -> None:
        self.write(rel_path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")

    def report(self) -> None:
        print(f"\nDone: {len(self.written)} written, {len(self.skipped)} skipped (use --force to overwrite)")
        if self.skipped:
            print("  Skipped:", ", ".join(self.skipped))


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run(project_root: Path, dry_run: bool = False, force: bool = False) -> None:
    print(f"\nAnalyzing project: {project_root}")
    info = analyze_project(project_root)

    print(f"  Name        : {info.name}")
    print(f"  Architecture: {info.architecture}")
    print(f"  Languages   : {', '.join(info.languages)}")
    print(f"  Frameworks  : {', '.join(info.frameworks) or 'none'}")
    if info.services:
        print(f"  Services    : {', '.join(s.name for s in info.services)}")
    print()

    w = FileWriter(project_root, dry_run=dry_run, force=force)

    # Root CLAUDE.md
    w.write("CLAUDE.md", generate_root_claude_md(info))

    # Per-service CLAUDE.md (microservice / monorepo)
    for svc in info.services:
        if svc.path and svc.path != ".":
            w.write(f"{svc.path}/CLAUDE.md", generate_service_claude_md(svc, info))

    # Rules
    for filename, content in generate_rules(info).items():
        w.write(f".claude/rules/{filename}", content)

    # Commands / workflows
    for filename, content in generate_commands(info).items():
        w.write(f".claude/commands/{filename}", content)

    # .claude/settings.json (only if it doesn't exist â€” never force-overwrite settings)
    settings_path = project_root / ".claude" / "settings.json"
    if not settings_path.exists():
        w.write_json(".claude/settings.json", generate_claude_settings(project_root))
    else:
        print("  [skip] .claude/settings.json â€” already exists, not touched")

    w.report()
    bootstrap_spacy()


def bootstrap_spacy():
    """Ensure spaCy model is installed if spaCy is present."""
    try:
        import spacy
        try:
            spacy.load("en_core_web_sm")
            print("  [mcp] spaCy model 'en_core_web_sm' is already installed.")
        except OSError:
            print("  [mcp] Installing spaCy model 'en_core_web_sm'...")
            import subprocess
            subprocess.run([sys.executable, "-m", "spacy", "download", "en_core_web_sm"],
                           check=True, capture_output=True)
            print("  [mcp] Success.")
    except ImportError:
        pass  # spacy not in this environment


def _resolve_root(root_arg: str) -> Path:
    """
    Resolve the project root directory.

    Priority:
      1. Explicit argument (not ".")
      2. CLAUDE_PROJECT_DIR env var  (set by Claude Code hooks)
      3. Current working directory
    """
    if root_arg and root_arg != ".":
        return Path(root_arg).resolve()
    env_dir = os.environ.get("CLAUDE_PROJECT_DIR", "").strip()
    if env_dir:
        return Path(env_dir).resolve()
    return Path.cwd().resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Claude Code project context files")
    parser.add_argument("root", nargs="?", default=".", help="Project root directory")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be written without writing")
    parser.add_argument("--check-only", action="store_true",
                        help="Exit 0 if CLAUDE.md exists, exit 1 if not (for hooks)")
    parser.add_argument("--auto", action="store_true",
                        help="Hook mode: read project root from CLAUDE_PROJECT_DIR env var, "
                             "generate only if CLAUDE.md is missing (idempotent, cross-platform)")
    args = parser.parse_args()

    root = _resolve_root(args.root)

    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        sys.exit(2)

    if args.check_only:
        sys.exit(0 if (root / "CLAUDE.md").exists() else 1)

    # --auto: idempotent hook mode â€” only run if CLAUDE.md is missing
    if args.auto:
        if (root / "CLAUDE.md").exists():
            sys.exit(0)   # already initialised â€” silent no-op
        run(root, dry_run=False, force=False)
        return

    run(root, dry_run=args.dry_run, force=args.force)


if __name__ == "__main__":
    main()
