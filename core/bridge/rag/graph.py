from __future__ import annotations
import ast
import json
import hashlib
from pathlib import Path
from typing import Any, Dict, Set, List
import structlog  # type: ignore
from config import Settings  # type: ignore

logger = structlog.get_logger(__name__)

class SymbolNode:
    def __init__(self, name: str, node_type: str, path: str):
        self.name = name
        self.node_type = node_type  # class, function, module
        self.path = path
        self.dependencies: Set[str] = set()
        self.fingerprint: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "type": self.node_type,
            "path": self.path,
            "dependencies": list(self.dependencies),
            "fingerprint": self.fingerprint
        }

class CodeGraph:
    """
    Topological Symbol Graph for Alloy AI Platform.
    Builds a project-wide map of symbols and their ontological links.
    """
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.graph_path = settings.data_dir / "code_graph.json"
        self.symbols: Dict[str, SymbolNode] = {}  # symbol_id -> node

    def _get_id(self, path: str, name: str) -> str:
        return f"{path}::{name}"

    def register_symbol(self, path: str, name: str, node_type: str) -> str:
        sid = self._get_id(path, name)
        if sid not in self.symbols:
            self.symbols[sid] = SymbolNode(name, node_type, path)
        return sid

    def add_edge(self, source_id: str, target_name: str):
        """Adds a dependency from source to target_name (heuristic)."""
        if source_id in self.symbols:
            self.symbols[source_id].dependencies.add(target_name)

    def parse_project(self, root_dir: Path):
        """Performs a project-wide AST walk to index symbols."""
        logger.info("graph_indexing_started", root=str(root_dir))
        for py_file in root_dir.glob("**/*.py"):
            if ".venv" in str(py_file) or "__pycache__" in str(py_file):
                continue
            
            try:
                content = py_file.read_text(encoding="utf-8", errors="ignore")
                self.parse_file(py_file, content, root_dir)
            except Exception as e:
                logger.warning("graph_file_skip", path=str(py_file), error=str(e))
        
        self._generate_fingerprints()
        self.save()
        logger.info("graph_indexing_complete", total_symbols=len(self.symbols))

    def parse_file(self, path: Path, content: str, root_dir: Path) -> None:
        try:
            rel_path = str(path.relative_to(root_dir)).replace("\\", "/")
        except ValueError:
            rel_path = path.name
        try:
            tree = ast.parse(content)
            current_module_id = self.register_symbol(rel_path, "__module__", "module")

            for node in ast.walk(tree):
                if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
                    sid = self.register_symbol(rel_path, node.name, "class" if isinstance(node, ast.ClassDef) else "function")
                    self.add_edge(current_module_id, sid)

                    # Sub-calls
                    for sub in ast.walk(node):
                        if isinstance(sub, ast.Call):
                            if isinstance(sub.func, ast.Name):
                                self.add_edge(sid, sub.func.id)
                            elif isinstance(sub.func, ast.Attribute):
                                self.add_edge(sid, sub.func.attr)

                elif isinstance(node, (ast.Import, ast.ImportFrom)):
                    if isinstance(node, ast.Import):
                        for n in node.names:
                            self.add_edge(current_module_id, n.name)
                    else:
                        if node.module:
                            self.add_edge(current_module_id, node.module)

        except Exception as e:
            logger.warning("graph_parse_file_failed", path=rel_path, error=str(e))

    def _generate_fingerprints(self):
        """Generates topological hashes for each symbol neighborhood."""
        for sid, node in self.symbols.items():
            # Neighborhood context: name + type + dependencies
            context = f"{node.name}|{node.node_type}|{sorted(list(node.dependencies))}"
            node.fingerprint = hashlib.sha256(context.encode()).hexdigest()[:12]

    def get_neighbors(self, symbol_name: str, depth: int = 1) -> Set[str]:
        """Retrieves related symbols for a given query name."""
        # Fuzzy match for symbol name
        matches = [s for s in self.symbols.values() if s.name == symbol_name]
        if not matches:
            return set()
        
        results = set()
        for m in matches:
            results.update(m.dependencies)
        
        return results

    def save(self) -> None:
        data = {sid: node.to_dict() for sid, node in self.symbols.items()}
        self.graph_path.write_text(json.dumps(data, indent=2))

    def load(self) -> None:
        if self.graph_path.exists():
            try:
                data = json.loads(self.graph_path.read_text())
                for sid, d in data.items():
                    node = SymbolNode(d["name"], d["type"], d["path"])
                    node.dependencies = set(d["dependencies"])
                    node.fingerprint = d["fingerprint"]
                    self.symbols[sid] = node
            except Exception as e:
                logger.error("graph_load_failed", error=str(e))
