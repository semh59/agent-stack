import asyncio
import json
import sys
from pathlib import Path

# Fix python paths
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import settings
from pipeline.optimization_pipeline import OptimizationPipeline
from pipeline.speculative import SpeculativeConsensusRouter
from pipeline.distillation import DistillationBuffer

async def run_integration_test():
    print("\n===========================================================")
    print(" Phase 8: Deep Integration Test (Distillation + Speculative) ")
    print("===========================================================")
    
    # 0. Nuke Caches to Prevent Vector Cosine Hits
    import shutil
    cache_dir = settings.data_dir / "cache"
    chroma_dir = settings.data_dir / "chroma"
    if cache_dir.exists():
        shutil.rmtree(cache_dir, ignore_errors=True)
    if chroma_dir.exists():
        shutil.rmtree(chroma_dir, ignore_errors=True)
        
    # 1. Initialize Pipeline with Background Distillation
    pipe = OptimizationPipeline(settings)
    await pipe.initialize()
    
    # Ensure Anchors exist for TAS compression
    reg = pipe.tas_registry
    if not reg.anchors:
        reg.bootstrap_core_anchors()
        
    db_buffer = pipe.distillation_buffer
    await db_buffer.initialize()  # Ensure table exists before background hooks
    
    anchor_info = next(iter(reg.anchors.values()))
    
    print("\n[STEP 1: Triggering OptimizationPipeline (TAS + Distillation)]")
    import time
    # Massive context to trigger TAS savings > 15.0% PLUS a random jitter to guarantee a CACHE MISS.
    raw_context = f"import {anchor_info['module']}\n" * 50 + f"\n# UNIQUE JITTER: {time.time()} \n"
    
    # Run optimization (This should secretly trigger the DistillationBuffer background task)
    result = await pipe.optimize(
        message=raw_context,
        force_layers=["tas_ghosting"]
    )
    
    opt_json = json.loads(result.to_json())
    savings = opt_json.get("savings_percent", 0.0)
    optimized_payload = opt_json.get("optimized", "")
    
    print(f" -> Pre-computation Context Size: {len(raw_context)} characters")
    print(f" -> Optimized Context Size: {len(optimized_payload)} characters")
    print(f" -> Token Savings Achieved: {savings}%")
    assert savings > 15.0, "Could not compress enough to trigger distillation."
    
    # Wait perfectly for all tracking background tasks to finalize before verifying the database
    if pipe._bg_tasks:
        await asyncio.gather(*pipe._bg_tasks)
    else:
        print("[WARNING] No background tasks were registered in the pipeline!")
    
    # Verify Distillation Buffer caught it
    db_buffer = pipe.distillation_buffer
    assert isinstance(db_buffer, DistillationBuffer)
    
    print("\n[STEP 2: Verifying Continuous Distillation DB Capture]")
    db_path = db_buffer.db_path
    import aiosqlite
    async with aiosqlite.connect(db_path) as db:
        async with db.execute("SELECT id, savings_percent FROM experience_logs ORDER BY id DESC LIMIT 1") as cursor:
            row = await cursor.fetchone()
            assert row is not None, "Distillation DB did not capture the experience!"
            print(f" SUCCESS: Distillation logged task with savings: {row[1]}%")

    print("\n[STEP 3: Dispatching to Speculative Consensus Router]")
    spec_router = SpeculativeConsensusRouter(settings)
    
    speculative_manifest = [
        {"id": "ollama/llama-3-8b-fail_syntax", "mock_delay": 0.2}, 
        {"id": "groq/llama-3-70b-perfect", "mock_delay": 0.8},
        {"id": "anthropic/claude-3-opus-perfect", "mock_delay": 2.5}
    ]
    
    # We pass the OPTIMIZED context to the LLM (Simulating final execute path)
    spec_result = await spec_router.execute_parallel(
        context=f"Please execute this logic: \n {optimized_payload}",
        intent="code_generation",
        models=speculative_manifest
    )
    
    winner = spec_result.get("winner_model", "None")
    latency = spec_result.get("latency_ms", 0.0)
    cancelled = spec_result.get("cancelled_tasks", 0)
    
    print(f" -> WINNER Accepted:          {winner}")
    print(f" -> Resolution Latency:       {latency:.2f} ms")
    print(f" -> Models Cancelled:         {cancelled}")
    
    assert winner == "groq/llama-3-70b-perfect", "AST Validation failed, wrong model chosen!"
    assert cancelled == 1, "Failed to cancel the pending backend opus task!"
    
    print("\n===========================================================")
    print(" ALL DEEP INTEGRATION TESTS PASSED ")
    print("===========================================================")
    
    await spec_router.close()

if __name__ == "__main__":
    asyncio.run(run_integration_test())
