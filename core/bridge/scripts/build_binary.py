"""
Edge Binary Compilation Script (PyInstaller)
Generates a standalone executable for bridge.py.
"""
import os
import sys
import subprocess
from pathlib import Path

def main():
    root_dir = Path(__file__).parent.parent.absolute()
    os.chdir(root_dir)

    print("Checking dependencies...")
    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    print("Building bridge.py into an Edge binary...")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "bridge-edge",
        "--onefile",
        "--clean",
        "--noconfirm",
        # Explicit hidden imports for dynamic ML plugins
        "--hidden-import", "chromadb",
        "--hidden-import", "lancedb",
        "--hidden-import", "spacy",
        "--hidden-import", "numpy",
        "--hidden-import", "pydantic",
        "--hidden-import", "aiohttp",
        # Exclude massive test suites from binary
        "--exclude-module", "pytest",
        "bridge.py"
    ]

    subprocess.check_call(cmd)

    dist_dir = root_dir / "dist"
    print(f"Compilation finished. Executable is waiting in: {dist_dir}")

if __name__ == "__main__":
    main()
