from __future__ import annotations

import sys
from pathlib import Path

# Add core/bridge to path (Injection for standalone test execution)
target_path = str(Path(__file__).parent.parent)
if target_path not in sys.path:
    sys.path.insert(0, target_path)

from pipeline.resonance_engine import ResonanceEngine  # noqa: E402  # isort: skip

def test_engine():
    engine = ResonanceEngine()
    # 1. READ AGENTS
    agent_raw = Path("pipeline/discovery_agent.py").read_text(encoding='utf-8-sig')
    spec_raw = Path("pipeline/spec_generator.py").read_text(encoding='utf-8-sig')
    ids1 = engine.extract_motifs(agent_raw)
    ids2 = engine.extract_motifs(spec_raw)
    # 3. FIND COMMONALITIES
    common = set(ids1).intersection(set(ids2))
    print(f"\nDiscoveryAgent Motifs: {len(ids1)}")
    print(f"Common Motifs Found: {len(common)}")
    for mid in common:
        motif = engine.registry[mid]
        print(f"\n--- COMMON MOTIF [{mid}] ---")
        print(f"Occurrences: {motif.occurrences}")
        print("Normalized Snippet (First 5 lines):")
        lines = motif.normalized_source.splitlines()
        print("\n".join(lines[:5]))

if __name__ == "__main__":
    test_engine()
