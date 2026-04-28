import unittest
import sys
import ast
import os
from pathlib import Path
from pipeline.resonance_engine import ResonanceEngine
from pipeline.optimization_pipeline import OptimizationPipeline
from config import Settings
from pipeline.discovery_agent import DiscoveryAgent

class TestRCFProduction(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.settings = Settings()
        self.engine = ResonanceEngine()
        self.pipeline = OptimizationPipeline(self.settings)
        await self.pipeline.initialize()
        # Disable caches for deterministic layer testing
        self.pipeline.exact_cache = None
        self.pipeline.semantic_cache = None

    def test_rcf_motif_extraction_self(self):
        """Verify ResonanceEngine can fingerprint its own core logic."""
        source = Path("pipeline/resonance_engine.py").read_text(encoding='utf-8-sig')
        ids = self.engine.extract_motifs(source)
        self.assertGreater(len(ids), 0, "No motifs extracted from resonance_engine.py")
        
        # Verify specific method motif
        # The extract_motifs method should be detected
        self.assertIn("extract_motifs", [m.metadata.get("name", "") for m in self.engine.registry.values()])

    async def test_rcf_pipeline_folding_fidelity(self):
        """Verify end-to-end folding in the optimization pipeline."""
        # Setup: Pre-load the registry with motifs from bridge.py
        bridge_source = Path("bridge.py").read_text(encoding='utf-8-sig')
        self.pipeline.resonance_engine.extract_motifs(bridge_source)
        
        # Test Input: A simpler block that we definitely just extracted
        tree = ast.parse(bridge_source)
        # Find the first FunctionDef in bridge.py
        target_node = next(n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)))
        sample_code = ast.unparse(target_node)
        
        result = await self.pipeline.optimize(
            message=sample_code.strip(),
            force_layers=["rcf_folding"]
        )
        
        self.assertIn("@rcf", result.optimized_message, "RCF folding did not trigger")
        self.assertIn("rcf_folding", result.layers_applied)
        self.assertTrue(result.savings_percent > 0)

    def test_rcf_meta_grammar_presence(self):
        """Verify the RCF Unfolding Meta-Grammar is injected into agent prompts."""
        prompt = DiscoveryAgent.SYSTEM_PROMPT
        self.assertIn("RCF NOTU", prompt)
        self.assertIn("@rcf", prompt)

if __name__ == "__main__":
    unittest.main()
