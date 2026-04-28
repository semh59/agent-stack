from __future__ import annotations
import json
import hashlib
from typing import Dict, Any
from pathlib import Path
import structlog  # type: ignore

from config import Settings  # type: ignore
from rag.graph import CodeGraph  # type: ignore

logger = structlog.get_logger(__name__)

class AnchorRegistry:
    """
    Topological Anchor Registry for TAS Layer.
    Maps known architectural structures to constant IDs to avoid redundant context loading.
    "Semantic Ghosting" allows the Gateway and Bridge to agree on an anchor 
    and only exchange the delta of changes.
    """
    def __init__(self, settings: Settings, graph: CodeGraph):
        self.settings = settings
        self.graph = graph
        self.registry_path = settings.data_dir / "tas_anchors.json"
        
        # anchor_id -> { "symbols": list, "description": str }
        self.anchors: Dict[str, Dict[str, Any]] = {}
        
    def generate_anchor(self, module_path: str, description: str = "") -> str:
        """
        Creates a topological anchor for a specific module by aggregating 
        its internal symbol fingerprints.
        """
        # Find all symbols related to this module path
        related_nodes = [
            n for n in self.graph.symbols.values() 
            if n.path.startswith(module_path)
        ]
        
        if not related_nodes:
            logger.warning("anchor_generation_empty", module=module_path)
            return ""
            
        # Ensure deterministic ordering
        related_nodes.sort(key=lambda x: x.name)
        
        # Aggregate fingerprints to form the ultimate topological state hash
        aggregate_state = "|".join([n.fingerprint for n in related_nodes])
        anchor_id = "TAS-ANC-" + hashlib.sha256(aggregate_state.encode()).hexdigest()[:8].upper()
        
        self.anchors[anchor_id] = {
            "module": module_path,
            "description": description or f"Auto-generated anchor for {module_path}",
            "symbol_count": len(related_nodes),
            "state_hash": aggregate_state[:16] + "...",
            "symbols": [n.name for n in related_nodes]
        }
        
        logger.info("anchor_registered", anchor_id=anchor_id, module=module_path, count=len(related_nodes))
        return anchor_id

    def bootstrap_core_anchors(self):
        """Automatically registers standard architectural boundaries."""
        self.generate_anchor("pipeline", "Orchestration Pipeline Root")
        self.generate_anchor("rag", "RAG & Topological Context Root")
        self.generate_anchor("models", "Model Routing & Providers")
        self.save()

    def detect_anchors(self, query: str) -> list[str]:
        """
        Naive heuristic to find matching anchors based on text overlap.
        In a real scenario, this is determined by tree-sitter delta checks.
        """
        detected = []
        for aid, data in self.anchors.items():
            if data["module"] in query.lower() or any(sym in query for sym in data["symbols"]):
                detected.append(aid)
        return list(set(detected))

    def ghost_context(self, context_block: str, anchor_id: str) -> str:
        """
        Replaces massive context blocks with their respective Anchor ID.
        This represents the "Semantic Ghost" - reducing 1000s of tokens to 10.
        """
        if anchor_id not in self.anchors:
            return context_block
            
        anchor = self.anchors[anchor_id]
        ghost_prompt = (
            f"\n@[TAS-GHOST-NODE]\n"
            f"Anchor: {anchor_id}\n"
            f"Module: {anchor['module']}\n"
            f"Status: Synced. {anchor['symbol_count']} symbols omitted to prevent context exhaustion.\n"
            f"Note: Safe to assume standard implementation for: {', '.join(anchor['symbols'][:5])}...\n"
            f"@[/TAS-GHOST-NODE]\n"
        )
        return ghost_prompt

    def save(self) -> None:
        try:
            self.registry_path.write_text(json.dumps(self.anchors, indent=2))
        except Exception as e:
            logger.error("anchor_save_failed", error=str(e))

    def load(self) -> None:
        if self.registry_path.exists():
            try:
                self.anchors = json.loads(self.registry_path.read_text())
            except Exception as e:
                logger.error("anchor_load_failed", error=str(e))
