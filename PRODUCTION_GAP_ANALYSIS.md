# Sovereign AI Platform — Production Readiness Gap Analysis

_Generated: 2026-04-19 · Grounded in actual repo contents, not docs._

## Scope

Target: make the whole monorepo (`AGENT/` TS gateway + `ai-stack-mcp/` Python engine) **cloud-deployable**, starting from its current state.

This document is the output of step 2 (Gap Analysis) of the production readiness plan. Each gap below is concrete, has a severity, and maps to a deliverable in `PRODUCTION_TASK_PLAN.md`.

## Severity legend

| Code | Meaning |
|------|---------|
| **P0** | Blocker — the stack does not build or run as currently wired. Ship-stopper. |
| **P1** | Required for a credible staging/prod deploy. |
| **P2** | Quality/maintainability — should land before GA. |
| **P3** | Nice-to-have — future iteration. |

## 1. Build & runtime wiring

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| B-01 | `docker-compose.unified.yml` references `./AGENT/Dockerfile` but no such file exists. The unified stack cannot be built. | **P0** | `ls AGENT/Dockerfile` → not found; compose line 35. |
| B-02 | `AGENT/vscode-extension` listed as an npm workspace in root `package.json` but the directory does not exist at the workspace root. `npm ci` at root will fail in CI. | **P0** | `package.json` `workspaces` includes `AGENT/vscode-extension`; nothing on disk. |
| B-03 | `ai-stack-mcp/Dockerfile` defaults to `CMD ["python", "-m", "pytest", …]`. Running `docker compose up optimization-bridge` works only because compose overrides the command, but an ad-hoc `docker run ai-stack-mcp` will run tests, not the service. | P1 | Dockerfile final `CMD`. |
| B-04 | No `Dockerfile` for the Node gateway — even once B-01 is fixed. Needs multi-stage, non-root, healthcheck, pinned Node LTS, `npm ci --omit=dev` in runtime. | **P0** | Missing. |
| B-05 | `npm run dev` points at `scripts/dev-runner.js` which does not exist. | P1 | `ls scripts/` at root → no file. |

## 2. Configuration management

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| C-01 | Only one `.env.example` at repo root; no per-environment templates (`.env.development`, `.env.staging`, `.env.production`). Operators have no canonical way to flip envs in Docker/ECS. | P1 | `ls .env*`. |
| C-02 | Node gateway reads env vars ad hoc across many files; no typed config module comparable to Python's `Settings`. Silent default drift between dev/prod. | P1 | `grep process.env` across `AGENT/src/`. |
| C-03 | `AI_STACK_BRIDGE_SECRET` is optional. If unset, `bridge.py` generates an ephemeral token at `~/.ai-stack-mcp/.bridge_secret`. In containers with read-only rootfs or distinct gateway/bridge filesystems (which is the intended topology), the gateway cannot read that file — silent auth failure. | **P0** | `bridge.py` lines 74–85. |
| C-04 | No secret-management story: compose wires secrets via plain env vars. No plan for AWS Secrets Manager / SOPS / Vault. | P1 | `docker-compose.unified.yml` `environment:` stanzas. |
| C-05 | Multiple conflicting bridge ports (`.env.example` says 9100, compose uses 9100, `LOJINEXT_GATEWAY_PORT` default is 51122 in env but compose says 3000). Not inherently broken but guaranteed to confuse operators. | P2 | Cross-check `.env.example` vs compose. |

## 3. Authentication & authorization

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| A-01 | Bridge auth is a single shared secret in `X-Bridge-Secret`. No rotation, no per-caller identity, no request signing or replay protection. Acceptable for same-network dev; insufficient for cloud. | P1 | `bridge.py` `_check_auth`. |
| A-02 | Gateway's public REST has `GatewayAuthManager` bearer + CSRF middleware, but no rate-limit layer per-IP by default — only mentioned in a rest middleware registration. Needs explicit rate-limiter (`@fastify/rate-limit`) with Redis backing for multi-replica deploys. | P1 | `src/gateway/rest-middleware.ts`. |
| A-03 | Token store is SQLite-backed (`token-store.ts`). Single-replica by design; needs either sticky sessions or a shared token store (Redis/DB) once we scale past one ECS task. | P1 | `token-store.ts`. |

## 4. Data layer

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| D-01 | SQLite files (`test-missions-forensic.db` + 14 `*.corrupt.*` backups) are in the AGENT repo. SQLite is fine for single-node dev but wrong for horizontal scaling. No Postgres migration path documented. | P1 | `ls AGENT/*.db*`. |
| D-02 | Cache tiers (`cache/exact.py`, `cache/semantic.py`) use local sqlite + Chroma. For cloud, semantic cache should back on a shared vector store (Qdrant/Chroma-in-Postgres/OpenSearch) so cache hits persist across replicas. | P2 | `cache/semantic.py`. |
| D-03 | LanceDB + Chroma both wired as RAG stores — two stores for one responsibility. Pick one for prod. | P2 | `requirements.txt` + `rag/indexer.py`. |
| D-04 | No migration tooling for either DB. | P1 | No `alembic`, no `prisma migrate`, no custom runner. |

## 5. Observability

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| O-01 | `metrics.py` starts a Prometheus exporter on a dedicated port, but the stack has no Prometheus server, no Grafana, no Loki/Promtail. Metrics are emitted into the void. | P1 | `metrics.py` + absence of observability compose. |
| O-02 | Logs are `structlog` (Python) + `pino-pretty` (Node). No shared format; no log shipping to CloudWatch/Loki. | P1 | `bridge.py` imports; `AGENT/package.json` deps. |
| O-03 | No tracing (OpenTelemetry) anywhere. Cross-service latency debugging is blind. | P2 | No `opentelemetry-*` imports. |
| O-04 | No SLOs, no error budgets, no alerting rules. | P2 | N/A. |

## 6. Error handling

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| E-01 | `bridge.py` handlers do not wrap calls to `orch.optimize()` in try/except. An orchestrator exception returns a 500 without structure or correlation ID. | P1 | `bridge.py` handlers. |
| E-02 | No correlation-ID propagation between gateway and bridge. A request failing in the bridge cannot be traced back to the originating gateway request. | P1 | No correlation header in either service. |

## 7. Testing

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| T-01 | No cross-service integration test — nothing boots both services and verifies an end-to-end request. `test_handshake.js` at root only validates CORS preflight. | P1 | `test_handshake.js`. |
| T-02 | No load/perf test. `pipeline/mab.py` has a reward logic worth quantifying under load. | P2 | N/A. |
| T-03 | Python `pytest` integration tests are gated on a live Ollama. No mocked-Ollama CI path. | P2 | `tests/integration/test_ollama.py`. |

## 8. CI/CD

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| CI-01 | `AGENT/.github/workflows/ci.yml` exists but is scoped to AGENT. It assumes `ui/` and `vscode-extension/` sibling to itself, neither of which is present at that path. It will break on first push. | **P0** | CI yaml paths vs actual tree. |
| CI-02 | No root-level CI for the monorepo. No Python lint/test job. No Docker build/push job. | **P0** | `ls .github/workflows/` → directory does not exist at root. |
| CI-03 | No security scanning (dependency audit, image scan, secret scan at repo boundary). | P1 | N/A. |
| CI-04 | No release automation — version bumps, changelog generation, image tagging. | P2 | N/A. |

## 9. Infrastructure as Code

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| IaC-01 | Zero cloud IaC in the repo. No Terraform, no Pulumi, no Helm, no CDK. | **P0** | N/A. |
| IaC-02 | No environment separation beyond `.env.example`. | P1 | N/A. |
| IaC-03 | No deploy runbook (who runs `terraform apply`, rollback procedure, blue/green strategy). | P1 | N/A. |

## 10. Documentation

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| DOC-01 | No root-level `README.md`. A newcomer cannot orient themselves. | P1 | `ls README.md` at root → not found. |
| DOC-02 | Architecture docs are scattered: `AGENT_STACK_CTO_TECHNICAL_ANALYSIS.md`, `DEEP_ANALYSIS_REPORT.md`, `PROJE_DERIN_ANALIZ_VE_FAZ_PLANI.md` (Turkish), `walkthrough.md`, `AGENT/docs/ARCHITECTURE.md`. No single canonical entry. | P2 | File listing. |
| DOC-03 | No REST API reference enumerating each gateway+bridge endpoint with request/response/examples. | P1 | No `API.md`. |
| DOC-04 | No setup guide that a fresh operator can follow to get the stack running on their laptop. | P1 | `walkthrough.md` describes what was built, not how to run it. |

## 11. Repo hygiene

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| H-01 | `test.log` (1.2 MB) checked in at root. | P2 | `ls -la test.log`. |
| H-02 | 14 `*.db.corrupt.YYYYMMDD*` SQLite backups in `AGENT/`. | P2 | Listing. |
| H-03 | `AGENT/tsc_output*.txt`, `AGENT/test_result.txt`, etc. — build artifacts tracked in VCS. | P2 | Listing. |
| H-04 | `AGENT/.tmp_stress_test*` scratch dirs left over. | P2 | Listing. |

## 12. Scalability & performance

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| S-01 | Gateway binds to single process (Fastify). For ECS Fargate, need multiple replicas + shared state (token store, rate-limiter). | P1 | `server.ts`. |
| S-02 | Bridge initializes the orchestrator lazily on first request. Cold-start latency spikes. Pre-warm on startup. | P1 | `bridge.py` `_get_orch`. |
| S-03 | Chroma + LanceDB bundled in-process; 1GB+ memory footprint possible. Consider sidecar deployments. | P2 | Requirements. |
| S-04 | No request timeouts end-to-end (gateway→bridge→Ollama). A hung Ollama hangs the bridge hangs the gateway. | P1 | Grep for timeouts. |

## Prioritized summary

- **P0 (ship-stoppers):** B-01, B-02, B-04, C-03, CI-01, CI-02, IaC-01.
- **P1 (staging bar):** A-01, A-02, A-03, D-01, D-04, E-01, E-02, O-01, O-02, T-01, DOC-01, DOC-03, DOC-04, S-01, S-02, S-04, C-01, C-02, C-04, B-03, B-05, CI-03, IaC-02, IaC-03.
- **P2 (polish):** A-01 rotation, D-02, D-03, O-03, O-04, T-02, T-03, CI-04, DOC-02, H-01–H-04, S-03.

## What this document is not

It is **not** a rewrite plan for the 69K lines of TypeScript business logic. The gateway and optimization engine look genuinely well-built and are out of scope for this pass. The goal is to wrap working code in the production infrastructure it deserves.
