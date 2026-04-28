#!/usr/bin/env python
"""
Caveman Service â€” Flask HTTP API for prose compression.

Primary path  : CavemanCompressor (Ollama mistral-7b / LITE regex fallback)
Fallback path : pure-Python filler-word removal (no external deps)

Ported from ai-stack/scripts/caveman_server.py and merged with
compression/caveman.py's CavemanCompressor.

Usage:
    python scripts/caveman_server.py
    ALLOY_OLLAMA_URL=http://ollama:11434 python scripts/caveman_server.py

Endpoints:
    GET  /health   â€” health check (unauthenticated)
    POST /optimize â€” compress text
    GET  /stats    â€” runtime statistics
    GET  /config   â€” service configuration
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
from pathlib import Path

# Ensure project root is on path so compression/ can be imported
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, jsonify, request  # type: ignore[import]

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [caveman-service] %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

CONFIG = {
    "max_text_length": 100_000,
    "timeout": 30,
    "compression_modes": ["lite", "full", "ultra"],
    "default_mode": "full",
    "ollama_url": os.environ.get("ALLOY_OLLAMA_URL", "http://localhost:11434"),
}

# Bound concurrent Ollama calls (same pattern as original ai-stack caveman_server.py)
_SEMAPHORE = threading.Semaphore(4)

# LOW fix: protect STATS increments with a lock â€” Flask runs threaded=True.
_STATS_LOCK = threading.Lock()

STATS: dict[str, float | int] = {
    "requests_processed": 0,
    "total_chars_in": 0,
    "total_chars_out": 0,
    "start_time": time.time(),
    "ollama_calls": 0,
    "fallback_calls": 0,
}


def _stats_inc(key: str, amount: int = 1) -> None:
    with _STATS_LOCK:
        STATS[key] = int(STATS[key]) + amount


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------


@app.before_request
def require_auth() -> None:
    secret = os.environ.get("ALLOY_INTER_SERVICE_SECRET", "")
    if not secret:
        return  # open access (dev / Docker internal network)
    if request.endpoint == "health":
        return
    if request.headers.get("X-AI-Stack-Secret", "") != secret:
        return jsonify({"error": "Unauthorized"}), 401  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "service": "caveman-service",
        "version": "2.0.0",
        "ollama_url": CONFIG["ollama_url"],
    }), 200


@app.route("/config", methods=["GET"])
def get_config():
    return jsonify(CONFIG), 200


@app.route("/stats", methods=["GET"])
def stats():
    uptime = time.time() - float(STATS["start_time"])
    chars_in = int(STATS["total_chars_in"])
    chars_out = int(STATS["total_chars_out"])
    avg_savings = (
        (chars_in - chars_out) / chars_in * 100 if chars_in > 0 else 0.0
    )
    return jsonify({
        "requests_processed": STATS["requests_processed"],
        "total_chars_in": chars_in,
        "total_chars_out": chars_out,
        "average_savings_percent": round(avg_savings, 2),
        "ollama_calls": STATS["ollama_calls"],
        "fallback_calls": STATS["fallback_calls"],
        "uptime_seconds": int(uptime),
        "status": "healthy",
    }), 200


@app.route("/optimize", methods=["POST"])
def optimize():
    _stats_inc("requests_processed")

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    text: str = data.get("text", "")
    mode: str = data.get("mode", CONFIG["default_mode"])

    if not text:
        return jsonify({"error": "text field is required"}), 400
    if len(text) > CONFIG["max_text_length"]:
        return jsonify({
            "error": f"Text exceeds max length ({CONFIG['max_text_length']} chars)"
        }), 413
    if mode not in CONFIG["compression_modes"]:
        return jsonify({
            "error": f"mode must be one of: {', '.join(CONFIG['compression_modes'])}"
        }), 400

    _stats_inc("total_chars_in", len(text))
    logger.info("optimize request: %d chars, mode=%s", len(text), mode)

    with _SEMAPHORE:
        optimized, savings_pct = _run_compress(text, mode)

    _stats_inc("total_chars_out", len(optimized))

    return jsonify({
        "original": text,
        "optimized": optimized,
        "original_length": len(text),
        "optimized_length": len(optimized),
        "savings_pct": savings_pct,
        "savings_percent": savings_pct,
        "savings_bytes": len(text) - len(optimized),
        "mode": mode,
    }), 200


# ---------------------------------------------------------------------------
# Compression logic
# ---------------------------------------------------------------------------


def _run_compress(text: str, mode: str) -> tuple[str, float]:
    """
    Try CavemanCompressor (Ollama) first; fall back to pure-Python on failure.
    Runs async code in a fresh event loop to stay thread-safe under Flask.
    H5 fix: use explicit new_event_loop + close() to avoid loop-leak in threaded context.
    """
    # H5 fix: asyncio.run() creates and closes a loop internally but can clash
    # with running loops in some Flask versions. Explicit loop is always safe.
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_async_compress(text, mode))
        if result is not None:
            _stats_inc("ollama_calls")
            return result
    except Exception as exc:
        logger.warning("CavemanCompressor failed, using fallback: %s", exc)
    finally:
        loop.close()

    _stats_inc("fallback_calls")
    return _simple_compress(text, mode)


async def _async_compress(text: str, mode: str) -> tuple[str, float] | None:
    """Async wrapper â€” runs CavemanCompressor with Ollama."""
    try:
        from config import Settings
        s = Settings(ollama_url=CONFIG["ollama_url"])
        from alloy_compression.caveman import CavemanCompressor
        compressor = CavemanCompressor(s)
        compressed, savings = await compressor.compress(text, mode=mode)  # type: ignore[arg-type]
        if savings > 0:
            return compressed, savings
        # CavemanDetector said no compression needed â†’ return unchanged
        return text, 0.0
    except Exception:
        return None  # triggers pure-Python fallback in caller


# ---------------------------------------------------------------------------
# Pure-Python fallback â€” ported from ai-stack/scripts/caveman_server.py
# ---------------------------------------------------------------------------

_FILLER_WORDS = {
    "very", "really", "quite", "just", "simply", "basically",
    "actually", "literally", "certainly", "definitely", "probably",
    "seems", "appears", "arguably", "somewhat", "relatively",
}


def _simple_compress(text: str, mode: str) -> tuple[str, float]:
    """
    Deterministic filler-word removal.
    Matches the original ai-stack caveman_server.py fallback behaviour.
    """
    lines = text.splitlines()
    out_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # In full/ultra mode drop very short lines (likely noise)
        if mode in ("full", "ultra") and len(stripped) < 25:
            continue

        words = stripped.split()
        kept: list[str] = []
        for word in words:
            cleaned = word.lower().strip(".,!?;:")
            is_filler = cleaned in _FILLER_WORDS
            # ultra mode: also drop small stop-words
            is_small = len(cleaned) <= 3 and mode == "ultra"
            if not is_filler and not is_small:
                kept.append(word)

        if kept:
            out_lines.append(" ".join(kept))

    optimized = "\n".join(out_lines)
    savings = (len(text) - len(optimized)) / len(text) * 100 if text else 0.0
    logger.debug("simple_compress mode=%s savings=%.1f%%", mode, savings)
    return optimized, max(0.0, savings)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------


@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad request", "message": str(error)}), 400


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    logger.error("Internal error: %s", error)
    return jsonify({"error": "Internal server error"}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    host = os.environ.get("SERVER_HOST", "127.0.0.1")  # Docker sets SERVER_HOST=0.0.0.0 explicitly
    port = int(os.environ.get("SERVER_PORT", 5000))
    debug = os.environ.get("FLASK_ENV") == "development"

    logger.info("Starting Caveman Service on %s:%d (ollama=%s)", host, port, CONFIG["ollama_url"])
    app.run(host=host, port=port, debug=debug, threaded=True)
