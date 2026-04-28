import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import settings
from pipeline.speculative import SpeculativeConsensusRouter


async def run_benchmark():
    engine = SpeculativeConsensusRouter(settings)

    print("==================================================")
    print(" 🚀 SOTA Phase 8: Speculative Consensus Bench ")
    print("==================================================")

    # 3 Virtual Models
    # 1. 8B Local (Fast, but hallucinates code syntax)
    # 2. 70B Local (Medium speed, perfect code syntax)
    # 3. Claude Opus (Slow speed, perfect code syntax)

    speculative_manifest = [
        {"id": "ollama/llama-3-8b-fail_syntax", "mock_delay": 0.2},
        {"id": "groq/llama-3-70b-perfect", "mock_delay": 0.8},
        {"id": "anthropic/claude-3-opus-perfect", "mock_delay": 2.5},
    ]

    print("Dispatching parallel consensus execution to 3 models simultaneously...")
    for m in speculative_manifest:
        print(f" -> Injecting: {m['id']} (Expected Latency: ~{m['mock_delay'] * 1000}ms)")

    print("\n[Awaiting FIRST_COMPLETED and AST Execution Validation...]\n")

    result = await engine.execute_parallel(
        context="# Write a python function to add two numbers.",
        intent="code_generation",
        models=speculative_manifest,
    )

    winner = result.get("winner_model", "None")
    latency = result.get("latency_ms", 0.0)
    cancelled = result.get("cancelled_tasks", 0)

    print(f"✅ WINNER DECLARED:           {winner}")
    print(f"⚡ FINAL RESOLUTION LATENCY:   {latency:.2f} ms")
    print(f"🛑 BACKGROUND TASKS CANCELLED: {cancelled} tasks blocked to save tokens.")

    print("\n[Final Output Payload to Gateway]")
    print(result.get("response", ""))
    print("==================================================")

    # Asserts for strict engineering verification
    assert winner == "groq/llama-3-70b-perfect", (
        "The system failed to reject the fast but broken 8B model!"
    )
    assert cancelled == 1, "The system failed to cancel the lingering Claude 3 Opus model!"

    await engine.close()


if __name__ == "__main__":
    asyncio.run(run_benchmark())
