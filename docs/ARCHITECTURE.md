# Architecture

## System overview

The Sovereign AI Platform is a two-process system connected over HTTP:

1. **Gateway** — a TypeScript Fastify service that clients talk to. It owns authentication, the mission/session model, and the public HTTP surface. It speaks to the bridge internally.
2. **Optimization bridge** — a Python aiohttp service that runs the prompt-optimization pipeline. It is never exposed publicly; only the gateway (and in some deployments, internal operators) should reach it.

Everything else is a supporting dependency: Ollama (local LLMs), OpenRouter (cloud LLM fallback), ChromaDB + LanceDB (semantic stores), and SQLite (MAB state, cost log).

## Process topology

```
client → [ALB:443] → gateway (ECS task, 2 tasks)
                      │
                      │  HTTP (internal VPC)
                      ▼
                    bridge  (ECS task, 2 tasks)
                      │
                ┌─────┴─────┐
                ▼           ▼
             Ollama     OpenRouter
            (task/EC2)   (internet)
```

## Gateway (TypeScript)

- Entry point: `AGENT/src/main.ts`
- Framework: Fastify 4
- Runtime: `tsx` (we do not pre-compile; `tsconfig.json` uses `module: "Preserve"` + `allowImportingTsExtensions`)
- Auth: Google Sovereign AI OAuth, Claude OAuth, shared-secret bearer for the bridge

Request path for `/api/optimize`:
1. Fastify CORS + auth plugin checks `SOVEREIGN_GATEWAY_TOKEN`.
2. Route handler (`src/gateway/routes/optimize.ts`) forwards the body to the bridge.
3. Forwarded request includes `X-Bridge-Secret` and `X-Request-ID` (generated if absent).
4. Response is relayed back with status translation:
   - upstream timeout → 504
   - upstream unreachable → 503
   - upstream structured error → pass through

Shutdown is SIGTERM-aware: the server closes its connection pool, then `process.exit(0)`. A 10-second watchdog prevents hung shutdowns.

## Optimization bridge (Python)

- Entry point: `ai-stack-mcp/bridge.py`
- Framework: aiohttp
- Middleware: `correlation_and_error_middleware` — generates/propagates `X-Request-ID`, converts uncaught exceptions into structured JSON 500s

### Endpoint contract

| Method | Path            | Auth | Purpose |
|--------|-----------------|------|---------|
| GET    | `/health`       | no   | Liveness. Always 200 if process is up. |
| GET    | `/ready`        | no   | Readiness. 503 until orchestrator is initialized. |
| GET    | `/status`       | yes  | Pipeline component health. |
| GET    | `/cache-stats`  | yes  | Exact + semantic cache counters. |
| POST   | `/cache-clear`  | yes  | Body `{ "tier": "exact" | "semantic" | "all" }`. |
| POST   | `/optimize`     | yes  | Run the full pipeline. |
| GET    | `/cost-report`  | yes  | Aggregated token + spend report. Query: `period=today\|week\|month`. |

Authentication is a single header: `X-Bridge-Secret: <shared-secret>`. Compared with `hmac.compare_digest`. Missing or wrong → 401 with `{"error":"unauthorized"}`.

### Pipeline orchestrator

`ai-stack-mcp/pipeline/orchestrator.py → PipelineOrchestrator.optimize(...)`

Stages, in order:
1. **Cache lookup** — L1 exact match → L2 semantic match.
2. **Classify + score** — message type and complexity.
3. **Layer selection** — Thompson-Sampling MAB reorders candidate compression layers (`cli_cleaner`, `llmlingua`, `caveman`, `dedup`, `summarizer`, `noise_filter`, `rag`, `semantic_cache`).
4. **Apply layers** — each layer runs; only layers with ≥0.5% savings are kept and rewarded.
5. **Cost tracking** — record original vs sent tokens + chosen model.
6. **Cache store** — persist the optimized output.

Layer selection and reward updates are both `async` and are awaited in the orchestrator. Reward writes through to SQLite via `asyncio.to_thread`.

### State

| Store           | Kind         | Path                                       | Purpose |
|-----------------|--------------|--------------------------------------------|---------|
| Exact cache     | SQLite       | `${AI_STACK_DATA_DIR}/cache.db`            | Per-message fingerprint → optimized output |
| Semantic cache  | ChromaDB     | `${AI_STACK_DATA_DIR}/chromadb/`           | Embedding → nearest neighbour |
| MAB             | SQLite       | `${AI_STACK_DATA_DIR}/mab.db`              | α/β parameters per arm |
| Cost log        | SQLite       | `${AI_STACK_DATA_DIR}/cost.db`             | Per-request accounting |
| RAG docs        | LanceDB      | `${AI_STACK_DATA_DIR}/rag/`                | Indexed documentation corpus |

All stores are keyed by `AI_STACK_DATA_DIR`. In containers that's `/data` (mounted as a volume). Nothing persists to the image.

## Observability

- **Structured logs** — `structlog` on Python, `pino` on Node. JSON on `stdout`, picked up by the container runtime.
- **Correlation** — every request has a `X-Request-ID` (generated if the client didn't send one). It's threaded through the gateway → bridge and into every log line emitted for that request.
- **Metrics** — Prometheus endpoint on `:9090` on the bridge (optional; controlled by `metrics_port` in `config.py`).
- **Tracing** — OpenTelemetry OTLP exporter wired via `OTEL_EXPORTER_OTLP_ENDPOINT` when set; disabled otherwise.

## Failure modes and safeties

| Failure                                  | What happens |
|------------------------------------------|--------------|
| Bridge crashes                           | Gateway returns 503 on `/api/optimize`; ALB de-registers the unhealthy bridge task; ECS restarts it. |
| Bridge slow                              | Gateway returns 504 after request timeout. |
| `AI_STACK_BRIDGE_SECRET` missing in prod | Bridge exits with code 78 (EX_CONFIG). ECS task fails; alert fires. |
| Ollama unreachable                       | ModelCascade circuit-breaker opens; orchestrator falls back to OpenRouter. |
| OpenRouter quota exhausted               | Circuit-breaker opens; `/status` exposes breaker state; requests return degraded results rather than 500s. |
| Orchestrator uncaught exception          | Middleware returns structured 500 with `request_id`; client can correlate logs. |

## Security

- Bridge is never publicly exposed; only the gateway SG can reach port 9100.
- Bridge auth uses `hmac.compare_digest` (constant-time).
- CORS on the bridge is pinned to `BRIDGE_CORS_ORIGIN`.
- Secrets are read from AWS Secrets Manager at task-start time (via `secrets = [...]` on the task definition); they are never in the image or in Terraform state.
- Gateway rejects requests without `SOVEREIGN_GATEWAY_TOKEN`.
- Both services run as non-root (UID 10001) inside the container.

## What this monorepo does NOT include

- Multi-region / active-active — single region only.
- Database-layer persistence for the mission model — mission state lives in SQLite inside the gateway container (fine for dev; swap to RDS for prod scale).
- Auto-scaling policies — ECS service is fixed-count (`desired_count`) and `lifecycle { ignore_changes = [desired_count] }` lets you wire an external scaler later.
