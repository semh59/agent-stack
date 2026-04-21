# syntax=docker/dockerfile:1.7
#
# bridge — Optimization Bridge (HTTP) + MCP Server (stdio)
# Multi-stage. Three targets:
#
#   --target runtime  (default)  — production image running bridge.py on port 9100
#   --target test                — runs `pytest -v` at build time (used by CI)
#   --target mcp-stdio           — image for the stdio MCP server (server.py)
#
# Build:
#   docker build -t bridge .                     # runtime (bridge)
#   docker build -t bridge:test --target test .  # CI test image
#   docker build -t bridge:mcp --target mcp-stdio .
#
# Run:
#   docker run --rm -p 9100:9100 \
#     -e AI_STACK_BRIDGE_SECRET=change-me \
#     bridge
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: dependency builder ----
FROM python:3.11-slim-bookworm AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# ---- Stage 2: shared runtime scaffolding ----
FROM python:3.11-slim-bookworm AS runtime-base

WORKDIR /app

COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 \
      curl \
      tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 aistack \
    && useradd --system --uid 10001 --gid aistack --home-dir /app --shell /sbin/nologin aistack

COPY --chown=aistack:aistack . .

RUN mkdir -p /data && chown aistack:aistack /data
VOLUME ["/data"]

USER aistack

ENV AI_STACK_DATA_DIR=/data \
    AI_STACK_OLLAMA_URL=http://ollama:11434 \
    PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LOG_LEVEL=INFO

# ---- Stage 3: CI test target ----
FROM runtime-base AS test
USER root
# pytest + plugins are listed in requirements.txt already
CMD ["python", "-m", "pytest", "tests/", "-v", "--tb=short"]

# ---- Stage 4: stdio MCP server ----
FROM runtime-base AS mcp-stdio
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "server.py"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import server; import pipeline.orchestrator" || exit 1

# ---- Stage 5: HTTP bridge (DEFAULT runtime) ----
FROM runtime-base AS runtime
EXPOSE 9100
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "bridge.py", "--port", "9100", "--host", "0.0.0.0"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --max-time 3 http://localhost:9100/health || exit 1
