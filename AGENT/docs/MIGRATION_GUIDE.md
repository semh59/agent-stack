# Migration Guide (Breaking Changes)

This guide covers migration from pre-security-hardening builds to current `sovereign-ai`.

## 1) Gateway Security Defaults

### Breaking
- Gateway now binds to `127.0.0.1` by default.
- Gateway token is mandatory (`LOJINEXT_GATEWAY_TOKEN` / `authToken` option).
- `/api/*` and `/ws/*` endpoints reject unauthenticated requests.

### Required Action
1. Generate token: `npm run gateway:token:generate`
2. Export token in runtime environment:
   - PowerShell: `$env:LOJINEXT_GATEWAY_TOKEN='...'`
   - Bash: `export LOJINEXT_GATEWAY_TOKEN='...'`
3. Restart gateway.

## 2) Auth Result Contract

### Breaking
- Auth flow now uses machine-readable `errorCode` values (for example `OAUTH_STATE_MISMATCH`).
- Tests/integrations must assert `errorCode` rather than localized message text.

### Required Action
- Update any assertion/parsing logic to consume `errorCode`.

## 3) UI/Extension Messaging Contract

### Breaking
- Store/action parity is strict (`addAccount`, `removeAccount`).
- Gateway token propagation is required for both REST and WS flows.

### Required Action
- Ensure webview and extension payloads include auth token flow and typed actions.

## 4) CSP Policy

### Breaking
- Wildcard `connect-src` and `unsafe-eval` are not allowed.

### Required Action
- If extra endpoints are needed, add them through `sovereign.gatewayConnectOrigins`.
- Keep origin list explicit and minimal.

## 5) Script Names and Branding

### Breaking
- Canonical name is `sovereign-ai`.
- Legacy naming references are deprecated.

### Required Action
- Update internal docs/scripts to new naming.

## 6) Autonomous Session Contract (Budgets + WS Ticket)

### Breaking
- `POST /api/autonomy/sessions` now requires `budgets` object:
  - `maxCycles`
  - `maxDurationMs`
  - `maxInputTokens`
  - `maxOutputTokens`
  - `maxTPM`
  - `maxRPD`
  - `maxUsd` (optional telemetry only)
- WebSocket auth is now canonicalized around mission paths:
  - Canonical socket: `/ws/mission/:id`
  - Compatibility alias: `/ws/autonomy/:id`
  - Canonical ticket: `POST /api/missions/:id/ws-ticket`
  - Compatibility alias ticket: `POST /api/autonomy/sessions/:id/ws-ticket`
  - Connect with `?ticket=...` (single use, 60s TTL)

### Required Action
1. Update client payloads to always send budgets.
2. Replace direct token query WS connections with ticket flow and prefer the canonical mission path.
3. Handle new event type `budgetEvent` in UI/extension consumers.
4. Treat reconnect as snapshot-only; missed websocket events are not replayed.

## 7) Pause / Resume API

### Breaking
- New session lifecycle endpoints:
  - `POST /api/autonomy/sessions/:id/pause`
  - `POST /api/autonomy/sessions/:id/resume`

### Required Action
- Add pause/resume controls in UI and extension workflows.

## 8) Queue Mode (Single Worker FIFO)

### Breaking
- `POST /api/autonomy/sessions` now defaults to `startMode=queued`.
- New queue operations:
  - `GET /api/autonomy/queue`
  - `POST /api/autonomy/sessions/:id/cancel`
  - `POST /api/autonomy/sessions/:id/promote`

### Required Action
1. If client requires immediate execution, send `startMode: "immediate"`.
2. Update UI/store to consume `queueEvent` websocket payloads.
3. Read `queuePosition` from session list/create responses.

## 9) Legacy Deprecation Timeline

- `vNext`: Autonomous Mode is default, Legacy remains available.
- `vNext+2`: Legacy becomes read-only.
- `vNext+3`: Legacy mode is removed.

### Required Action
- Move automation workflows to autonomous session APIs before `vNext+2`.

## 10) Git Session Metadata + Failed Branch Cleanup

### Breaking
- Autonomy session payload now exposes `baseBranch` in addition to `branchName`.
- Failed `auto_branch_commit` sessions clean their temporary autonomy branch automatically when no commit was created.

### Required Action
1. If your tooling reads session metadata, include `baseBranch`.
2. Do not rely on failed `autonomy/*` branches remaining in repo for debugging; use session artifacts/log timeline instead.
