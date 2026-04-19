# Production Readiness — Ordered Task Plan

Each task maps back to a gap ID from `PRODUCTION_GAP_ANALYSIS.md`. Every task has an explicit, verifiable success criterion.

## Ordering rationale

1. Unblock the build first (you cannot test a stack that does not start).
2. Fix auth/config holes that affect runtime correctness.
3. Add tests and observability so every later change is trustworthy.
4. Ship CI/CD + IaC.
5. Document.
6. Improvements backlog.

## Task list

### Batch 1 — Unblock build (P0)

| # | Gap(s) | Task | Success criterion |
|---|--------|------|-------------------|
| 1 | B-01, B-04 | Create `AGENT/Dockerfile` — multi-stage, non-root, healthcheck, pinned Node 20 LTS. | `docker build -t gateway ./AGENT` succeeds; final image runs as UID≠0; healthcheck passes. |
| 2 | B-02 | Fix root `package.json` workspaces — remove `AGENT/vscode-extension` or create a stub. | `npm ls --workspaces` does not error at root. |
| 3 | B-03 | Fix `ai-stack-mcp/Dockerfile` default CMD to run the MCP server, not pytest. Test job moved to separate target. | `docker run ai-stack-mcp` starts the server; CI still runs pytest via `--target test`. |
| 4 | B-05 | Replace broken `npm run dev` with a real monorepo dev runner or remove the entry. | `npm run dev` runs or is removed cleanly. |
| 5 | C-03 | Make `AI_STACK_BRIDGE_SECRET` strictly required in non-dev environments; fail fast and loud if missing. Remove ephemeral-file fallback for prod. | `NODE_ENV=production` bridge refuses to start without the secret. Dev path still works locally. |

### Batch 2 — CI/CD baseline (P0)

| # | Gap(s) | Task | Success criterion |
|---|--------|------|-------------------|
| 6 | CI-02 | Add root `.github/workflows/ci.yml` for the monorepo: lint + typecheck + unit tests (TS and Python) + Docker build in parallel jobs. | PR checks green on a clean branch. |
| 7 | CI-01 | Fix or retire the nested `AGENT/.github/workflows/ci.yml` — stop referencing paths that don't exist. | Either delete or rewrite to actual paths. |
| 8 | CI-03 | Security scanning: `npm audit`, `pip-audit`, `gitleaks`, Trivy image scan. | CI fails on HIGH/CRITICAL CVEs. |
| 9 | CI-04 | Docker image build + publish job on `main`, tagged with SHA and `latest-main`. | Images appear in GHCR on each merge. |

### Batch 3 — Runtime hardening (P1)

| # | Gap(s) | Task | Success criterion |
|---|--------|------|-------------------|
| 10 | C-01, C-04 | Per-env config templates: `.env.development`, `.env.staging`, `.env.production`. Documented precedence rules. | Operator can switch env by swapping one file. |
| 11 | E-01, E-02 | Bridge — structured error wrapper + `X-Request-ID` correlation propagated gateway→bridge. | Hitting an endpoint with an ID header shows the same ID in both services' logs. |
| 12 | S-02, S-04 | Bridge pre-warms orchestrator on startup. Client timeouts set on Ollama and OpenRouter calls. | First request latency < 200ms p50 after boot. Hanging upstream returns 504 within N seconds, not infinite. |
| 13 | O-01, O-02 | Add `docker-compose.observability.yml` — Prometheus scrapes both services + Grafana with a starter dashboard. | `docker compose -f docker-compose.unified.yml -f docker-compose.observability.yml up` serves dashboards at :3001. |
| 14 | T-01 | Root smoke-test harness — boot bridge, hit each of 9 endpoints, verify shape. Runs standalone + in CI. | `scripts/smoke.sh` exits 0 against a running stack. |

### Batch 4 — Cloud-deployable infra (P0/P1)

| # | Gap(s) | Task | Success criterion |
|---|--------|------|-------------------|
| 15 | IaC-01, IaC-02 | Terraform AWS module: VPC + ALB + ECS Fargate (two services) + RDS Postgres + ElastiCache Redis + Secrets Manager + IAM. | `terraform plan` produces a sane graph with no hardcoded secrets. |
| 16 | IaC-03 | Deploy runbook + rollback procedure. | `docs/RUNBOOK.md` answers "how do I deploy?" and "how do I roll back?". |

### Batch 5 — Docs (P1)

| # | Gap(s) | Task | Success criterion |
|---|--------|------|-------------------|
| 17 | DOC-01, DOC-04 | Root `README.md` + `docs/SETUP.md` — a fresh operator runs the stack in ≤10 minutes. | Measured by following docs on a clean machine (mental test). |
| 18 | DOC-03 | `docs/API.md` — every gateway + bridge endpoint with request/response examples. | All 9 bridge endpoints + every gateway route documented. |
| 19 | DOC-02 | `docs/ARCHITECTURE.md` at repo root — single canonical diagram and data-flow doc. | Replaces the scattered analysis files as the entry point. |

### Batch 6 — Hygiene & continuous improvement (P2/P3)

| # | Gap(s) | Task | Success criterion |
|---|--------|------|-------------------|
| 20 | H-01 to H-04 | `.gitignore` updates + list of files to remove. | Instructions in `docs/CLEANUP.md`; no silent git-rm from this agent. |
| 21 | all | `docs/IMPROVEMENTS.md` — ranked backlog of next-quarter work. | Concrete, sized, prioritized. |

## Dependency graph (compressed)

```
1,2,3,4 ─┬─▶ 6,7 ─▶ 8,9 ─▶ 15,16 ─▶ done
         │
         ▼
         5 ─▶ 11,12 ─▶ 13,14
                     │
                     └▶ 17,18,19,20,21
```

Tasks 1–4 block everything; 5 blocks 11–12 (auth/timeout touch the same files). 15–16 (Terraform) can run in parallel with 13–14 once 1–9 are green.
