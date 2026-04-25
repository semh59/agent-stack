#!/usr/bin/env python3
"""
Global Claude Code Hook Kurulumu.

Bu script ~/.claude/settings.json dosyasına bir UserPromptSubmit hook ekler.
Hook şunu yapar:
  - Her proje oturumu başlangıcında (ilk prompt'ta) project_init.py'ı çalıştırır.
  - Eğer CLAUDE.md yoksa → generate eder.
  - Eğer varsa → sessizce geçer (exit 0).

Bu sayede herhangi bir projeyi Claude Code'da açtığında CLAUDE.md + rules +
workflows otomatik oluşur.

Usage:
  python setup_global_hook.py [--mcp-server-path /path/to/bridge]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def find_claude_settings() -> Path:
    """Find or create ~/.claude/settings.json."""
    claude_dir = Path.home() / ".claude"
    claude_dir.mkdir(exist_ok=True)
    return claude_dir / "settings.json"


def load_settings(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print(f"Warning: could not parse {path} — starting fresh", file=sys.stderr)
    return {}


def save_settings(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def hook_command(mcp_server_path: Path) -> str:
    """
    Build the shell command for the hook.

    Uses --auto flag so the Python script itself handles:
      - Reading CLAUDE_PROJECT_DIR env var (set by Claude Code)
      - Checking if CLAUDE.md already exists (idempotent)
      - Generating files only when needed

    This avoids any bash-specific syntax — works on Windows cmd, PowerShell,
    and bash equally.
    """
    script = mcp_server_path / "scripts" / "project_init.py"
    python = sys.executable
    return f'"{python}" "{script}" --auto'


def install_hook(mcp_server_path: Path) -> None:
    settings_path = find_claude_settings()
    settings = load_settings(settings_path)

    cmd = hook_command(mcp_server_path)

    new_hook = {
        "matcher": "",
        "hooks": [
            {
                "type": "command",
                "command": cmd,
            }
        ],
    }

    # Ensure hooks section exists
    hooks = settings.setdefault("hooks", {})
    existing = hooks.setdefault("UserPromptSubmit", [])

    # Check if our hook is already there (by script path)
    script_str = str(mcp_server_path / "scripts" / "project_init.py")
    already_installed = any(
        script_str in json.dumps(h) for h in existing
    )

    if already_installed:
        print(f"Hook already installed in {settings_path}")
        return

    existing.append(new_hook)
    save_settings(settings_path, settings)
    print(f"Hook installed in {settings_path}")
    print(f"  Command: {cmd}")
    print()
    print("Effect: On each new Claude Code session, if the opened project has no")
    print("CLAUDE.md, project_init.py will auto-generate context files.")


def uninstall_hook(mcp_server_path: Path) -> None:
    settings_path = find_claude_settings()
    settings = load_settings(settings_path)
    script_str = str(mcp_server_path / "scripts" / "project_init.py")

    hooks = settings.get("hooks", {})
    existing = hooks.get("UserPromptSubmit", [])
    before = len(existing)
    hooks["UserPromptSubmit"] = [h for h in existing if script_str not in json.dumps(h)]
    after = len(hooks["UserPromptSubmit"])

    if before == after:
        print("Hook not found — nothing to uninstall.")
        return

    save_settings(settings_path, settings)
    print(f"Removed {before - after} hook(s) from {settings_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Install/uninstall global project-init hook for Claude Code")
    parser.add_argument(
        "--mcp-server-path",
        type=Path,
        default=Path(__file__).parent.parent.resolve(),
        help="Path to bridge directory (default: auto-detect from script location)",
    )
    parser.add_argument("--uninstall", action="store_true", help="Remove the hook instead of installing")
    args = parser.parse_args()

    mcp_path = args.mcp_server_path.resolve()
    script = mcp_path / "scripts" / "project_init.py"

    if not script.exists():
        print(f"Error: project_init.py not found at {script}", file=sys.stderr)
        sys.exit(1)

    if args.uninstall:
        uninstall_hook(mcp_path)
    else:
        install_hook(mcp_path)


if __name__ == "__main__":
    main()
