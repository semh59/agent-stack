# syntax=docker/dockerfile:1.7
#
# Alloy AI Gateway — Node.js Fastify service
#
# Uses tsx at runtime because the TS source relies on
# `moduleResolution: bundler` (no explicit .js extensions) and the project
# convention is to run via tsx. This avoids forcing a bundler step and keeps
# stack traces pointing at .ts source lines.
#
# Build:
#   docker build -t alloy-gateway ./AGENT
# Run:
#   docker run --rm -p 3000:3000 \
#     -e ALLOY_GATEWAY_TOKEN=... \
#     -e ALLOY_BRIDGE_SECRET=... \
#     alloy-gateway
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: dependency install (with build tools for native modules) ----
FROM node:20.11.1-bookworm-slim AS deps

WORKDIR /app

# System deps for better-sqlite3 and other native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./

# Install everything
RUN npm install

# tsx is a runtime requirement
RUN npm install tsx@4.19.2

# ---- Stage 2: optional typecheck (catches drift before ship) ----
FROM deps AS typecheck
COPY tsconfig.json tsconfig.build.json index.ts ./
COPY src ./src
COPY scripts ./scripts
# Fail the build if types are broken.
RUN npx tsc --noEmit -p tsconfig.json

# ---- Stage 3: runtime ----
FROM node:20.11.1-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      tini \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 gateway \
    && useradd --system --uid 10001 --gid gateway --home-dir /app --shell /sbin/nologin gateway

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    ALLOY_GATEWAY_PORT=3000 \
    ALLOY_GATEWAY_HOST=0.0.0.0 \
    PATH="/app/node_modules/.bin:${PATH}" \
    XDG_CONFIG_HOME=/data/.config \
    XDG_DATA_HOME=/data/.local/share

COPY --from=deps    --chown=gateway:gateway /app/node_modules ./node_modules
COPY                --chown=gateway:gateway package.json tsconfig.json tsconfig.build.json ./
COPY                --chown=gateway:gateway index.ts ./
COPY                --chown=gateway:gateway src ./src
COPY                --chown=gateway:gateway scripts ./scripts

# Trim dev-only packages from runtime node_modules but keep tsx (installed above).
# `npm prune --omit=dev` respects `--no-save` installs, so tsx stays.
RUN npm prune --omit=dev --no-audit --no-fund

RUN mkdir -p /data/.config /data/.local/share /app/.npm && chown -R gateway:gateway /data /app/.npm
VOLUME ["/data"]

USER gateway

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["tsx", "src/main.ts"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --max-time 3 http://localhost:3000/api/health || exit 1
