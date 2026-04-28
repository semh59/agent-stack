import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from alloy_compression.caveman import CavemanDetector, CavemanCompressor, _lite_compress


# ---------------------------------------------------------------------------
# Detector tests
# ---------------------------------------------------------------------------

def test_detector_short_text():
    d = CavemanDetector()
    assert not d.should_compress("hi")


def test_detector_compressible_prose():
    d = CavemanDetector()
    prose = (
        "Actually, you should basically just really make sure that you "
        "are essentially always fundamentally thinking about how to very "
        "thoroughly and definitely ensure that the code is quite correct. " * 3
    )
    assert d.should_compress(prose)


def test_detector_mode_ultra():
    d = CavemanDetector()
    filler_heavy = (
        "very really quite just simply basically actually literally "
        "certainly definitely probably very really quite just simply "
    ) * 10
    mode = d.get_compression_mode(filler_heavy)
    assert mode in ("full", "ultra")


def test_detector_mode_lite():
    d = CavemanDetector()
    clean_text = "The function returns a list of integers sorted in ascending order."
    mode = d.get_compression_mode(clean_text)
    assert mode == "lite"


# ---------------------------------------------------------------------------
# LITE compression
# ---------------------------------------------------------------------------

def test_lite_removes_filler():
    text = "You should just really basically ensure this works correctly."
    result, savings = _lite_compress(text)
    assert "really" not in result
    assert "basically" not in result
    assert savings > 0


def test_lite_preserves_non_filler():
    text = "The database migration script failed on line 42."
    result, savings = _lite_compress(text)
    assert "database" in result
    assert "migration" in result
    assert "42" in result


# ---------------------------------------------------------------------------
# Compressor (LITE mode â€” no Ollama needed)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_compressor_short_text_unchanged(tmp_settings):
    comp = CavemanCompressor(tmp_settings)
    result, savings = await comp.compress("hi")
    assert result == "hi"
    assert savings == 0.0


@pytest.mark.asyncio
async def test_compressor_lite_mode(tmp_settings):
    comp = CavemanCompressor(tmp_settings)
    prose = (
        "You should really just basically ensure that the system is "
        "essentially working correctly and definitely functioning as expected. " * 2
    )
    result, savings = await comp.compress(prose, mode="lite")
    assert savings > 0
    assert "system" in result  # non-filler word preserved
