# Critical Fix Execution Map

This document defines hard step dependencies, security defaults, and quality gates for critical-fix mode.

## 1) Step Dependency Map

| Step | Depends On | Must Finish Before | Hard Exit Criteria |
| --- | --- | --- | --- |
| 1. Auth contract (`errorCode`) | - | 2, 11, 13 | Auth tests deterministic, no locale-based string checks |
| 2. UI store contract parity | 1 | 3, 8, 11, 13 | `addAccount`/`removeAccount` typed and implemented |
| 3. UI lint debt cleanup | 2 | 11 | `ui` lint = 0 |
| 4. Extension lint foundation | 2 | 8, 11 | extension lint reproducible and green |
| 5. Broken script cleanup | 2 | 11 | package scripts runnable (no ENOENT/MODULE_NOT_FOUND) |
| 6. TerminalExecutor injection hardening | - | 11, 13 | metachar bypass cases blocked with tests |
| 7. Gateway secure defaults | 1 | 8, 11, 13 | host localhost-only + token required on `/api/*` and `/ws/*` |
| 8. REST/WS auth propagation | 2, 4, 7 | 9, 11, 13 | same token policy on REST + WS |
| 9. CSP narrowing | 8 | 11 | no wildcard connect-src, no unsafe-eval |
| 10. Dependency risk reduction | - | 11 | audit policy satisfied |
| 11. CI quality gates | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 | release | root/ui/extension stages + release gate |
| 12. Branding/docs unification | 5 | release | `alloy-ai` canonical naming + migration note |
| 13. Critical test debt closure | 1, 2, 6, 7, 8 | release | no critical `it.skip`/`it.todo` left in scoped areas |

## 2) Token Lifecycle (Gateway/Auth)

- Generation: `npm run gateway:token:generate`
- Rotation: `npm run gateway:token:rotate` (recommended every 30 days, mandatory on incident response)
- Runtime rotation: `POST /api/gateway/token/rotate` keeps previous token in grace window (default 60 sec) while new token becomes active.
- Grace revoke: `POST /api/gateway/token/revoke-grace` immediately invalidates grace tokens.
- Storage: keep token in environment (`ALLOY_GATEWAY_TOKEN`), do not commit to source.
- Transport: bearer token for REST, WS token enforced through same validation policy.
- WS auth: autonomy channel uses single-use ticket (`POST /api/autonomy/sessions/:id/ws-ticket`, TTL 60s).
- Logging: gateway request logs redact auth header and `token`/`ticket` query values.

## 3) CSP Allowlist Policy

Default `connect-src`:
- `webview.cspSource`
- `http://127.0.0.1:51122`
- `ws://127.0.0.1:51122`

Optional additions:
- VS Code setting: `alloy.gatewayConnectOrigins` (strict origin list, no wildcard)

Disallowed:
- `connect-src *`
- `unsafe-eval`

## 4) Audit Policy (Severity-Based)

Release gate policy:
- `critical = 0` (blocker)
- `high` vulnerabilities must be actively reduced and tracked; fix direct deps first, then transitive chains.
- `moderate/low` are backlog with owner + due date.

## 5) CI Parallel Stage Strategy

- Stages run in parallel: `root-quality`, `ui-quality`, `extension-quality`.
- Final `release-gate` job aggregates stage results and fails if any stage failed.
- Concurrency is enabled to cancel stale in-progress runs on the same ref.
