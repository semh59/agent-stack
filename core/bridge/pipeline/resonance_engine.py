"""
Resonance Engine — RCF Symmetry Detection Core.

İşlevi:
1. Kod bloklarını (fonksiyon/sınıf) ayrıştırır.
2. AST seviyesinde normalizasyon yaparak (değişken isimlerini temizleyerek)
   mantıksal simetriyi (Logical Symmetry) tespit eder.
3. Mimari motifleri (Motifs) kaydeder.
"""
from __future__ import annotations

import ast
import hashlib
from dataclasses import dataclass, field
from typing import Any

import structlog  # type: ignore

logger = structlog.get_logger(__name__)

@dataclass
class SymmetryMotif:
    """Tekrar eden bir mantÄ±ksal kalÄ±p."""
    motif_id: str
    normalized_source: str
    original_sample: str
    occurrences: int = 1
    metadata: dict[str, Any] = field(default_factory=dict)

class ResonanceEngine:
    """
    RCF'in geometri analizini yapan motor.
    """

    def __init__(self) -> None:
        self.registry: dict[str, SymmetryMotif] = {}
        self.threshold = 0.8  # Benzerlik eÅŸiÄŸi

    def _normalize_ast(self, node: ast.AST) -> str:
        """
        AST'yi normalize eder: DeÄŸiÅŸken isimlerini ve sabitleri anonimleÅŸtirir.
        Bu sayede 'Logical Symmetry' yakalanÄ±r.
        """
        # Kaynak kod Ã¼zerinde iÅŸlem yapmak yerine AST transformasyonu daha gÃ¼venlidir.
        class Normalizer(ast.NodeTransformer):
            def __init__(self):
                self.name_map: dict[str, str] = {}
                self.counter = 0

            def visit_Name(self, node: ast.Name) -> ast.Name:
                if node.id not in self.name_map:
                    self.name_map[node.id] = f"v{self.counter}"
                    self.counter += 1
                return ast.copy_location(ast.Name(id=self.name_map[node.id], ctx=node.ctx), node)

            def visit_Constant(self, node: ast.Constant) -> ast.Constant:
                return ast.copy_location(ast.Constant(value="[VAL]"), node)

        # Normalize et ve tekrar string'e Ã§evir (veya hash al)
        try:
            normalized = Normalizer().visit(node)
            return ast.unparse(normalized)
        except Exception:
            # Fallback: basit unparse (Python 3.9+)
            return ast.dump(node)

    def extract_motifs(self, source: str) -> list[str]:
        """
        Kaynak koddan bloklarÄ± Ã§Ä±karÄ±r ve registry'ye iÅŸler.
        """
        # --- PHASE 8 SOTA RUST ZERO-COPY FALLBACK ---
        try:
            import alloy_rust_core # type: ignore
            analyzer = alloy_rust_core.NativeContextAnalyzer()
            anchors = analyzer.extract_anchors(source)
            logger.debug("rust_ast_engine_engaged", anchors_len=len(anchors))
            
            block_ids = []
            for kind, chunk in anchors:
                fp = hashlib.sha256(chunk.encode()).hexdigest()[:16]
                if fp in self.registry:
                    self.registry[fp].occurrences += 1
                else:
                    self.registry[fp] = SymmetryMotif(
                        motif_id=fp,
                        normalized_source=chunk,
                        original_sample=chunk,
                        metadata={"name": kind}
                    )
                block_ids.append(fp)
            return block_ids
        except ImportError:
            pass  # Proceed to graceful Python GIL-bound AST execution
            
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return []

        block_ids: list[str] = []

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                normalized = self._normalize_ast(node)
                # Slicing str results in Pyre2 errors in some envs
                fingerprint = hashlib.sha256(normalized.encode()).hexdigest()[:16]  # type: ignore

                if fingerprint in self.registry:
                    self.registry[fingerprint].occurrences += 1
                else:
                    self.registry[fingerprint] = SymmetryMotif(
                        motif_id=fingerprint,
                        normalized_source=normalized,
                        original_sample=ast.unparse(node),
                        metadata={"name": node.name} if hasattr(node, "name") else {}
                    )
                block_ids.append(fingerprint)

        return block_ids

    def fold_block(self, node_source: str) -> dict[str, Any] | str:
        """
        EÄŸer blok bilinen bir motifse 'fold' eder, deÄŸilse orijinali dÃ¶ner.
        """
        try:
            tree = ast.parse(node_source)
            if not tree.body:
                return node_source
            node = tree.body[0]
            normalized = self._normalize_ast(node)
            fingerprint = hashlib.sha256(normalized.encode()).hexdigest()[:16]  # type: ignore

            if fingerprint in self.registry:
                # Delta tespiti (basitleştirilmiş)
                return {
                    "@rcf": fingerprint,
                    "delta": self._extract_delta(node)
                }
        except Exception:
            pass
        return node_source

    def _extract_delta(self, node: ast.AST) -> dict[str, Any]:
        """
        Motiften farklÄ± olan dinamik alanlarÄ± ayÄ±klar.
        Åu an iÃ§in: Ä°simler, docstringler ve belirli sabitler.
        """
        deltas: dict[str, Any] = {}

        # Tip kontrolÃ¼ ile gÃ¼venli eriÅŸim
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            deltas["name"] = node.name
            doc = ast.get_docstring(node)
            if isinstance(doc, str):
                deltas["doc"] = doc[:50] + "..." if len(doc) > 50 else doc  # type: ignore

        # Ä°Ã§erideki Ã¶zel 'PROMPT' benzeri sabitleri bul (basit tarama)
        for sub_node in ast.walk(node):
            if isinstance(sub_node, ast.Assign):
                for target in sub_node.targets:
                    if isinstance(target, ast.Name) and "PROMPT" in target.id.upper():
                        val_node = sub_node.value
                        if isinstance(val_node, ast.Constant):
                            val = val_node.value
                            if isinstance(val, str):
                                deltas[target.id] = (val[:100] + "...") if len(val) > 100 else val  # type: ignore
                            else:
                                deltas[target.id] = val

        return deltas
