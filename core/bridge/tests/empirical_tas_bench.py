import asyncio
import json
from pathlib import Path
import sys

# Ensure bridge modules can be imported
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import settings
from pipeline.optimization_pipeline import OptimizationPipeline

async def run_benchmark():
    pipe = OptimizationPipeline(settings)
    await pipe.initialize()
    
    reg = pipe.tas_registry
    if not reg.anchors:
        reg.bootstrap_core_anchors()
        
    print("==============================================")
    print(" TAS Empirical Benchmark (Semantic Ghosting) ")
    print("==============================================")
    
    anchor_id = "TAS-ANC-676F22AD"
    anchor_info = None
    for aid, data in reg.anchors.items():
        if "models" in data.get("module", ""):
            anchor_id = aid
            anchor_info = data
            break
            
    if not anchor_info:
        print("Error: Could not find models anchor.", reg.anchors)
        return
        
    raw_context = f"""
# Architectural context for module: {anchor_info['module']}
# Contains the following symbols: {', '.join(anchor_info['symbols'])}

class AlloyProviderRouter:
    def __init__(self, settings):
        self.settings = settings
        self.router = None
        
    def select_optimal_model(self, intent):
        # Implementation details omitted for brevity
        return "tier0-fast"
        
    async def route_call(self, model, messages, **kwargs):
        # Core routing logic with cascade and MAB
        pass
        
# Imagine this file is actually 500 lines long, with 2000 tokens of boilerplate.
    """ * 10 

    original_len = len(raw_context)
    print(f"Original Context Size: {original_len} characters")
    
    ghosted_context, savings = await pipe._apply_tas(raw_context)
    
    ghosted_len = len(ghosted_context)
    print(f"Ghosted Context Size:  {ghosted_len} characters")
    print(f"Compression Savings:   {savings:.2f}%")
    print("\n[Ghosted Payload Snippet]")
    print(ghosted_context.strip())

    assert savings > 80.0, f"TAS Ghosting failed to achieve target >80% savings. Got: {savings:.2f}%"
    print("==============================================")
    print(" BENCHMARK PASSED ")
    print("==============================================")

if __name__ == "__main__":
    asyncio.run(run_benchmark())
