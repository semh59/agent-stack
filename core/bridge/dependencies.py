"""
Dependency health check and Capability Matrix for Agent Stack MCP.
Validates all core and optional libraries.
"""
from __future__ import annotations

import importlib.util
from dataclasses import dataclass, field


@dataclass
class DependencyStatus:
    name: str
    installed: bool
    version: str | None = None
    required: bool = False
    description: str = ""


@dataclass
class CapabilityMatrix:
    core_mcp: bool = False
    semantic_cache: bool = False
    rag: bool = False
    advanced_compression: bool = False
    data_analysis: bool = False
    metrics: bool = False

    missing_critical: list[str] = field(default_factory=list)
    missing_optional: list[str] = field(default_factory=list)


def check_dependencies() -> tuple[list[DependencyStatus], CapabilityMatrix]:
    """
    Scan environment for required and optional packages.
    Returns (List of statuses, CapabilityMatrix).
    """
    packages = [
        # (name, required, description)
        ("mcp", True, "Model Context Protocol SDK"),
        ("pydantic", True, "Data validation"),
        ("httpx", True, "Async HTTP client"),
        ("structlog", True, "Structured logging"),
        ("chromadb", False, "Semantic caching"),
        ("lancedb", False, "RAG vector storage"),
        ("llmlingua", False, "Advanced prompt compression"),
        ("spacy", False, "NLP cleaning/detection"),
        ("sklearn", False, "Semantic routing / ML"),
        ("prometheus_client", False, "Metrics server"),
        ("aiohttp", False, "HTTP bridge server"),
    ]

    statuses: list[DependencyStatus] = []
    matrix = CapabilityMatrix()

    for name, required, desc in packages:
        spec = importlib.util.find_spec(name)
        installed = spec is not None
        version = None

        if installed:
            try:
                pkg = importlib.import_module(name)
                version = getattr(pkg, "__version__", "unknown")
            except Exception:
                version = "unknown"

        status = DependencyStatus(name, installed, version, required, desc)
        statuses.append(status)

        if not installed:
            if required:
                matrix.missing_critical.append(name)
            else:
                matrix.missing_optional.append(name)

    # Build Capability Matrix
    matrix.core_mcp = _is_ok(statuses, "mcp")
    matrix.semantic_cache = _is_ok(statuses, "chromadb")
    matrix.rag = _is_ok(statuses, "lancedb")
    matrix.advanced_compression = _is_ok(statuses, "llmlingua")
    matrix.data_analysis = _is_ok(statuses, "sklearn")
    matrix.metrics = _is_ok(statuses, "prometheus_client")

    return statuses, matrix


def _is_ok(statuses: list[DependencyStatus], name: str) -> bool:
    return any(s.name == name and s.installed for s in statuses)


def get_capability_report(matrix: CapabilityMatrix) -> str:
    """Returns a human-readable summary of what's available."""
    lines = ["--- AI Stack Capability Matrix ---"]
    lines.append(f"Core MCP:         {'[OK]' if matrix.core_mcp else '[FAILED]'}")
    lines.append(f"Semantic Cache:   {'[OK]' if matrix.semantic_cache else '[DISABLED]'}")
    lines.append(f"RAG:              {'[OK]' if matrix.rag else '[DISABLED]'}")
    lines.append(f"LLMLingua:        {'[OK]' if matrix.advanced_compression else '[DISABLED]'}")
    lines.append(f"Data Analysis:    {'[OK]' if matrix.data_analysis else '[DISABLED]'}")
    lines.append(f"Metrics:          {'[OK]' if matrix.metrics else '[DISABLED]'}")

    if matrix.missing_optional:
        lines.append(f"\nMissing optional: {', '.join(matrix.missing_optional)}")
    if matrix.missing_critical:
        lines.append(f"\nCRITICAL MISSING: {', '.join(matrix.missing_critical)}")

    return "\n".join(lines)
