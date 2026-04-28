import sys
import ast
import os
from pathlib import Path

# Add bridge root to sys.path
root = Path(__file__).resolve().parent.parent
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from pipeline.resonance_engine import ResonanceEngine

def run_bench():
    print("=== ALLOY RCF EMPIRICAL AUDIT ===")
    engine = ResonanceEngine()
    
    # 1. LOAD DATA
    target_file = Path("bridge.py")
    if not target_file.exists():
        print(f"Error: {target_file} not found.")
        return
        
    source = target_file.read_text(encoding='utf-8-sig')
    original_len = len(source)
    print(f"Source: {target_file} ({original_len} chars)")
    
    # 2. EXTRACT MOTIFS (Learning Phase)
    print("\nPhase 1: Motif Learning...")
    # Learn from the whole file
    engine.extract_motifs(source)
    print(f"Found {len(engine.registry)} logical motifs in registry after processing {target_file.name}")
    
    # 3. RE-APPLY FOLDING (Compression Phase)
    print("\nPhase 2: Fold Simulation...")
    
    # Let's pick a few functions to fold
    tree = ast.parse(source)
    test_functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    
    if not test_functions:
        print("No functions found to fold.")
        return

    # Select a representative sample (e.g., first 5 functions)
    sample_size = 5
    sample_nodes = test_functions[:sample_size]
    
    test_original_len = 0
    total_folded_len = 0
    folded_samples = []

    for node in sample_nodes:
        raw_code = ast.unparse(node)
        test_original_len += len(raw_code)
        
        # Apply folding (Synchronous)
        pruner_path = root / "alloy_compression" / "semantic_pruner.py"
        
        spec = importlib.util.spec_from_file_location("alloy_compression.semantic_pruner", str(pruner_path))
        res = engine.fold_block(raw_code)
        
        if isinstance(res, dict) and "@rcf" in res:
            serialized = f"{{'@rcf': '{res['@rcf']}', 'delta': {res['delta']}}}"
            folded_samples.append(serialized)
            total_folded_len += len(serialized)
        else:
            folded_samples.append(raw_code)
            total_folded_len += len(raw_code)
            
    savings = (1 - total_folded_len / max(test_original_len, 1)) * 100
    
    print(f"Sample Block (First {sample_size} functions): {test_original_len} chars")
    print(f"Folded Block Length: {total_folded_len} chars")
    print(f"REAL SAVINGS: {savings:.2f}%")
    
    print("\n--- SAMPLE FOLDED OUTPUT (First Function) ---")
    if folded_samples:
        print(folded_samples[0])
    
    print("\n--- MOTIF REGISTRY SAMPLE (Metadata) ---")
    # Show motifs that have multiple occurrences
    common_motifs = [m for m in engine.registry.values() if m.occurrences > 1]
    for motif in common_motifs[:2]:
        print(f"ID: {motif.motif_id} | Name: {motif.metadata.get('name', 'N/A')} | Occurrences: {motif.occurrences}")

if __name__ == "__main__":
    run_bench()
