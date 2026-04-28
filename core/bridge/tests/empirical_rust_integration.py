import os
import sys
import time
import structlog
import asyncio

# Setup paths and logger
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
logger = structlog.get_logger("rust_benchmark")

# Create a mock immense Python context (10,000 lines)
MOCK_CONTEXT = """
class DataProcessor:
    def process(self):
        pass

async def handle_request():
    print("handling")
    
import math
from typing import Any
""" * 1000

def run_benchmark():
    logger.info("benchmark_start", context_lines=len(MOCK_CONTEXT.splitlines()))

    rust_available = False
    rust_time = 0.0
    py_time = 0.0

    try:
        import alloy_rust_core
        analyzer = alloy_rust_core.NativeContextAnalyzer()
        start = time.perf_counter()
        anchors = analyzer.extract_anchors(MOCK_CONTEXT)
        rust_time = (time.perf_counter() - start) * 1000
        rust_available = True
        logger.info("rust_engine_stats", anchors_found=len(anchors), latency_ms=f"{rust_time:.2f}ms")
    except ImportError:
        logger.warning("rust_engine_unavailable", reason="alloy_rust_core wheels not compiled in environment. Fallback simulated.")

    # Python Execution Benchmark
    from pipeline.resonance_engine import ResonanceEngine
    engine = ResonanceEngine()
    
    start = time.perf_counter()
    anchors = engine.extract_motifs(MOCK_CONTEXT)
    py_time = (time.perf_counter() - start) * 1000
    logger.info("python_ast_stats", anchors_found=len(anchors), latency_ms=f"{py_time:.2f}ms")

    if rust_available:
        speedup = py_time / max(rust_time, 0.01)
        logger.info("benchmark_result", rust_ms=f"{rust_time:.2f}ms", python_ms=f"{py_time:.2f}ms", speed_multiplier=f"{speedup:.2f}x")
    else:
        logger.info("benchmark_result", status="Python SOTA Fallback operational. Build native rust_core using 'maturin develop' for maximum speedup.")

if __name__ == "__main__":
    run_benchmark()
