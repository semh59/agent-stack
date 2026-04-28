import asyncio
import os
import sys
import time

import structlog

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pipeline.distillation import DistillationBuffer
from pipeline.router import Classification, MessageType
from pipeline.speculative import SpeculativeConsensusRouter

logger = structlog.get_logger("chaos_integration")

async def test_vector_1_concurrency_panic():
    """
    Bombard the Distillation Buffer with 50 concurrent inputs.
    Verifies aiosqlite connection pooling does not collapse under OperationalError: database is locked.
    """
    logger.info("chaos_test_started", vector="1_concurrency_panic")
    from config import Settings
    from pathlib import Path
    settings = Settings()
    settings.data_dir = Path(".")
    buffer = DistillationBuffer(settings=settings)
    await buffer.initialize()

    async def _spam_buffer(idx: int):
        mock_ast = f"class SyntheticModel_{idx}:\n    def test_{idx}(self):\n        pass"
        try:
            await buffer.record_experience(
                intent="chaos_test",
                model=f"bot_{idx}",
                messages=[{"role": "user", "content": f"Task {idx}"}],
                response=mock_ast,
                complexity=8.5,
                savings=10.0,
                anchors=["func_def", "class_def"]
            )
            return True
        except Exception as e:
            logger.error("chaos_spam_failed", idx=idx, error=str(e))
            return False

    start = time.perf_counter()
    tasks = [_spam_buffer(i) for i in range(50)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    success_count = sum(1 for r in results if r is True)
    elapsed = time.perf_counter() - start

    assert success_count == 50, f"Panic! Expected 50 successes, got {success_count}!"
    logger.info("chaos_vector_1_passed", db_hits=50, latency=f"{elapsed:.3f}s", status="SOTA_STABLE")

async def test_vector_2_syntax_hallucination_fuzzing():
    """
    Mock the router where the fast model returns invalid code and the slow model returns valid code.
    Verifies AST SyntaxError interception natively cancels the hallucinating model.
    """
    logger.info("chaos_test_started", vector="2_syntax_hallucination")
    
    from config import Settings
    from pathlib import Path
    settings = Settings()
    settings.data_dir = Path(".")
    router = SpeculativeConsensusRouter(settings=settings)
    
    # We will mock the `_dispatch_single_model` function locally for testing.
    async def mock_dispatch(model_id: str, context: str, intent: str, delay_mock: float = 0.0) -> tuple[str, str, float]:
        start = time.monotonic()
        if model_id == "fast-hallucinator":
            await asyncio.sleep(0.05)
            # INVALID PYTHON AST
            return (model_id, "def broken_code(:\n    return self.something", (time.monotonic() - start) * 1000)
        elif model_id == "slow-sota":
            await asyncio.sleep(0.3)
            # VALID PYTHON AST
            return (model_id, "def perfect_code():\n    return 'success'", (time.monotonic() - start) * 1000)
        return (model_id, "", 0.0)
    
    # Hot-swap the dispatch method
    router._dispatch_single_model = mock_dispatch # type: ignore
    
    mock_classification = Classification(
        message_type=MessageType.CODE_GENERATION,
        confidence=0.99,
        rationale="Testing",
        recommended_layers=["fast-hallucinator", "slow-sota"]
    )
    
    start = time.perf_counter()
    models = [{"id": "fast-hallucinator", "mock_delay": 0.05}, {"id": "slow-sota", "mock_delay": 0.3}]
    result = await router.execute_parallel(context="test_prompt", intent="code_generation", models=models)
    elapsed = time.perf_counter() - start
    
    assert "perfect_code" in result["response"], f"Router accepted hallucinated AST! Got: {result['response']}"
    assert result["winner_model"] == "slow-sota"
    
    logger.info("chaos_vector_2_passed", winner=result["winner_model"], latency=f"{elapsed:.3f}s", status="SOTA_STABLE")


async def execute_chaos_suite():
    logger.info("chaos_suite_initiated", level="DEEP_FORENSIC")
    start = time.perf_counter()
    
    await test_vector_1_concurrency_panic()
    await test_vector_2_syntax_hallucination_fuzzing()
    
    total = time.perf_counter() - start
    logger.info("chaos_suite_completed", total_time=f"{total:.3f}s", exit_code=0)

if __name__ == "__main__":
    asyncio.run(execute_chaos_suite())
