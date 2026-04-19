# Autonomous Mode Contract (vNext)

Canonical contract for the role-less autonomy runtime. Implementation must follow this document.

## 1) State Machine

`queued -> init -> plan -> execute -> verify -> reflect -> (retry | done | failed | stopped | paused)`

Transition rules:
- `plan` can only start from `init` or `retry`.
- `queued` sessions enter `init` only when FIFO scheduler starts them.
- `execute` can only start from `plan`.
- `verify` can only start from `execute`.
- `reflect` can only start from `verify`.
- `retry` only after execution/gate failure.
- `done` only after strict gate passes and finalize task completes.
- `failed` on budget exhaustion, retry exhaustion, or hard preconditions.
- `paused` only via API pause request.

## 2) Session Request Contract

`POST /api/autonomy/sessions` required payload:

- `account: string`
- `anchorModel: string`
- `objective: string`
- `scope: { mode: "selected_only"; paths: string[] }`
- `modelPolicy: "smart_multi"`
- `gitMode: "auto_branch_commit" | "patch_only"`
- `startMode: "queued" | "immediate"` (default `queued`)
- `budgets: { maxCycles, maxDurationMs, maxInputTokens, maxOutputTokens, maxTPM, maxRPD, maxUsd? }`

Queue API:
- `GET /api/autonomy/queue`
- `POST /api/autonomy/sessions/:id/cancel`
- `POST /api/autonomy/sessions/:id/promote`

## 3) WebSocket Contract

Canonical mission WS URL:
- `/ws/mission/:id?ticket=...`

Compatibility alias:
- `/ws/autonomy/:id?ticket=...`

Ticket lifecycle:
- Canonical ticket via `POST /api/missions/:id/ws-ticket`
- Compatibility alias via `POST /api/autonomy/sessions/:id/ws-ticket`
- TTL: 60 seconds
- Single-use

Reconnect behavior:
- Gateway sends a full snapshot immediately on connect/reconnect.
- Missed events are not replayed.
- If no live runtime session exists, snapshot falls back to persisted mission state.

Event payload mapping:
- `created` -> mission visible in Mission Control
- `state` / `step` -> timeline
- `diff_ready` -> diff panel
- `gate_result` / `gate_bypass` -> gate panel
- `budget` -> budget panel
- `model_switch` / `gear_completed` / `gear_failed` -> model + gear timeline
- `decision_log` -> decision matrix timeline
- `queue` -> queue lane updates (`queueEvent`)
- `done` / `failed` / `stopped` / `interrupted` -> terminal / stop state updates

## 4) Error Codes / Hard Fail Contracts

- Scope violation: `SCOPE_VIOLATION`
- Auth mismatch: `OAUTH_STATE_MISMATCH`
- Budget stop: `BUDGET_EXCEEDED`
- Missing git repo in auto branch mode: `FAILED_PRECONDITION_GIT_REPO`

## 5) Immutable Quality Gates

Root:
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run security:scan`

UI:
- `npm run lint --prefix ui`
- `npm run build --prefix ui`

Extension:
- `npm run compile --prefix vscode-extension`
- `npm run lint --prefix vscode-extension`
- `npm run build --prefix vscode-extension`

Security:
- `npm audit --json` with release policy `critical=0`, `high=0`

## 6) Git Automation Contract

- `gitMode=auto_branch_commit` requires an existing git repository.
- Session captures `baseBranch` at start, then creates `autonomy/<session>-<objective>` branch.
- `done` state commits only touched session files.
- `failed` state with no commit triggers failed-branch cleanup:
  - checkout `baseBranch`
  - delete failed autonomy branch
