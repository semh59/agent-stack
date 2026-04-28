import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
print("PYTHONPATH:", sys.path)
try:
    import compression.caveman
    print("SUCCESS: imported compression.caveman")
except ImportError as e:
    print("FAILED: ", e)
