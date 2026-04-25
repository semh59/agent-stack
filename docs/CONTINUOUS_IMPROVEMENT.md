# Continuous improvement — next 90 days

Concrete follow-ups grounded in what I hit while bringing the stack to a production-deployable baseline. Sorted by impact.

## P0 — do before the next release

### 1. Fix `better-sqlite3` build for Linux CI/CD

**Symptom.** `invalid ELF header` when running gateway vitest on Linux — the committed `node_modules` ships Windows-compiled native binaries.

**Root cause.** The `node_modules` directory is committed (or copied) from a Windows machine instead of being rebuilt in each environment.

**Fix.**
- Stop committing `node_modules/`. Add `node_modules/` to `.gitignore` if not already.
- Ensure CI runs `npm ci` fresh. The new `.github/workflows/ci.yml` already does this.
- Delete any `node_modules/` that's been committed.

### 2. Pin TypeScript + ts-node to installable versions

`AGENT/package.json` previously requested `typescript@^6.0.3` and `ts-node@^11.0.0` — neither exists on npm. `npm install` failed until I pinned to `^5.9.3` and `^10.9.2` (which matched what was actually in `node_modules`).

Sweep the rest of `devDependencies` for version drift with:

```bash
cd AGENT && npx npm-check-updates -r
```

### 3. Document the `APP_ENV`/`NODE_ENV` contract

The bridge now refuses to boot in `APP_ENV in {staging, production}` without `ALLOY_BRIDGE_SECRET`. This is correct behaviour but is easy to trip on a laptop. `docs/OPERATIONS.md` and `env/.env.*` cover it now; a one-line startup log message naming the gate would make it unmissable:

```python
logger.info("bridge_boot_gate", app_env=_APP_ENV, secret_present=bool(_BRIDGE_SECRET))
```

## P1 — do in the next sprint

### 4. Promote the smoke suite from "CI-green" to "always-green"

`scripts/smoke.sh` covers 9 endpoints; the suite caught the `select_layers` coroutine bug. Grow it:

- Add a case that sends a large `context` array — shakes out semantic-cache encoding.
- Add a case that forces `force_layers: ["rag"]` — exercises the LanceDB path.
- Add a `/optimize` case with a deliberately bad payload (`{"message": 42}`) — should get a 400, not a 500.

### 5. Wire `/metrics` Prometheus endpoint

`config.py` now has `metrics_port: int = 9090`. Actually expose it:

```python
from aiohttp_prometheus_exporter.handler import metrics
app.router.add_get("/metrics", metrics)
```

Then add a sidecar scrape config in the ECS task definition and dashboard the golden signals.

### 6. Replace `test_bridge_middleware.py`'s `make_mocked_request` shim with a real test client

It's a workable shim but the pytest-asyncio/aiohttp loop conflict will bite again when someone adds a middleware test that needs a real socket. Pin `pytest-asyncio>=0.23` with `asyncio_mode = strict` in `pytest.ini`, then use `aiohttp_client` the normal way.

### 7. Gateway: split `src/gateway/server.ts` into smaller files

`forensic.test.ts` is 58 tests in one file — the file itself is the signal that `server.ts` is doing too much. Extract:
- Health + OAuth preflight into `server-health.ts`
- Mission routing into `server-missions.ts`
- WebSocket + SSE into `server-stream.ts`

Keeps test files small and makes OOM during `vitest run` less likely.

## P2 — do when planning the quarter

### 8. Replace SQLite with Postgres for MAB + cost log

SQLite is fine for a single-task bridge; it breaks the moment you scale `desired_count > 1` (each task has its own MAB state — learning gets fragmented). Promote those two stores to a managed Postgres when you add a second bridge replica.

### 9. Drop the `module: "Preserve"` + `tsx` runtime in favor of compiled JS

`tsx` is fast to iterate on but the Docker image carries a whole TypeScript toolchain at runtime. Compile to JS in a builder stage, ship only the compiled `dist/`. Needs `moduleResolution: "nodenext"` + explicit `.js` extensions.

Trade-off: more churn in source files (`.js` extensions everywhere), but the runtime image drops ~120MB.

### 10. Multi-region

Current Terraform is single-region. For real prod, split `terraform/envs/production` into `production-us-east-1/` and `production-eu-west-1/`, add Route 53 latency routing, and make sure both the bridge's cache stores and the MAB SQLite can survive one region being offline (answer: they can't — see #8).

### 11. Kill the `production.yml` stub workflow

I kept it as a noop because I couldn't delete files (sandbox FS). Once on a real filesystem, delete `.github/workflows/production.yml` — `ci.yml` is the only real pipeline.

### 12. Bridge test coverage below 50%

`pytest --cov` will show a big gap around `pipeline/compression/`, `pipeline/rag/`, and `pipeline/cost_tracker.py`. Target 70% line coverage before onboarding a second engineer to the codebase.

### 13. Add dependency scanning to CI

`npm audit --production` + `pip-audit` + `trivy fs` on both Docker images. Failing the CI job on HIGH/CRITICAL forces the team to keep the dep tree clean.

## What's deliberately NOT on this list

- **Re-architecting the pipeline.** The orchestrator → layer → MAB → cache flow is sound. The bugs I found were mis-awaited coroutines and a missing Dockerfile, not design flaws.
- **Swapping Fastify for Express/Koa.** Fastify is the right call; the perf and schema story is better than either alternative.
- **Rewriting in Rust / Go.** No.
