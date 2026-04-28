"""
Code Deduplicator â€” AST-aware file tracking + diff delivery.

MantÄ±k:
  Ä°lk kez gÃ¶rÃ¼len dosya â†’ tam iÃ§erik gÃ¶nder
  DeÄŸiÅŸmemiÅŸ (hash aynÄ±) â†’ "already in context" bildirimi, iÃ§erik gÃ¶nderme
  DeÄŸiÅŸmiÅŸ â†’ unified diff (diff < %50 orijinal boyut ise diff, deÄŸilse tam)
  Spesifik fonksiyon sorulmuÅŸ â†’ sadece o bloÄŸu Ã§Ä±kar

Registry session-scoped (in-memory, restart ile sÄ±fÄ±rlanÄ±r).
"""
from __future__ import annotations

import ast
import difflib
import hashlib
import re
from dataclasses import dataclass, field


@dataclass
class FileRecord:
    path: str
    content_hash: str
    last_sent_at: int   # message ID
    sent_functions: set[str] = field(default_factory=set)
    full_content: str = ""


# Regex to find file path hints in surrounding message context
_PATH_HINT_RE = re.compile(
    r"(?:#\s*|in\s+|file:\s*|from\s+|import\s+)"
    r"([^\s,;\"'<>()]+\.(?:py|ts|js|go|rs|rb|java|cpp|c|h))",
    re.I,
)

# Regex to find "show me function X" style requests
_FUNCTION_REQUEST_RE = re.compile(
    r"\b(?:show|explain|what does|look at|in)\s+"
    r"(?:the\s+)?`?(\w+)`?\s+(?:function|method|class|def)\b",
    re.I,
)


class CodeDeduplicator:
    """
    Session-scoped file registry.
    One instance per MCP server process.
    """

    def __init__(self) -> None:
        self.registry: dict[str, FileRecord] = {}
        self.current_msg_id: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process(self, message: str, msg_id: int) -> tuple[str, float]:
        """
        Scan message for code fences. Dedup each one.
        Returns: (processed_message, savings_percent)
        """
        self.current_msg_id = msg_id
        original_len = len(message)

        code_fence_re = re.compile(
            r"(```(?:python|py|typescript|ts|javascript|js|go|rust|rs)?\n)"
            r"([\s\S]*?)"
            r"(```)",
            re.M,
        )

        def _replace(m: re.Match[str]) -> str:
            opener, code, closer = m.group(1), m.group(2), m.group(3)
            file_path = self._detect_file_path(code, message)
            replacement_code = self._process_code_block(code, file_path)
            if replacement_code == code:  # M2 fix: equality check, not identity
                return m.group(0)
            return f"{opener}{replacement_code}{closer}"

        processed = code_fence_re.sub(_replace, message)
        savings = max(0.0, (1 - len(processed) / max(original_len, 1)) * 100)
        return processed, savings

    def extract_function(self, source: str, function_name: str) -> str | None:
        """
        Use AST to extract a specific function/class from Python source.
        Returns: function source including decorators, or None if not found.
        """
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return None

        lines = source.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if node.name == function_name:
                    start = node.lineno - 1
                    end = node.end_lineno if hasattr(node, "end_lineno") else len(lines)
                    # Include decorators
                    for deco in getattr(node, "decorator_list", []):
                        start = min(start, deco.lineno - 1)
                    return "\n".join(lines[start:end])
        return None

    def reset(self) -> None:
        """Clear registry (e.g. on new conversation)."""
        self.registry.clear()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _detect_file_path(self, code: str, context: str) -> str:
        """Try to infer file path from code content or surrounding context."""
        # Check first line comment "# path/to/file.py"
        first_line = code.splitlines()[0] if code.splitlines() else ""
        if first_line.startswith("# ") and any(
            first_line.endswith(ext)
            for ext in (".py", ".ts", ".js", ".go", ".rs", ".rb", ".java", ".cpp", ".c")
        ):
            return first_line[2:].strip()

        # Search context for path hint
        m = _PATH_HINT_RE.search(context)
        if m:
            return m.group(1)

        # Fallback: hash the beginning of the code
        code_sig = hashlib.sha256(code[:100].encode()).hexdigest()[:8]
        return f"unknown_{code_sig}.py"

    def _process_code_block(self, code: str, file_path: str) -> str:
        current_hash = hashlib.sha256(code.encode()).hexdigest()

        if file_path not in self.registry:
            # First time seen: send full content, register
            self.registry[file_path] = FileRecord(
                path=file_path,
                content_hash=current_hash,
                last_sent_at=self.current_msg_id,
                full_content=code,
            )
            return code  # unchanged

        record = self.registry[file_path]

        if record.content_hash == current_hash:
            # File unchanged â€” skip content
            return (
                f"# [unchanged: {file_path} â€” already in context "
                f"from message #{record.last_sent_at}]"
            )

        # File changed â€” send diff
        diff_lines = list(
            difflib.unified_diff(
                record.full_content.splitlines(keepends=True),
                code.splitlines(keepends=True),
                fromfile=f"a/{file_path}",
                tofile=f"b/{file_path}",
                n=3,
            )
        )

        # Update registry
        record.content_hash = current_hash
        record.last_sent_at = self.current_msg_id
        record.full_content = code

        if diff_lines and len(diff_lines) < len(code.splitlines()) * 0.5:
            return "".join(diff_lines)  # diff is shorter â€” use it
        return code  # diff is large â€” send full file
