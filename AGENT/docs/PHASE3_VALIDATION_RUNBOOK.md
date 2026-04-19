# Phase 3 Validation Runbook

This runbook validates the canonical Phase 3 mission surface against a live local gateway.

## Preconditions

1. Start the gateway:

```powershell
npm run gateway:start
```

2. Generate or export a gateway bearer token:

```powershell
npm run gateway:token:generate
$env:TOKEN="<generated-token>"
```

3. Confirm an active mission account exists:

```powershell
curl.exe -s "http://127.0.0.1:51122/api/accounts/active" `
  -H "Authorization: Bearer $env:TOKEN"
```

If no active account is configured, run:

```powershell
npm run agent:auth
```

4. Shared variables:

```powershell
$env:BASE="http://127.0.0.1:51122"
$env:MISSION_A=""
$env:MISSION_B=""
```

## Canonical Mission REST Validation

### 1. Create mission A

```powershell
curl.exe -s -X POST "$env:BASE/api/missions" `
  -H "Authorization: Bearer $env:TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"prompt\":\"Validate Phase 3 mission endpoints\",\"model\":\"smart_multi\"}"
```

Expected: `201`, `data.id`, `data.state == "received"`, `errors == []`

### 2. Get mission A

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_A" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, full mission object, `meta.timestamp`, `meta.requestId`

### 3. Get mission A plan

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_A/plan" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, `MissionPlan`

### 4. Get mission A artifacts

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_A/artifacts?limit=50" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, `meta.nextCursor`, `meta.hasMore`, `meta.total`

### 5. Get mission A timeline page 1

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_A/timeline?limit=1" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, ascending order, `meta.nextCursor`

### 6. Get mission A timeline page 2 using cursor

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_A/timeline?limit=50&cursor=<nextCursor>" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, no offset drift, only post-cursor events

### 7. Get mission A budget

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_A/budget" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, `tpm`, `rpd`, `cycles`, `efficiency`, `warning`, `exceeded`

### 8. Approve mission A

The approval checkpoint is represented as `state: "paused"` plus `reviewStatus: "plan_pending"`.

```powershell
curl.exe -s -X POST "$env:BASE/api/missions/$env:MISSION_A/approve" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, `data.state == "coding"`

### 9. Pause mission A

```powershell
curl.exe -s -X POST "$env:BASE/api/missions/$env:MISSION_A/pause" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, `data.state == "paused"`

### 10. Resume mission A

```powershell
curl.exe -s -X POST "$env:BASE/api/missions/$env:MISSION_A/resume" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, `data.state` reflects the pre-pause logical mission state

### 11. Create mission B

```powershell
curl.exe -s -X POST "$env:BASE/api/missions" `
  -H "Authorization: Bearer $env:TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"prompt\":\"Cancel mission B\",\"model\":\"fast_only\"}"
```

### 12. Cancel mission B

```powershell
curl.exe -s -X POST "$env:BASE/api/missions/$env:MISSION_B/cancel" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `200`, `data.state == "cancelled"`

## Representative Error Checks

### Empty prompt

```powershell
curl.exe -s -X POST "$env:BASE/api/missions" `
  -H "Authorization: Bearer $env:TOKEN" `
  -H "Content-Type: application/json" `
  -d "{\"prompt\":\"\"}"
```

Expected: `422 VALIDATION_ERROR`

### Missing mission

```powershell
curl.exe -s "$env:BASE/api/missions/missing" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `404 MISSION_NOT_FOUND`

### Plan not ready

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_B/plan" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `404 PLAN_NOT_READY`

### Approve without bearer

```powershell
curl.exe -s -X POST "$env:BASE/api/missions/$env:MISSION_A/approve"
```

Expected: `401 UNAUTHORIZED`

### Cursor limit overflow

```powershell
curl.exe -s "$env:BASE/api/missions/$env:MISSION_A/timeline?limit=201" `
  -H "Authorization: Bearer $env:TOKEN"
```

Expected: `422 VALIDATION_ERROR`

## WebSocket Validation

1. Issue a ticket:

```powershell
curl.exe -s -X POST "$env:BASE/api/missions/$env:MISSION_A/ws-ticket" `
  -H "Authorization: Bearer $env:TOKEN"
```

2. Connect with `wscat` or an equivalent client:

```powershell
npx wscat -c "ws://127.0.0.1:51122/ws/mission/$env:MISSION_A?ticket=<ticket>"
```

Expected:

- first message is a `snapshot`
- payload includes `selectedSession`, `timeline`, `artifacts`, `budgets`, `queue`

Reconnect proof:

1. connect and save the first snapshot
2. disconnect the socket
3. mutate mission state via REST, such as `approve`, `pause`, or `resume`
4. issue a new ticket and reconnect
5. only the current snapshot should arrive; missed event replay should not occur

## Rate Limit Validation

Use a dedicated API-key bucket:

```powershell
1..101 | ForEach-Object {
  curl.exe -s "$env:BASE/api/health" -H "x-api-key: phase3-verification" | Out-Null
}
```

Expected on request `101`:

- `429`
- `errors[0].code == "RATE_LIMIT"`
- `errors[0].retryAfter` exists
- `Retry-After` header exists

## Acceptance Checklist

- all 10 canonical mission REST endpoints smoke-tested
- websocket snapshot and reconnect verified
- rate limit `429` verified
- every checked endpoint returns the `{ data, meta, errors }` envelope
- timeline cursor pagination validated
- `docs/ARCHITECTURE.md` and `docs/PHASE3_VALIDATION_REPORT.md` updated
