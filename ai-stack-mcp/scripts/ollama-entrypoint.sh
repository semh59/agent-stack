#!/bin/bash
# Ollama entrypoint — starts the server, then pulls required models.
# Models are downloaded once; subsequent starts use the volume cache.
#
# Required models:
#   nomic-embed-text      — semantic cache embeddings (fast, small)
#   gemma4:e2b            — fast completions + prose compression
#
# Environment variables:
#   OLLAMA_MODELS_DIR     — override model storage dir (default: /root/.ollama)
#   SKIP_MODEL_PULL       — set to "1" to skip pulls (useful in CI)

set -euo pipefail

MODELS=(
    "nomic-embed-text"
    "gemma4:e2b"
)

log() { echo "[ollama-entrypoint] $*"; }

# Start Ollama server in background
log "Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait until server is accepting requests
log "Waiting for Ollama API to be ready..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
        log "Ollama ready after ${i}s"
        break
    fi
    if [ $i -eq 60 ]; then
        log "ERROR: Ollama did not start within 60s"
        kill $OLLAMA_PID 2>/dev/null
        exit 1
    fi
    sleep 1
done

# Pull models (skipped if SKIP_MODEL_PULL=1 e.g. in CI without GPU)
if [ "${SKIP_MODEL_PULL:-0}" = "1" ]; then
    log "SKIP_MODEL_PULL=1 — skipping model downloads"
else
    for model in "${MODELS[@]}"; do
        log "Checking model: $model"
        # Check if already present by listing tags
        if ollama list 2>/dev/null | grep -q "^${model%:*}"; then
            log "  -> already available, skipping pull"
        else
            log "  -> pulling $model (this may take a while)..."
            ollama pull "$model" && log "  -> $model ready" || log "  -> WARN: pull failed for $model"
        fi
    done
fi

log "All models ready. Ollama serving on :11434"

# Keep the server process in foreground (wait for its PID)
wait $OLLAMA_PID
