import sys
import pytest
from pathlib import Path

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
