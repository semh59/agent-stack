"""
AI Stack MCP Server â€” entry point.

Claude Code baÄŸlandÄ±ÄŸÄ±nda stdio Ã¼zerinden tool Ã§aÄŸrÄ±larÄ± alÄ±r.
TÃ¼m optimizasyon iÅŸlemleri bu server Ã¼zerinden yÃ¼rÃ¼r.

KullanÄ±m:
  python server.py

.mcp.json ile Claude Code'a entegre olur:
  {
    "mcpServers": {
      "ai-stack": { "command": "python", "args": ["server.py"], "cwd": "<bu dizin>" }
    }
  }
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

# MCP SDK
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp import types as mcp_types
except ImportError as exc:
    print(
        f"[bridge] mcp paketi bulunamadÄ±: {exc}\n"
        "  pip install mcp",
        file=sys.stderr,
    )
    sys.exit(1)

import structlog

from config import settings
from pipeline.optimization_pipeline import OptimizationPipeline
from metrics import start_metrics_server

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Server instance
# ---------------------------------------------------------------------------

server: Server = Server("ai-stack")
_orchestrator: OptimizationPipeline | None = None
_orch_lock: asyncio.Lock | None = None


def _get_orch_lock() -> asyncio.Lock:
    """Lazily create Lock to avoid event-loop attachment issues at import time."""
    global _orch_lock
    if _orch_lock is None:
        _orch_lock = asyncio.Lock()
    return _orch_lock


async def _get_orch() -> OptimizationPipeline:
    """
    Lazily initializes the OptimizationPipeline.
    Tool Deferral: Only intensive components are loaded upon first meaningful tool call.
    """
    global _orchestrator
    if _orchestrator is None:
        async with _get_orch_lock():
            if _orchestrator is None:
                logger.info("mcp_tool_orchestrator_lazy_init")
                orch = OptimizationPipeline(settings)
                # Note: initialize() is called inside each tool to ensure deferred loading
                _orchestrator = orch
    return _orchestrator


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

@server.list_tools()
async def list_tools() -> list[mcp_types.Tool]:
    return [
        mcp_types.Tool(
            name="optimize_context",
            description=(
                "Token optimizasyonu uygula. MesajÄ± temizler, sÄ±kÄ±ÅŸtÄ±rÄ±r, "
                "cache'e bakar ve hangi modelin kullanÄ±lmasÄ± gerektiÄŸini sÃ¶yler. "
                "Optimized metin + token tasarruf raporu dÃ¶ner."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Optimize edilecek mesaj",
                    },
                    "context_messages": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Ã–nceki mesajlar (semantik cache baÄŸlamÄ± iÃ§in)",
                        "default": [],
                    },
                    "force_layers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Zorla uygulanacak katmanlar (test/debug iÃ§in)",
                        "default": None,
                    },
                },
                "required": ["message"],
            },
        ),
        mcp_types.Tool(
            name="search_docs",
            description="RAG ile belge iÃ§inde semantik arama yap.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "default": 3, "minimum": 1, "maximum": 20},
                },
                "required": ["query"],
            },
        ),
        mcp_types.Tool(
            name="index_document",
            description="Belgeyi RAG indeksine ekle veya gÃ¼ncelle (hash ile dedup).",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "path": {"type": "string", "description": "Belge yolu (tanÄ±mlayÄ±cÄ±)"},
                },
                "required": ["content", "path"],
            },
        ),
        mcp_types.Tool(
            name="get_cost_report",
            description="Token tasarruf raporu dÃ¶ner (gÃ¼nlÃ¼k/haftalÄ±k/aylÄ±k).",
            inputSchema={
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["today", "week", "month"],
                        "default": "today",
                    },
                },
            },
        ),
        mcp_types.Tool(
            name="cache_stats",
            description="Cache hit rate ve doluluk durumu.",
            inputSchema={"type": "object", "properties": {}},
        ),
        mcp_types.Tool(
            name="clear_cache",
            description="Cache'i temizle.",
            inputSchema={
                "type": "object",
                "properties": {
                    "tier": {
                        "type": "string",
                        "enum": ["all", "memory", "disk", "semantic"],
                        "default": "all",
                    },
                },
            },
        ),
        mcp_types.Tool(
            name="set_model_preference",
            description="Model tercihini manuel ayarla (ollama/openrouter/auto).",
            inputSchema={
                "type": "object",
                "properties": {
                    "model": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["model"],
            },
        ),
        mcp_types.Tool(
            name="get_pipeline_status",
            description="TÃ¼m servislerin durumunu dÃ¶ner (Ollama, OpenRouter, cache, circuit breakers).",
            inputSchema={"type": "object", "properties": {}},
        ),
        mcp_types.Tool(
            name="start_project",
            description=(
                "KullanÄ±cÄ±nÄ±n aÃ§Ä±kladÄ±ÄŸÄ± projeyi analiz eder, spec Ã¼retir ve "
                "Gateway'e gÃ¶rev planÄ± gÃ¶nderir. Tek cÃ¼mlelik aÃ§Ä±klama yeterli."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Ne yapmak istediÄŸinizi aÃ§Ä±klayÄ±n",
                    },
                    "gateway_url": {
                        "type": "string",
                        "default": "http://localhost:3000",
                    },
                },
                "required": ["description"],
            },
        ),
        mcp_types.Tool(
            name="generate_project_context",
            description=(
                "Bir proje klasÃ¶rÃ¼nÃ¼ analiz eder; CLAUDE.md, .claude/rules/ ve .claude/commands/ "
                "dosyalarÄ±nÄ± otomatik Ã¼retir. Mikroservis projelerinde her servis iÃ§in ayrÄ± CLAUDE.md "
                "oluÅŸturur. Proje tipi, framework, komutlar ve CI/CD otomatik tespit edilir."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "project_root": {
                        "type": "string",
                        "description": "Analiz edilecek proje kÃ¶k dizini (mutlak yol)",
                    },
                    "force": {
                        "type": "boolean",
                        "description": "Var olan dosyalarÄ±n Ã¼zerine yaz (default: false)",
                        "default": False,
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "Dosya yazmadan sadece ne yazÄ±lacaÄŸÄ±nÄ± gÃ¶ster",
                        "default": False,
                    },
                },
                "required": ["project_root"],
            },
        ),
    ]


# ---------------------------------------------------------------------------
# Tool dispatch
# ---------------------------------------------------------------------------

def _validate_required(arguments: dict[str, Any], keys: list[str]) -> str | None:
    """Return an error message if any required key is missing/empty, else None."""
    for key in keys:
        val = arguments.get(key)
        if val is None or (isinstance(val, str) and not val.strip()):
            return f"Missing or empty required argument: '{key}'"
    return None


def _sanitize_path(path_str: str) -> Path:
    """Resolve and validate a user-supplied path. Raises ValueError on issues."""
    p = Path(path_str).resolve()
    if not p.is_dir():
        raise ValueError(f"Path does not exist or is not a directory: {p}")
    return p


def _safe_error(exc: Exception) -> str:
    """Sanitize internal error to avoid leaking implementation details."""
    msg = str(exc)
    # Truncate to avoid flooding the client
    if len(msg) > 200:
        msg = msg[:200] + "â€¦"
    # Strip common internal path leaks
    for prefix in ("Traceback ", "File ", "  "):
        if msg.startswith(prefix):
            msg = "Internal error (details sanitized)"
            break
    return msg


@server.call_tool()
async def call_tool(
    name: str, arguments: dict[str, Any]
) -> list[mcp_types.TextContent]:

    orch = await _get_orch()
    # Tüm tool'lar için bileşenlerin initialize edildiğini garanti et (idempotent)
    await orch.initialize()

    match name:
        # ---- optimize_context ----
        case "optimize_context":
            err = _validate_required(arguments, ["message"])
            if err:
                return [_text_result({"error": err})]
            result = await orch.optimize(
                message=arguments["message"],
                context=arguments.get("context_messages") or [],
                force_layers=arguments.get("force_layers"),
            )
            return [mcp_types.TextContent(type="text", text=result.to_json())]

        # ---- search_docs ----
        case "search_docs":
            err = _validate_required(arguments, ["query"])
            if err:
                return [_text_result({"error": err})]
            if orch.rag_retriever is None:
                return [_text_result({"error": "RAG component is disabled (missing dependencies or init failure)"})]
            limit = int(arguments.get("limit", 3))
            if limit < 1 or limit > 20:
                return [_text_result({"error": "limit must be between 1 and 20"})]
            chunks = await orch.rag_retriever.search(
                query=arguments["query"],
                limit=limit,
            )
            return [_text_result({"results": chunks})]

        # ---- index_document ----
        case "index_document":
            err = _validate_required(arguments, ["content", "path"])
            if err:
                return [_text_result({"error": err})]
            if orch.rag_indexer is None:
                return [_text_result({"error": "RAG component is disabled"})]
            # Sanitize path â€” prevent path traversal
            doc_path = arguments["path"]
            if ".." in doc_path or doc_path.startswith("/"):
                return [_text_result({"error": "Invalid document path"})]
            result = await orch.rag_indexer.index(
                content=arguments["content"],
                path=doc_path,
            )
            return [_text_result(result)]

        # ---- get_cost_report ----
        case "get_cost_report":
            if orch.cost_tracker is None:
                return [_text_result({"error": "Cost tracker component is disabled"})]
            period = arguments.get("period", "today")
            if period not in ("today", "week", "month"):
                return [_text_result({"error": "period must be one of: today, week, month"})]
            report = await orch.cost_tracker.report(period=period)
            return [_text_result(report)]

        # ---- cache_stats ----
        case "cache_stats":
            stats: dict[str, Any] = {}
            if orch.exact_cache:
                stats["exact"] = orch.exact_cache.stats()
            if orch.semantic_cache:
                stats["semantic"] = await orch.semantic_cache.stats()
            if not stats:
                stats["status"] = "cache bileÅŸenleri henÃ¼z baÅŸlatÄ±lmadÄ±"
            return [_text_result(stats)]

        # ---- clear_cache ----
        case "clear_cache":
            tier = arguments.get("tier", "all")
            if tier not in ("all", "memory", "disk", "semantic"):
                return [_text_result({"error": "tier must be one of: all, memory, disk, semantic"})]
            cleared: list[str] = []
            if tier in ("all", "memory") and orch.exact_cache:
                orch.exact_cache.clear_memory()
                cleared.append("memory")
            if tier in ("all", "disk") and orch.exact_cache:
                orch.exact_cache.clear_disk()
                cleared.append("disk")
            if tier in ("all", "semantic") and orch.semantic_cache:
                await orch.semantic_cache.clear()
                cleared.append("semantic")
            return [_text_result({"cleared": cleared})]

        # ---- set_model_preference ----
        case "set_model_preference":
            err = _validate_required(arguments, ["model"])
            if err:
                return [_text_result({"error": err})]
            model = arguments["model"]
            reason = arguments.get("reason", "")
            # Store as a session override â€” orchestrator checks this before MAB
            if orch.model_cascade:
                orch.model_cascade.manual_override = model
            return [_text_result({"set": model, "reason": reason})]

        # ---- get_pipeline_status ----
        case "get_pipeline_status":
            status = await orch.pipeline_status()
            return [_text_result(status)]

        # ---- generate_project_context ----
        case "generate_project_context":
            err = _validate_required(arguments, ["project_root"])
            if err:
                return [_text_result({"error": err})]

            # Validate and sanitize project root
            try:
                safe_root = _sanitize_path(arguments["project_root"])
            except ValueError as ve:
                return [_text_result({"error": _safe_error(ve)})]

            force = arguments.get("force", False)
            dry_run = arguments.get("dry_run", False)

            script = Path(__file__).parent / "scripts" / "project_init.py"
            cmd = [sys.executable, str(script), str(safe_root)]
            if force:
                cmd.append("--force")
            if dry_run:
                cmd.append("--dry-run")

            proc: asyncio.subprocess.Process | None = None
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
                output = stdout.decode('utf-8') + (("\n" + stderr.decode('utf-8')) if stderr else "")
                return [mcp_types.TextContent(type="text", text=output.strip())]
            except TimeoutError:
                if proc and proc.returncode is None:
                    proc.kill()
                    await proc.wait()
                return [_text_result({"error": "project_init timed out"})]
            except Exception as exc:
                if proc and proc.returncode is None:
                    proc.kill()
                    await proc.wait()
                return [_text_result({"error": _safe_error(exc)})]

        # ---- start_project ----
        case "start_project":
            err = _validate_required(arguments, ["description"])
            if err:
                return [_text_result({"error": err})]
            await orch.initialize()

            from pipeline.discovery_agent import DiscoveryAgent  # type: ignore
            from pipeline.spec_generator import SpecGenerator    # type: ignore
            from pipeline.decomposer import Decomposer           # type: ignore

            router = getattr(orch, "provider_router", None)
            if router is None:
                return [_text_result({"error": "provider_router not initialized"})]

            da   = DiscoveryAgent(router)
            sg   = SpecGenerator(router)
            dc   = Decomposer(router)

            ctx  = await da.discover(arguments["description"])
            spec = await sg.generate(ctx)
            plan = await dc.decompose(spec)

            return [mcp_types.TextContent(
                type="text",
                text=json.dumps(plan.to_gateway_payload(), ensure_ascii=False, indent=2),
            )]

        case _:
            return [_text_result({"error": f"Bilinmeyen tool: {name}"})]

    # Final safety return (should never reach here due to match/case)
    return [_text_result({"error": "Internal dispatch error"})]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _text_result(data: dict[str, Any]) -> mcp_types.TextContent:
    return mcp_types.TextContent(
        type="text",
        text=json.dumps(data, ensure_ascii=False, indent=2),
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    # Start metrics server if possible
    start_metrics_server(settings.metrics_port)

    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    asyncio.run(main())
