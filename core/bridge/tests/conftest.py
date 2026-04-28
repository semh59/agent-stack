import sys
import io
import pytest
from pathlib import Path

# Windows cp1254/cp1252 encoding fix — force UTF-8 for stdout/stderr
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Add core/bridge to sys.path to resolve internal modules correctly
root = Path(__file__).resolve().parent.parent
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

@pytest.fixture
def tmp_settings(tmp_path):
    from config import Settings
    settings = Settings()
    # Ensure temporary directory is used for tests
    settings.data_dir = tmp_path
    settings.mab_reward_threshold = 0.01
    return settings
