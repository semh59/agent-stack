"""Tests for cleaning/noise_filter.py"""
from cleaning.noise_filter import filter_noise


def test_removes_short_acks():
    msg = "tamam\nBurada bazı önemli bilgi var.\nok"
    result = filter_noise(msg)
    assert "önemli bilgi" in result
    # Acknowledgements should be removed
    lines = [l.strip() for l in result.splitlines() if l.strip()]
    assert "tamam" not in lines
    assert "ok" not in lines


def test_traceback_truncation():
    tb = (
        "Traceback (most recent call last):\n"
        "  File 'app.py', line 10, in foo\n" * 20
        + "ValueError: something went wrong\n"
    )
    result = filter_noise(tb)
    assert "ValueError: something went wrong" in result
    # Body lines should be truncated
    assert "app.py" not in result or result.count("app.py") <= 3


def test_repeated_blocks_removed():
    # The filter works on \n\n-separated paragraphs
    block = "This is a repeated paragraph with some content that is long enough to trigger dedup, definitely over one hundred characters."
    msg = f"{block}\n\n{block}\n\n{block}\n\nunique content here"
    result = filter_noise(msg)
    assert result.count("repeated paragraph") == 1


def test_collapses_excess_blank_lines():
    msg = "line1\n\n\n\n\nline2"
    result = filter_noise(msg)
    assert "\n\n\n" not in result


def test_empty_string():
    assert filter_noise("") == ""


def test_preserves_important_content():
    msg = "Important: do not delete this file.\nError: connection failed.\n"
    result = filter_noise(msg)
    assert "Important" in result
    assert "Error" in result
