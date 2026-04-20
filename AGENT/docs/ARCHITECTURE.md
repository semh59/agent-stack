# Architecture Guide

**Last Updated:** March 2026

This document explains how the Sovereign AI plugin works, including the request/response flow, Claude-specific handling, and session recovery.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  OpenCode ──▶ Plugin ──▶ Sovereign AI API ──▶ Claude/Gemini      │
│     │           │              │                   │            │
│     │           │              │                   └─ Model     │
│     │           │              └─ Google's gateway (Gemini fmt) │
│     │           └─ THIS PLUGIN (auth, transform, recovery)      │
│     └─ AI coding assistant                                      │
└─────────────────────────────────────────────────────────────────┘
```

The plugin intercepts requests to `generativelanguage.googleapis.com`, transforms them for the Sovereign AI API, and handles authentication, rate limits, and error recovery.

---

## Module Structure

```
src/
├── index.ts                 # Plugin exports
├── plugin.ts                # Main entry, fetch interceptor
├── constants.ts             # Endpoints, headers, config
├── sovereign/
│   └── oauth.ts             # OAuth token exchange
└── plugin/
    ├── auth.ts              # Token validation & refresh
    ├── request.ts           # Request transformation (main logic)
    ├── request-helpers.ts   # Schema cleaning, thinking filters
    ├── thinking-recovery.ts # Turn boundary detection, crash recovery
    ├── recovery.ts          # Session recovery (tool_result_missing)
    ├── quota.ts             # Quota checking (API usage stats)
    ├── cache.ts             # Auth & signature caching
    ├── cache/
    │   └── signature-cache.ts # Disk-based signature persistence
    ├── config/
    │   ├── schema.ts        # Zod config schema
    │   └── loader.ts        # Config file loading
    ├── accounts.ts          # Multi-account management
    ├── server.ts            # OAuth callback server
    └── debug.ts             # Debug logging
```

---

## Request Flow

### 1. Interception (`plugin.ts`)

```typescript
fetch() intercepted → isGenerativeLanguageRequest() → prepareSovereign AIRequest()
```

- Account selection (round-robin, rate-limit aware)
- Token refresh if expired
- Endpoint fallback (daily → autopush → prod)

### 2. Request Transformation (`request.ts`)

| Step | What Happens |
|------|--------------|
| Model detection | Detect Claude/Gemini from URL |
| Thinking config | Add `thinkingConfig` for thinking models |
| Thinking strip | Remove ALL thinking blocks (Claude) |
| Tool normalization | Convert to `functionDeclarations[]` |
| Schema cleaning | Remove unsupported JSON Schema fields |
| ID assignment | Assign IDs to tool calls (FIFO matching) |
| Wrap request | `{ project, model, request: {...} }` |

### 3. Response Transformation (`request.ts`)

| Step | What Happens |
|------|--------------|
| SSE streaming | Real-time line-by-line TransformStream |
| Signature caching | Cache `thoughtSignature` for display |
| Format transform | `thought: true` → `type: "reasoning"` |
| Envelope unwrap | Extract inner `response` object |

---

## Claude-Specific Handling

### Why Special Handling?

Claude through Sovereign AI requires:
1. **Gemini format** - `contents[].parts[]` not `messages[].content[]`
2. **Thinking signatures** - Multi-turn needs signed blocks or errors
3. **Schema restrictions** - Rejects `const`, `$ref`, `$defs`, etc.
4. **Tool validation** - `VALIDATED` mode requires proper schemas

### Thinking Block Strategy (v2.0)

**Problem:** OpenCode stores thinking blocks, but may corrupt signatures.

**Solution:** Strip ALL thinking blocks from outgoing requests.

```
Turn 1 Response: { thought: true, text: "...", thoughtSignature: "abc" }
                 ↓ (stored by OpenCode, possibly corrupted)
Turn 2 Request:  Plugin STRIPS all thinking blocks
                 ↓
Claude API:      Generates fresh thinking
```

**Why this works:**
- Zero signature errors (impossible to have invalid signatures)
- Same quality (Claude sees full conversation, re-thinks fresh)
- Simpler code (no complex validation/restoration)

### Thinking Injection for Tool Use

Claude API requires thinking before `tool_use` blocks. The plugin:

1. Caches signed thinking from responses (`lastSignedThinkingBySessionKey`)
2. On subsequent requests, injects cached thinking before tool_use
3. Only injects for the **first** assistant message of a turn (not every message)

**Turn boundary detection** (`thinking-recovery.ts`):
```typescript
// A "turn" starts after a real user message (not tool_result)
// Only inject thinking into first assistant message after that
```

---

## Session Recovery

### Tool Result Missing Error

When a tool execution is interrupted (ESC, timeout, crash):

```
Error: tool_use ids were found without tool_result blocks immediately after
```

**Recovery flow** (`recovery.ts`):

1. Detect error via `session.error` event
2. Fetch session messages via `client.session.messages()`
3. Extract `tool_use` IDs from failed message
4. Inject synthetic `tool_result` blocks:
   ```typescript
   { type: "tool_result", tool_use_id: id, content: "Operation cancelled" }
   ```
5. Send via `client.session.prompt()`
6. Optionally auto-resume with "continue"

### Thinking Block Order Error

```
Error: Expected thinking but found text
```

**Recovery** (`thinking-recovery.ts`):

1. Detect conversation is in tool loop without thinking at turn start
2. Close the corrupted turn with synthetic messages
3. Start fresh turn where Claude can generate new thinking

---

## Schema Cleaning

Claude rejects unsupported JSON Schema features. The plugin uses an **allowlist approach**:

**Kept:** `type`, `properties`, `required`, `description`, `enum`, `items`

**Removed:** `const`, `$ref`, `$defs`, `default`, `examples`, `additionalProperties`, `$schema`, `title`

**Transformations:**
- `const: "value"` → `enum: ["value"]`
- Empty object schema → Add placeholder `reason` property

---

## Multi-Account Load Balancing

### How It Works

1. **Sticky selection** - Same account until rate limited (preserves cache)
2. **Per-model-family** - Claude/Gemini rate limits tracked separately
3. **Dual quota (Gemini)** - Sovereign AI + Gemini CLI headers
4. **Automatic failover** - On 429, switch to next available account

### Account Storage

Location: `~/.config/opencode/sovereign-accounts.json`

Contains OAuth refresh tokens - treat as sensitive.

---

## Mission REST API Catalog

Canonical Phase 3 mission routes live under `/api/missions/*`.

- The websocket ticket helper `POST /api/missions/:id/ws-ticket` is part of Mission Control, but it is **not** counted as one of the 10 canonical mission REST endpoints.
- Legacy `/api/v1/missions*` paths are not canonical.

| Method | Path | Auth | Request | Success | Important Errors |
|---|---|---|---|---|---|
| `POST` | `/api/missions` | Gateway bearer or same-origin local gateway access | `{ prompt, model? }` where `model` is `smart_multi \| fast_only \| pro_only` | `201` -> `{ id, state: "received", createdAt }` | `401 UNAUTHORIZED`, `422 VALIDATION_ERROR` |
| `GET` | `/api/missions/:id` | Gateway bearer or same-origin local gateway access | none | `200` -> full `MissionModel` | `404 MISSION_NOT_FOUND` |
| `GET` | `/api/missions/:id/plan` | Gateway bearer or same-origin local gateway access | none | `200` -> `MissionPlan` | `404 PLAN_NOT_READY`, `404 MISSION_NOT_FOUND` |
| `POST` | `/api/missions/:id/approve` | **Explicit bearer only** | none | `200` -> `{ id, state: "coding" }` | `401 UNAUTHORIZED`, `422 INVALID_STATE_TRANSITION`, `404 MISSION_NOT_FOUND` |
| `POST` | `/api/missions/:id/pause` | Gateway bearer or same-origin local gateway access | none | `200` -> `{ id, state: "paused" }` | `422 INVALID_STATE_TRANSITION`, `404 MISSION_NOT_FOUND` |
| `POST` | `/api/missions/:id/resume` | Gateway bearer or same-origin local gateway access | none | `200` -> `{ id, state: <pre-pause logical state> }` | `422 INVALID_STATE_TRANSITION`, `404 MISSION_NOT_FOUND` |
| `POST` | `/api/missions/:id/cancel` | Gateway bearer or same-origin local gateway access | none | `200` -> `{ id, state: "cancelled" }` | `422 INVALID_STATE_TRANSITION`, `404 MISSION_NOT_FOUND` |
| `GET` | `/api/missions/:id/artifacts` | Gateway bearer or same-origin local gateway access | `?cursor=<artifact_id>&limit=<1..200>` | `200` -> artifacts with `meta.nextCursor`, `meta.hasMore`, `meta.total` | `422 VALIDATION_ERROR`, `404 MISSION_NOT_FOUND` |
| `GET` | `/api/missions/:id/timeline` | Gateway bearer or same-origin local gateway access | `?cursor=<event_id>&limit=<1..200>` | `200` -> ascending timeline page with `meta.nextCursor`, `meta.hasMore` | `422 VALIDATION_ERROR`, `404 MISSION_NOT_FOUND` |
| `GET` | `/api/missions/:id/budget` | Gateway bearer or same-origin local gateway access | none | `200` -> TPM/RPD/cycles/efficiency envelope | `404 MISSION_NOT_FOUND` |

Implementation notes:

- `POST /api/missions` performs an active-token preflight. An email alone is not enough; the active Sovereign AI token must also be valid or refreshable.
- The plan-review checkpoint is represented as `state: "paused"` plus `reviewStatus: "plan_pending"`.
- Successful REST responses always use `{ data, meta, errors: [] }`. Errors always use `{ data: null, meta, errors: [{ code, message }] }`.

Validation artifacts:

- Manual runbook: `docs/PHASE3_VALIDATION_RUNBOOK.md`
- Latest live verification report: `docs/PHASE3_VALIDATION_REPORT.md`

---

## Mission Control WebSocket Reconnect

Mission Control uses a canonical mission socket per selected mission: `/ws/mission/:id`.

- Legacy alias remains available: `/ws/autonomy/:id`.
- WebSocket auth uses short-lived single-use tickets:
  - Canonical: `POST /api/missions/:id/ws-ticket`
  - Compatibility alias: `POST /api/autonomy/sessions/:id/ws-ticket`
  - This helper route belongs to Mission Control, but it is not counted in the canonical 10 mission REST endpoints above.
- The Gateway sends a **state snapshot immediately on connect/reconnect**.
- Snapshot payload includes the current selected session summary, queue, timeline, artifacts, budgets, and touched files.
- UI consumers replace their local mission view state from this snapshot instead of replaying missed events.
- **Missed events are not replayed.** Reconnect recovery is snapshot-only by design.
- The client keeps at most one active mission socket for the selected mission and only schedules reconnect after the prior socket is fully closed.

### WebSocket Event Catalog

- `created`: mission row/runtime session became visible to Mission Control.
- `state`: phase start transition.
- `step`: phase completion transition.
- `model_switch`: gear start event.
- `gear_completed`: task/model execution finished successfully.
- `gear_failed`: task/model execution failed and recovery routing begins.
- `gate_result`: strict gate pass/fail payload.
- `gate_bypass`: verify phase explicitly bypassed because no file-changing gate run was required.
- `verify` can still be valid with `touchedFiles=[]` for no-file task types (for example `analysis`, `finalize`); warning logs for that path are opt-in via `SOVEREIGN_WARN_VERIFY_NO_TOUCHED=1`.
- `budget`: current budget snapshot; `warning=true` is the `budget:warning` semantic alias.
- `artifact`: plan / change summary / context pack updates.
- `decision_log`: DecisionMatrix reasoning node.
- `diff_ready`: touched file list update.
- `done`, `failed`: terminal mission outcomes.
- `interrupted`: websocket alias for a user STOP that ultimately becomes runtime `stopped`.
- `stopped`: queued cancel or non-interactive stop that is not classified as `interrupted`.

### Snapshot Fallback Rules

- Snapshot source priority is:
  1. live in-memory autonomy session
  2. persisted mission row from SQLite
- Persisted-only snapshots may legitimately return:
  - `cycleCount: 0`
  - `timeline: []`
  - `queue: []`
- The `queue` field is always the **live scheduler queue snapshot** from `AutonomySessionManager`.
- Persisted missions are **not** reinserted into queue snapshots synthetically.

This keeps reconnect behavior deterministic and avoids duplicate listeners or drift between mission state, timeline, gate status, and budget state.

---

## Budget Boundary Behavior

Mission budgets now use Sovereign AI-facing TPM/RPD quotas instead of USD cost.

- **TPM warning:** when rolling one-minute token usage reaches **90%** of `maxTPM`, the engine emits a `budget` event with `warning: true`.
- **RPD warning:** when rolling 24-hour request count reaches **90%** of `maxRPD`, the engine emits the same warning shape.
- **Warning outcome:** the mission continues, and the next cycle is routed with `BUDGET_EXCEEDED` so the model router downgrades away from the current model.
- **Hard stop:** `currentTPM >= maxTPM` or `requestsUsed >= maxRPD` sets `exceeded: true`.
- **Hard stop outcome:** the autonomy engine emits `failed`; the Orchestrator republishes that as `mission.failed`. It does **not** convert the session into a manual stop.
- **USD telemetry:** `usdUsed` may still be tracked for observability, but it is no longer part of the circuit breaker.

Example quota boundary:

- `950 / 1000` TPM -> `budget:warning`, mission continues on downgraded model.
- `9 / 10` RPD -> `budget:warning`, mission continues on downgraded model.
- `1000 / 1000` TPM or `10 / 10` RPD -> hard stop and mission failure.

---

## Mock Latency and Recovery Behavior

Before switching autonomy traffic to a real Sovereign AI mission path, the orchestration client supports deterministic network simulation and graceful recovery:

- **Mock latency:** internal header `x-sovereign-mock-latency-ms` delays dispatch without forwarding that header upstream.
- **Abort-aware waits:** both mock latency waits and 429 retry sleeps respect the request `AbortSignal`, so a mission STOP interrupts the network path instead of waiting for the timeout window to finish.
- **Model request timeout:** `AutonomySessionManager` enforces a local fail-fast timeout via `AbortSignal.timeout(...)`.
  - Default is **`90_000ms`** (`AbortSignal.timeout(90_000)`).
  - This is a local safety default, **not** an Sovereign AI provider SLA guarantee.
  - It is configurable per manager instance with `modelRequestTimeoutMs`.
  - Value calibration is operational: tune with production p95/p99 latency telemetry per model/gear.
- **OAuth expiry:** a 401 during mission execution triggers a single refresh attempt. If refresh fails, the wrapper returns a controlled JSON error response instead of throwing an uncaught exception.
- **Retry-after strategy:** 429 handling prefers server-provided `retry-after` / `RetryInfo` delays before falling back to the generic backoff policy.

This keeps pre-production mission simulations close to real model timing while preserving deterministic STOP, retry, and failure semantics.

---

## Mission Persistence Strategy

Phase 3.1 mission persistence is **SQLite-backed with runtime snapshot recovery**.

- Default DB path: `~/.config/sovereign/missions.db` via `xdg-basedir`.
- SQLite runs in **WAL mode** with `foreign_keys=ON` and `busy_timeout=5000`.
- The repository contract stays async even though `better-sqlite3` is synchronous internally.
- Mission state is split across:
  - `missions`
  - `mission_gate_results`
  - `mission_timeline`
  - `mission_budget_snapshots`
- `runtime_snapshot_json` is stored on the mission row and is the source of truth for exact resume.
- Upper layers depend on the `MissionRepository` interface, not a storage-specific implementation.

### Startup Recovery

- The **gateway is the recovery authority**.
- On startup, the gateway scans interrupted missions in states:
  - `received`
  - `planning`
  - `plan_review`
  - `coding`
  - `verifying`
- Pending recoveries are exposed through authenticated endpoints:
  - `GET /api/autonomy/recovery/pending`
  - `POST /api/autonomy/recovery/:id/resume`
  - `POST /api/autonomy/recovery/:id/cancel`
- VS Code extension activation pulls this queue and asks the user to resume or cancel each interrupted mission.
- **SIGKILL semantics:** process-level `SIGKILL` cannot be caught by Node.js runtime handlers, so no graceful in-process terminal event is expected in that failure mode.
  - Recovery is intentionally handled on the next startup by scanning interrupted missions and hydrating persisted runtime snapshots.

### Resume and Corruption Handling

- Resume hydrates the saved `AutonomySession` back into the in-memory autonomy manager.
- Recovered sessions revalidate touched files before continuing.
- Existing file-based session op-logs remain as auxiliary artifacts; SQLite is the persistence source of truth.
- On corruption, `missions.db`, `missions.db-wal`, and `missions.db-shm` are renamed to `*.corrupt.<timestamp>` and a clean DB is created.

### MissionService Bootstrap Limitation

- `MissionService.create()` starts runtime first, then performs persistence bootstrap with `create()` and `saveRuntimeSnapshot()`.
- If bootstrap persistence fails, the service performs a best-effort `cancelMission()` to avoid leaving a live untracked session behind.
- If that cancel attempt also fails, the runtime session may remain orphaned.
- When no mission row was durably written, startup recovery cannot find that orphan because it scans SQLite state only.
- Manual cleanup is required in that case.

### Known Limitation: Sunk Token Cost

- During retry/backtrack cycles (for example after verify/gate failures), already spent input/output tokens are **not refunded**.
- Budget usage is monotonic by design (`inputTokensUsed`, `outputTokensUsed`, `usdUsed` only increase).
- This is an intentional simplification in PhaseEngine/BudgetTracker to keep accounting deterministic.

---

## Gateway REST Middleware

Gateway REST responses use a single JSON envelope:

- Success: `{ data, meta, errors: [] }`
- Error: `{ data: null, meta, errors: [{ code, message }] }`
- `meta` always includes `timestamp` and Fastify `requestId`

### Rate Limit Strategy

- Rate limiting is applied only to `/api/*` REST routes, not static UI paths or `/ws/*`.
- The identity chain is:
  - `x-api-key`
  - bearer token from `Authorization`
  - fallback `anonymous`
- Default gateway limit is **100 requests per 60 seconds per identity**.
- A limit breach returns `429` with `errors[0].code = "RATE_LIMIT"` and `errors[0].retryAfter`.

### Known Limitation: Shared Anonymous Bucket

- Clients that send neither `x-api-key` nor bearer auth all share the same `anonymous` bucket.
- In practice this means the browser UI, VS Code extension, Telegram notifier, or CLI can consume the same fallback 100/60s budget if they omit both identifiers.
- Single-user local operation is usually fine, but this behavior must be considered when debugging unexpected local 429s.

### Approve Auth Rule

- `POST /api/missions/:id/approve` uses stricter auth than the general gateway hook.
- It requires an explicit bearer token.
- Query-token auth, `x-api-key`, and local same-origin bypass do not satisfy approve authorization.

---

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENCODE_SOVEREIGN_DEBUG` | `1` or `2` for debug logging |
| `OPENCODE_SOVEREIGN_QUIET` | Suppress toast notifications |

### Config File

Location: `~/.config/opencode/sovereign.json`

```json
{
  "session_recovery": true,
  "auto_resume": true,
  "resume_text": "continue",
  "keep_thinking": false
}
```

---

## Key Functions Reference

### `request.ts`

| Function | Purpose |
|----------|---------|
| `prepareSovereign AIRequest()` | Main request transformation |
| `transformSovereign AIResponse()` | SSE streaming, format conversion |
| `ensureThinkingBeforeToolUseInContents()` | Inject cached thinking |
| `createStreamingTransformer()` | Real-time SSE processing |

### `request-helpers.ts`

| Function | Purpose |
|----------|---------|
| `deepFilterThinkingBlocks()` | Recursive thinking block removal |
| `cleanJSONSchemaForSovereign AI()` | Schema sanitization |
| `transformThinkingParts()` | `thought` → `reasoning` format |

### `thinking-recovery.ts`

| Function | Purpose |
|----------|---------|
| `analyzeConversationState()` | Detect turn boundaries, tool loops |
| `needsThinkingRecovery()` | Check if recovery needed |
| `closeToolLoopForThinking()` | Inject synthetic messages |

### `recovery.ts`

| Function | Purpose |
|----------|---------|
| `handleSessionRecovery()` | Main recovery orchestration |
| `createSessionRecoveryHook()` | Hook factory for plugin |

---

## Debugging

### Enable Logging

```bash
export OPENCODE_SOVEREIGN_DEBUG=2  # Verbose
```

### Log Location

`~/.config/opencode/sovereign-logs/`

### What To Check

1. Is `isClaudeModel` true for Claude models?
2. Are thinking blocks being stripped?
3. Are tool schemas being cleaned?
4. Is session recovery triggering?

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `invalid signature` | Corrupted thinking block | Update plugin (strips all thinking) |
| `Unknown field: const` | Schema uses `const` | Plugin auto-converts to `enum` |
| `tool_use without tool_result` | Interrupted execution | Session recovery injects results |
| `Expected thinking but found text` | Turn started without thinking | Thinking recovery closes turn |
| `429 Too Many Requests` | Rate limited | Plugin auto-rotates accounts |

---

## See Also

- [SOVEREIGN_API_SPEC.md](./SOVEREIGN_API_SPEC.md) - API reference
- [OAUTH.md](./OAUTH.md) - OAuth system technical reference
- [README.md](../README.md) - Installation & usage

