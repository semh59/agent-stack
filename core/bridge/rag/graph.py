from __future__ import annotations
import ast
import json
from pathlib import Path
import structlog # type: ignore
from config import Settings # type: ignore

logger = structlog.get_logger(__name__)

class CodeGraph:
    """
    GraphRAG-lite: A bipartite graph mapping code entities to their dependencies.
    Used to augment RAG retrieval with structural context.
    """
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.graph_path = settings.data_dir / "code_graph.json"
        self.nodes: dict[str, set[str]] = {} # entity_name -> neighbors

    def add_dependency(self, source: str, target: str) -> None:
        if source not in self.nodes:
            self.nodes[source] = set()
        self.nodes[source].add(target)

    def get_neighbors(self, entity: str, depth: int = 1) -> set[str]:
        if depth <= 0 or entity not in self.nodes:
            return set()
        
        neighbors = set(self.nodes[entity])
        if depth > 1:
            for n in list(neighbors):
                neighbors.update(self.get_neighbors(n, depth - 1))
        return neighbors

    def parse_file(self, path: Path, content: str) -> None:
        """Parses a Python file and extracts entity relationships."""
        try:
            tree = ast.parse(content)
            
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                    entity_name = f"{path.name}::{node.name}"
                    self.add_dependency(path.name, entity_name)
                    
                    # Track internal calls (simple heuristic)
                    for sub in ast.walk(node):
                        if isinstance(sub, ast.Call):
                            func = sub.func
                            if isinstance(func, ast.Name):
                                self.add_dependency(entity_name, str(func.id))
                            elif isinstance(func, ast.Attribute):
                                # Handle self.method() or obj.method()
                                # attr is a str, but sub-expression might be anything
                                self.add_dependency(entity_name, str(func.attr))
                            elif isinstance(func, ast.Subscript):
                                # Handle something[key]()
                                pass
                
                elif isinstance(node, (ast.Import, ast.ImportFrom)):
                    # Track cross-file imports
                    targets = []
                    if isinstance(node, ast.Import):
                        targets = [n.name for n in node.names]
                    else:
                        targets = [node.module] if node.module else []
                        
                    for t in targets:
                        if t is not None:
                            self.add_dependency(path.name, str(t))
                        
        except Exception as e:
            logger.warning("graph_parse_failed", path=str(path), error=str(e))

    def save(self) -> None:
        """Persists graph to JSON."""
        data = {k: list(v) for k, v in self.nodes.items()}
        try:
            self.graph_path.write_text(json.dumps(data, indent=2))
        except Exception as e:
            logger.error("graph_save_failed", error=str(e))

    def load(self) -> None:
        if self.graph_path.exists():
            try:
                data = json.loads(self.graph_path.read_text())
                self.nodes = {k: set(v) for k, v in data.items()}
            except Exception as e:
                logger.error("graph_load_failed", error=str(e))
