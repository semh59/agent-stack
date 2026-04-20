# D1 Rebrand — Status as of 2026-04-20

## Done in-session (committed to tree)

| Area | File | Change |
|---|---|---|
| Gateway package | `AGENT/package.json` | name/desc/author/repo/homepage/bugs/keywords → `@sovereign/gateway`; NUL bytes stripped |
| VS Code extension manifest | `AGENT/vscode-extension/package.json` | name/displayName/publisher/keywords/commands/views/config → `sovereign*` |
| VS Code extension code | `extension.ts` | `console.log`, `getConfiguration("sovereign")`, command id `sovereign.startPipeline`, `SOVEREIGN_GATEWAY_TOKEN` env var (with `LOJINEXT_GATEWAY_TOKEN` fallback) |
| VS Code extension code | `ChatViewProvider.ts` | `viewType = "sovereign.chatView"`, config + env-var lookup |
| VS Code extension code | `BridgeManager.ts` | `sovereign.bridgeDiagnostics` command id |
| VS Code extension code | `VSCodeTerminalExecutor.ts`, `recovery.ts`, `TokenTracker.ts`, `ToolExecutionEngine.ts` | user-facing strings rebranded |
| Gateway auth | `src/gateway/gateway-auth-manager.ts` | generated token prefix `sovereign_` (scanner still accepts `sovereign_` for in-flight tokens) |
| Gateway scripts | `scripts/gateway-token.ts` | generated prefix `sovereign_` |
| Gateway boot | `scripts/start-gateway.ts` | env var + banner + dashboard label rebranded; keeps `LOJINEXT_GATEWAY_TOKEN` fallback |
| Agent CLI | `scripts/start-agent.ts` | header comment + success log rebranded |
| Python layer | `ai-stack-mcp/scripts/bootstrap.py`, `ai-stack-mcp/README.md` | brand strings rebranded |
| Repo tooling | `scripts/rebrand-to-sovereign.sh` (new) | automated dry-run/apply/commit rebrand sweep |

## Preserved by design (do NOT rename)

- `x-Sovereign-*` HTTP response header names in `AGENT/src/gateway/autonomy-session-manager.ts`. These are emitted by Google's Gemini CLI proxy; renaming them would silently drop usage accounting.
- `LOJINEXT_GATEWAY_TOKEN` env-var as **deprecated fallback** in the two boot paths (`start-gateway.ts`, `extension.ts`, `ChatViewProvider.ts`). Removing it would break existing deployments.
- `AUDIT_FINDINGS.md` and `AUDIT_VERIFICATION.md` — historical records. Post-rebrand content would re-write history.

## Remaining mechanical work (handled by rebrand script)

As of this writing: **~1993 raw occurrences across ~217 files**. These are mostly:

- docs (`README.md`, `CHANGELOG.md`, `docs/*.md`)
- identifier renames (`SovereignGatewayClient` → `SovereignGatewayClient`, `GoogleGeminiProvider` → `GoogleGeminiProvider`, `authorizeGoogleGemini` → `authorizeGoogleGemini`, `GOOGLE_GEMINI_PROVIDER_ID` → `GOOGLE_GEMINI_PROVIDER_ID`, `AIProvider.GOOGLE_GEMINI` → `AIProvider.GOOGLE_GEMINI`, `google_gemini` → `google_gemini`)
- directory rename `AGENT/src/sovereign/` → `AGENT/src/google-gemini/`
- file renames `sovereign-client.ts` → `gateway-client.ts` etc.
- CSS tokens `--color-loji-*` → `--color-sov-*`
- schema file `AGENT/assets/sovereign.schema.json`
- test JSON fixture `AGENT/.opencode_test/sovereign-accounts.json` (rename + content update)
- GitHub Actions workflows referencing npm package name

## How to run the sweep

```bash
# 1. Preview (no writes)
scripts/rebrand-to-sovereign.sh

# 2. Apply
scripts/rebrand-to-sovereign.sh --apply

# 3. Apply + commit
scripts/rebrand-to-sovereign.sh --commit

# 4. Verify
scripts/rebrand-to-sovereign.sh          # should report 0 affected (aside from preserved items)
npm run typecheck --prefix AGENT
npm test --prefix AGENT
```

## ⚠️ Breaking changes after the sweep

1. **npm package name changes** from `sovereign-ai` → `@sovereign/gateway`. Downstream consumers need to update their dependency.
2. **Public API export renames**: `SovereignCLIOAuthPlugin`, `authorizeGoogleGemini`, `exchangeGoogleGemini`, `SovereignAuthorization`, `SovereignTokenExchangeResult` in `AGENT/index.ts` → `SovereignGateway*` / `authorizeGoogleGemini` / `exchangeGoogleGemini`. This is a **semver-major** bump (1.4.6 → 2.0.0).
3. **VS Code extension command IDs change**: `sovereign.startPipeline` → `sovereign.startPipeline`, `sovereign.bridgeDiagnostics` → `sovereign.bridgeDiagnostics`. Users of the extension will lose their existing keyboard bindings; documented in `CHANGELOG.md` entry.
4. **VS Code configuration keys change**: `sovereign.gatewayAuthToken` → `sovereign.gatewayAuthToken`. Users must re-enter the value. The extension could add a migration hook at activate time as a follow-up.
5. **Token prefix changes** for newly issued gateway tokens (`sovereign_` → `sovereign_`). Existing tokens continue to work — the scanner regex already accepts both.
6. **Provider id changes**: `google_gemini` → `google_gemini`. Anything that stores this as a persisted enum (account pool JSON files, settings DB) needs a one-time migration.

## Suggested migration hook (future work)

- Add a VS Code `activate()` migration that reads `sovereign.gatewayAuthToken` once, copies it to `sovereign.gatewayAuthToken`, and clears the old key.
- Add a gateway startup migration that reads the `AccountPool` JSON, flips `"provider":"google_gemini"` rows to `"google_gemini"`, and writes back atomically.
