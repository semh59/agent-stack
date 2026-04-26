"""
Quantum Deep Testing Suite — Verification for 2026 Hardening.

Rigorous unit and integration tests for:
- AST-Aware Chunking (Tree-sitter)
- Contextual Embedding (Summary augmentation)
- Semantic Pruning (Logic preservation)
- Prefix Caching (Shared state)
"""
from pathlib import Path
import unittest

# Mock settings
class MockSettings:
    ollama_url = "http://localhost:11434"
    ollama_fast_model = "qwen2.5-coder:1.5b"
    data_dir = Path("./test_data")

class TestQuantumHardening(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self) -> None:
        self.settings = MockSettings()

    # ------------------------------------------------------------------
    # Phase 2: RAG 2.0 Verification
    # ------------------------------------------------------------------

    def test_ast_chunking(self):
        """Verify AST chunking splits code at logical boundaries."""
        from rag.indexer import DocumentIndexer  # type: ignore
        indexer = DocumentIndexer(self.settings)

        code = (
            "class Database:\n"
            "    def connect(self):\n"
            "        pass\n\n"
            "def main():\n"
            "    db = Database()\n"
        )

        # Test Python chunking
        chunks = indexer._chunk_document(code, "test.py")
        self.assertTrue(len(chunks) >= 1)
        # Check if logical units are preserved (basic check)
        self.assertIn("class Database", chunks[0])

    async def test_contextualization_logic(self):
        """Verify summaries are prepended to chunks."""
        from rag.contextual_embedder import ContextualEmbedder  # type: ignore
        embedder = ContextualEmbedder(self.settings)

        content = "This is a configuration utility."
        chunks = ["chunk1 content"]
        path = "utils.py"

        # Define a proper async mock
        async def mock_summary(*args, **kwargs):
            return "Test Summary"

        embedder._generate_file_summary = mock_summary

        result = await embedder.contextualize_chunks(content, chunks, path)
        self.assertEqual(len(result), 1)
        self.assertIn("[Context: Test Summary]", result[0])
        self.assertIn("[File: utils.py]", result[0])

    # ------------------------------------------------------------------
    # Phase 3: Compaction Verification
    # ------------------------------------------------------------------

    def test_semantic_pruning(self):
        """Verify logic preservation after pruning noise."""
        from compression.semantic_pruner import SemanticPruner  # type: ignore
        pruner = SemanticPruner(self.settings)

        code = (
            "# This is a comment\n"
            "def add(a, b):\n"
            "    \"\"\"Docstring content\"\"\"\n"
            "    return a + b\n"
        )

        pruned, savings = pruner.prune(code)
        self.assertIn("def add(a, b):", pruned)
        self.assertIn("return a + b", pruned)
        self.assertNotIn("# This is a comment", pruned)
        self.assertNotIn("Docstring content", pruned)
        self.assertTrue(savings > 0)

    def test_prefix_cache_ttl(self):
        """Verify caching and TTL eviction."""
        from pipeline.prefix_cache_manager import PrefixCacheManager  # type: ignore
        cache = PrefixCacheManager(self.settings)  # type: ignore

        content = "Common Instruction Set v1"
        cache.store_prefix(content)

        # Hit check
        self.assertEqual(cache.get_prefix(content), content)

        # Manual expiry check
        cache.ttl = -1 # Expire everything
        cache._evict_old()
        self.assertIsNone(cache.get_prefix(content))

if __name__ == "__main__":
    unittest.main()
