# OAuth System Technical Reference

**Last Updated:** April 2026

This document provides a deep technical reference for the Sovereign AI OAuth authentication system — covering token lifecycle, multi-account management, load balancing, quota protection, and gateway authentication.

---

## Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        OAuth Architecture                            │
│                                                                      │
│  Browser ──▶ Google OAuth2 ──▶ Local Callback Server                │
│                                  │                                   │
│                                  ▼                                   │
│                          Authorization Code                          │
│                                  │                                   │
│                                  ▼                                   │
│                    sovereign/oauth.ts (PKCE + Exchange)            │
│                                  │                                   │
│                          ┌────────┴────────┐                        │
│                          ▼                 ▼                         │
│                   Access Token       Refresh Token                   │
│                          │                 │                         │
│                          ▼                 ▼                         │
│                    plugin/auth.ts    plugin/token.ts                 │
│                    plugin/cache.ts   plugin/refresh-queue.ts         │
│                          │                                           │
│                          ▼                                           │
│                 plugin/accounts.ts (Multi-Account Manager)           │
│                    │           │            │                        │
│                    ▼           ▼            ▼                        │
│              Load Balance  Rate Limit   Quota Check                  │
│              (sticky/rr/   (cooldown,   (quota.ts)                   │
│               hybrid)      backoff)                                  │
│                          │                                           │
│              ┌───────────┴───────────┐                               │
│              ▼                       ▼                               │
│       Plugin Layer            Gateway Layer                          │
│       (CLI/OpenCode)          (Server/WS)                            │
│       plugin/server.ts        gateway/auth-server.ts                 │
│                                  gateway/token-store.ts              │
│                                  gateway/browser-launcher.ts         │
└──────────────────────────────────────────────────────────────────────┘
```

### External Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `@openauthjs/openauth/pkce` | `sovereign/oauth.ts` | PKCE code generation |
| `async-lock` | `gateway/token-store.ts` | Per-key async serialization |
| `node-machine-id` | `plugin/key-manager.ts`, `gateway/token-store.ts` | Machine-bound encryption key derivation |

---

## File Inventory

| File | Lines | Size | Responsibility |
|------|-------|------|----------------|
| `src/constants.ts` | 270 | 8.2 KB | OAuth constants, endpoint definitions, header styles |
| `src/sovereign/oauth.ts` | ~200 | — | OAuth token exchange (authorize → exchange), PKCE state management |
| `src/plugin/auth.ts` | 46 | 1.8 KB | Token validation and refresh helpers |
| `src/plugin/token.ts` | ~150 | — | Access token refresh logic |
| `src/plugin/types.ts` | — | — | Core type definitions (`OAuthAuthDetails`, `RefreshParts`) |
| `src/plugin/accounts.ts` | 1,075 | 41.5 KB | Multi-account management, load balancing, rate limit calculation |
| `src/plugin/rotation.ts` | 551 | — | Hybrid account selection (`HealthScoreTracker`, `TokenBucketTracker`) |
| `src/plugin/storage.ts` | — | — | Storage types (`AccountStorageV3`, `ModelFamily`, `HeaderStyle`, `CooldownReason`) |
| `src/plugin/quota.ts` | 345 | 12 KB | Quota checking (API usage statistics) |
| `src/plugin/cache.ts` | 202 | 7.1 KB | Auth and signature caching |
| `src/plugin/cache/signature-cache.ts` | ~150 | — | Disk-based signature persistence |
| `src/plugin/config/schema.ts` | ~200 | — | Zod-based configuration schema |
| `src/plugin/config/loader.ts` | ~100 | — | Configuration file loading |
| `src/plugin/persist-account-pool.ts` | 169 | 5.9 KB | Account pool persistence |
| `src/plugin/refresh-queue.ts` | 284 | 8.9 KB | Proactive background token refresh |
| `src/plugin/key-manager.ts` | 144 | 5.1 KB | API anahtar yönetimi |
| `src/plugin/fingerprint.ts` | 188 | 5.8 KB | Device fingerprint generation and headers |
| `src/plugin/server.ts` | ~150 | — | Plugin OAuth callback server |
| `src/plugin/project.ts` | 279 | 9.1 KB | Google Cloud project discovery |
| `src/gateway/auth-server.ts` | 229 | — | Gateway OAuth callback server |
| `src/gateway/token-store.ts` | 277 | — | Encrypted multi-account token storage + refresh |
| `src/gateway/browser-launcher.ts` | 87 | — | Browser OAuth flow launcher |
| `src/gateway/gateway-auth-manager.ts` | 161 | — | Gateway bearer token authorization + WS ticket manager |
| `src/gateway/oauth-port.ts` | 46 | — | OAuth callback port availability check |
| `src/gateway/pkce.ts` | 26 | — | PKCE utility (`generatePKCE()`) |

---

## OAuth Flow

### Authorization Code Flow with PKCE

The system uses Google OAuth2 Authorization Code flow with **PKCE** (Proof Key for Code Exchange) for enhanced security.

```
┌────────┐     ┌──────────┐     ┌──────────────┐     ┌─────────────┐
│ Client  │     │ Browser  │     │ Google OAuth2│     │ Sovereign AI │
│ (Plugin │     │          │     │ Server       │     │ API         │
└───┬─────┘     └────┬─────┘     └──────┬───────┘     └──────┬──────┘
    │                │                  │                    │
    │ 1. Generate    │                  │                    │
    │    PKCE pair   │                  │                    │
    │    (verifier + │                  │                    │
    │    challenge)  │                  │                    │
    │                │                  │                    │
    │ 2. Open browser with              │                    │
    │    authorize URL + challenge      │                    │
    │───────────────▶│                  │                    │
    │                │ 3. User auths    │                    │
    │                │─────────────────▶│                    │
    │                │                  │                    │
    │                │ 4. Redirect to   │                    │
    │                │    callback URL  │                    │
    │                │    with auth code│                    │
    │                │◀─────────────────│                    │
    │                │                  │                    │
    │ 5. Local server captures code     │                    │
    │◀───────────────│                  │                    │
    │                │                  │                    │
    │ 6. Exchange code + verifier       │                    │
    │    for tokens  │                  │                    │
    │─────────────────────────────────────────────────────▶ │
    │                │                  │                    │
    │ 7. Receive access_token +         │                    │
    │    refresh_token                  │                    │
    │◀──────────────────────────────────────────────────────│
    │                │                  │                    │
```

### Step-by-Step

| Step | Component | What Happens |
|------|-----------|--------------|
| 1 | `sovereign/oauth.ts` | `PKCEStateManager` generates `verifier` + SHA256 `challenge`, stores in server-side session map (10-min TTL, one-time use) |
| 2 | `gateway/browser-launcher.ts` → `launchOAuthBrowser()` or CLI | Opens browser to `accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256` |
| 3 | Google | User authenticates and consents |
| 4 | Google | Redirects to `http://127.0.0.1:{port}/oauth-callback?code=...&state=...` |
| 5 | `plugin/server.ts` or `gateway/auth-server.ts` | Local HTTP server captures the callback, extracts `code` and `state` |
| 6 | `sovereign/oauth.ts` → `exchangeSovereign AI()` | Sends `code` + `verifier` + `client_secret` to Sovereign AI token endpoint |
| 7 | Response | Receives `access_token` (short-lived ~1h), `refresh_token` (long-lived), `expiry_date` |

### PKCE Implementations

Two PKCE modules exist in the codebase:

| Module | Used By | Implementation |
|--------|---------|----------------|
| `PKCEStateManager` (class in `sovereign/oauth.ts`) | Plugin + Gateway auth flow | Full stateful manager with server-side session storage, one-time use, 10-min TTL |
| `generatePKCE()` (function in `gateway/pkce.ts`) | Lightweight utility | Stateless function returning `{codeVerifier, codeChallenge}` pair |

```typescript
// gateway/pkce.ts — Simple PKCE pair generation
interface PKCEPair {
  codeVerifier: string;   // randomBytes(32).toString('base64url')
  codeChallenge: string;  // SHA256(verifier).toString('base64url')
}
function generatePKCE(): PKCEPair

// sovereign/oauth.ts — Full stateful PKCE manager
class PKCEStateManager {
  private sessions = new Map<string, PKCESession>();

  constructor()                                // Starts auto-cleanup interval
  generateState(projectId?):                   // Generate state + PKCE pair, 10-min TTL
    { state, verifier, challenge }
  validateAndConsumeState(state):              // One-time use, returns verifier + projectId
    { verifier, projectId } | null             // Returns null if consumed/expired
  getStateCount(): number                      // Active session count (for diagnostics)
  shutdown(): void                             // Stop cleanup interval
}
```

Key properties of `PKCEStateManager`:
- **One-time use** — `validateAndConsumeState()` returns null after first consumption
- **10-minute expiry** — States auto-expire via `createdAt + 10min` check
- **Server-side only** — Verifier never exposed in URLs
- **Automatic cleanup** — Constructor starts a periodic interval that removes stale entries
- ** projectId embedding** — `generateState(projectId?)` embeds the project ID into the state for later retrieval during code exchange

---

## Constants & Configuration

### OAuth Constants (`src/constants.ts`)

| Constant | Value | Purpose |
|----------|-------|---------|
| `SOVEREIGN_CLIENT_ID` | Google OAuth2 client ID | Identifies the Sovereign AI application |
| `SOVEREIGN_CLIENT_SECRET` | From `AG_CLIENT_SECRET` env or fallback | Client secret for token exchange |
| `SOVEREIGN_SCOPES` | 5 scopes (see below) | OAuth permission scopes |
| `SOVEREIGN_REDIRECT_URI` | `http://127.0.0.1:51121/oauth-callback` | Local callback URL |
| `SOVEREIGN_ENDPOINT_FALLBACKS` | daily → autopush → prod | Ordered endpoint fallback list |
| `SOVEREIGN_LOAD_ENDPOINTS` | prod-first ordering | Endpoint order for `loadCodeAssist` |
| `SOVEREIGN_VERSION` | `1.15.8` | Version string for User-Agent header |
| `SOVEREIGN_ENDPOINT` | Points to `DAILY` | Primary API endpoint (development/testing) |
| `GEMINI_CLI_ENDPOINT` | Points to `PROD` | Gemini CLI quota pool endpoint |

### API Endpoints

| Constant | URL | Purpose |
|----------|-----|---------|
| `SOVEREIGN_ENDPOINT_DAILY` | `https://daily-cloudcode-pa.sandbox.googleapis.com` | Daily build (primary default) |
| `SOVEREIGN_ENDPOINT_AUTOPUSH` | `https://autopush-cloudcode-pa.sandbox.googleapis.com` | Autopush staging |
| `SOVEREIGN_ENDPOINT_PROD` | `https://cloudcode-pa.googleapis.com` | Production |

**Fallback order:** `SOVEREIGN_ENDPOINT_FALLBACKS = [daily, autopush, prod]`
**Load order:** `SOVEREIGN_LOAD_ENDPOINTS = [prod, ...]` (prod-first for `loadCodeAssist`)

### OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `cloud-platform` | Google Cloud Platform access |
| `userinfo.email` | Read user email |
| `userinfo.profile` | Read user profile |
| `cclog` | Cloud Code logging |
| `experimentsandconfigs` | Feature flags and experiments |

### Header Styles

| Style | Use Case |
|-------|----------|
| `sovereign` | Default Sovereign AI API requests |
| `gemini-cli` | Gemini CLI fallback quota pool |
| `gemini-cli-pro` | Gemini CLI Pro model variant |
| `gemini-cli-flash` | Gemini CLI Flash model variant |

### Config File (`~/.config/opencode/sovereign.json`)

Managed via `src/plugin/config/schema.ts` (Zod schema) and loaded by `src/plugin/config/loader.ts`.

```json
{
  "account_selection_strategy": "hybrid",
  "quota_fallback": false,
  "pid_offset_enabled": false,
  "session_recovery": true,
  "auto_resume": false,
  "resume_text": "continue",
  "keep_thinking": false,
  "quiet_mode": false,
  "debug": false,
  "empty_response_max_attempts": 4,
  "empty_response_retry_delay_ms": 2000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `account_selection_strategy` | `"sticky" \| "round-robin" \| "hybrid"` | `"hybrid"` | Account rotation strategy |
| `quota_fallback` | `boolean` | `false` | Enable Gemini CLI fallback quota pool |
| `pid_offset_enabled` | `boolean` | `false` | Distribute accounts by PID for parallel sessions |
| `session_recovery` | `boolean` | `true` | Auto-recover from tool_result_missing errors |
| `auto_resume` | `boolean` | `false` | Auto-send resume text after recovery |
| `keep_thinking` | `boolean` | `false` | Preserve thinking blocks in requests |
| `quiet_mode` | `boolean` | `false` | Suppress non-essential output |
| `debug` | `boolean` | `false` | Enable debug logging |
| `empty_response_max_attempts` | `number` | `4` | Max retries for empty API responses |
| `empty_response_retry_delay_ms` | `number` | `2000` | Delay between empty response retries |

> **Note:** `config/schema.ts` (489 lines) contains additional configuration fields beyond what is listed here. See the source for the complete Zod schema.

---

## Token Lifecycle

### Token Types

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| **Access Token** | ~1 hour | In-memory (`AuthCache`) | API request authorization |
| **Refresh Token** | Indefinite (until revoked) | Disk (`sovereign-accounts.json`) | Obtain new access tokens |
| **PKCE State** | 10 minutes | In-memory (`PKCEStateManager`) | CSRF + code verifier binding |

### Token Refresh Flow

```
Access Token Expires
        │
        ▼
┌──────────────────┐     ┌───────────────────┐
│ plugin/auth.ts   │     │ plugin/token.ts   │
│ calculateToken   │     │ refreshToken()    │
│ Expiry()         │     │                   │
│                  │     │                   │
│ Check if expired │────▶│ POST to token     │
│ or near-expiry   │     │ endpoint with     │
│                  │     │ refresh_token     │
└──────────────────┘     │                   │
                         │ New access_token  │
                         │ + updated expiry  │
                         └───────────────────┘
                                │
                                ▼
                         ┌───────────────────┐
                         │ plugin/cache.ts   │
                         │                   │
                         │ Update in-memory  │
                         │ auth cache        │
                         └───────────────────┘
```

### Token Refresh Endpoint (Gateway Layer)

The gateway `TokenStore` refreshes tokens via Google's OAuth2 endpoint:

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id={SOVEREIGN_CLIENT_ID}
client_secret={SOVEREIGN_CLIENT_SECRET}
refresh_token={refreshToken}
grant_type=refresh_token
```

Request headers include `GEMINI_CLI_HEADERS` (`User-Agent`, `X-Goog-Api-Client`). A **5-minute buffer** (`TOKEN_REFRESH_BUFFER_MS`) ensures tokens are refreshed before actual expiry.

### Token Validation (`src/plugin/auth.ts`)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `isOAuthAuth(auth)` | `(auth: AuthDetails) => auth is OAuthAuthDetails` | Type guard — narrows to `OAuthAuthDetails` when `auth.type === "oauth"` |
| `accessTokenExpired(auth)` | `(auth: OAuthAuthDetails) => boolean` | Checks if access token is past expiry (with buffer) |
| `calculateTokenExpiry(requestTimeMs, expiresInSeconds)` | `(requestTimeMs: number, expiresInSeconds: unknown) => number` | Converts relative `expires_in` to absolute Unix ms `expiry_date` |
| `formatRefreshParts(parts)` | `(parts: RefreshParts) => string` | Serializes `RefreshParts` into pipe-delimited string (`refreshToken\|projectId\|managedProjectId`) |
| `parseRefreshParts(refresh)` | `(refresh: string) => RefreshParts` | Deserializes pipe-delimited string into `RefreshParts` (`refreshToken`, `projectId?`, `managedProjectId?`) |

### Proactive Refresh Queue (`src/plugin/refresh-queue.ts`)

Background service (`ProactiveRefreshQueue`) that proactively refreshes tokens **before** they expire, so user requests never block on token refresh.

**Configuration** (`ProactiveRefreshConfig`):

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable proactive refresh |
| `bufferSeconds` | `1800` (30 min) | Seconds before expiry to trigger refresh |
| `checkIntervalSeconds` | `300` (5 min) | Interval between background checks |

**Key behaviors:**

| Property | Behavior |
|----------|----------|
| **Serialization** | Only one refresh check at a time (`isRefreshing` flag) |
| **Serial refresh** | Accounts refreshed serially to avoid concurrent refresh storms |
| **Skip disabled** | Disabled accounts are excluded from proactive refresh |
| **Skip expired** | Already-expired tokens skipped (let main flow handle them) |
| **Auto-persist** | Refreshed tokens saved to disk after each successful refresh |
| **Metrics** | Tracks refresh count, error count, last check/refresh timestamps |

### Auth Caching (`src/plugin/cache.ts`)

Simple in-memory `Map<string, OAuthAuthDetails>` keyed by normalized refresh token.

| Aspect | Detail |
|--------|--------|
| **Key** | Normalized refresh token (via `normalizeRefreshKey()`) |
| **Value** | Full `OAuthAuthDetails` including access token, refresh token, expiry, project ID |
| **Size limit** | None — grows unbounded until process exits |
| **Invalidation** | On explicit cache miss or token refresh |

Also contains an in-memory signature cache (`Map<sessionId, Map<textHash, SignatureEntry>>`) for thinking block signatures, with a 1-hour TTL per entry and `MAX_ENTRIES_PER_SESSION` (100) limit.

### Signature Cache (`src/plugin/cache/signature-cache.ts`)

Disk-based persistence for Claude thinking block signatures.

| Aspect | Detail |
|--------|--------|
| **Storage** | File-based, persisted across restarts |
| **Key** | Session key (model + conversation identifier) |
| **Value** | `thoughtSignature` strings for thinking blocks |
| **Purpose** | Avoid re-authenticating thinking blocks across turns |
| **Max entries** | 1000 (hardcoded `MAX_ENTRIES`) |
| **Eviction** | FIFO (insertion-order) — oldest entry evicted when at capacity |
| **Memory TTL** | 1 hour (configurable via `memory_ttl_seconds`) |
| **Disk TTL** | 48 hours (configurable via `disk_ttl_seconds`) |
| **Cleanup interval** | 30 minutes (background timer removes expired entries) |

---

## Multi-Account Management

### Architecture (`src/plugin/accounts.ts`)

```
┌─────────────────────────────────────────────────────────────┐
│                    AccountManager                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Account Pool                                         │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │    │
│  │  │ Account 1│  │ Account 2│  │ Account N│          │    │
│  │  │ email    │  │ email    │  │ email    │          │    │
│  │  │ refresh  │  │ refresh  │  │ refresh  │          │    │
│  │  │ project  │  │ project  │  │ project  │          │    │
│  │  │ enabled  │  │ enabled  │  │ enabled  │          │    │
│  │  │ rateLimit│  │ rateLimit│  │ rateLimit│          │    │
│  │  │ cooldown │  │ cooldown │  │ cooldown │          │    │
│  │  │ fingerpr.│  │ fingerpr.│  │ fingerpr.│          │    │
│  │  └──────────┘  └──────────┘  └──────────┘          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌───────────────────┐  ┌───────────────────────────────┐   │
│  │ Per-Family Cursor  │  │ Selection Strategy            │   │
│  │ claude: index 2   │  │ sticky / round-robin / hybrid │   │
│  │ gemini:  index 0  │  │                               │   │
│  └───────────────────┘  └───────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Persistence (sovereign-accounts.json)                │  │
│  │ loadFromDisk() ←→ saveToDisk()                        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Account Record (`ManagedAccount` interface in `accounts.ts`)

Each account in the in-memory pool contains:

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | Account index in the pool |
| `email` | `string?` | Google account email (optional) |
| `addedAt` | `number` | Timestamp when account was added |
| `lastUsed` | `number` | Timestamp of last successful request |
| `parts` | `RefreshParts` | Parsed refresh token + project ID + managed project ID |
| `access` | `string?` | Current access token (in-memory only) |
| `expires` | `number?` | Access token expiry timestamp (in-memory only) |
| `enabled` | `boolean` | Whether account participates in rotation |
| `rateLimitResetTimes` | `RateLimitStateV3` | Per-quota-key rate limit reset timestamps |
| `lastSwitchReason` | `"rate-limit" \| "initial" \| "rotation"?` | Why the last account switch occurred |
| `coolingDownUntil` | `number?` | Timestamp when cooldown ends |
| `cooldownReason` | `CooldownReason?` | Why the account is cooling down |
| `touchedForQuota` | `Record<string, number>` | Track quota check timestamps per key |
| `consecutiveFailures` | `number?` | Number of consecutive failures |
| `lastFailureTime` | `number?` | Timestamp of last failure (for TTL-based reset) |
| `fingerprint` | `Fingerprint?` | Device fingerprint for this account |
| `fingerprintHistory` | `FingerprintVersion[]?` | Previous fingerprints |
| `cachedQuota` | `Partial<Record<QuotaGroup, QuotaGroupSummary>>?` | Cached quota data |
| `cachedQuotaUpdatedAt` | `number?` | When quota was last cached |

### Account Selection Strategies

#### Sticky

```
Account A ──▶ Request 1 ✓
         ──▶ Request 2 ✓
         ──▶ Request 3 ✗ (429 rate limited)
         ──▶ Advance cursor
Account B ──▶ Request 4 ✓
         ──▶ Request 5 ✓
```

- Stays on the same account until rate-limited
- **Best for:** Preserving Anthropic prompt cache across requests
- **Trade-off:** Concentrates usage on one account

#### Round-Robin

```
Account A ──▶ Request 1 ✓
Account B ──▶ Request 2 ✓
Account C ──▶ Request 3 ✓
Account A ──▶ Request 4 ✓
```

- Rotates to next account on every request
- **Best for:** Maximum throughput, distributing load evenly
- **Trade-off:** Breaks prompt cache on each switch

#### Hybrid (Default)

Implemented in `src/plugin/rotation.ts` via `selectHybridAccount()`. This is the default strategy (`account_selection_strategy: "hybrid"`).

```
┌─────────────────────────────────────────┐
│ Hybrid Selection Algorithm              │
│                                         │
│ 1. Collect all enabled, non-cooledown   │
│    accounts as candidates               │
│                                         │
│ 2. Score each candidate:                │
│    - Health score (from HealthScore     │
│      Tracker, default initial: 70)      │
│    - Token bucket fill level            │
│      (max: 50, regen: 6/min)           │
│    - LRU freshness (time since last use)│
│                                         │
│ 3. Deterministic tie-break by account   │
│    index (no randomness)                │
│                                         │
│ 4. If no candidates → fallback sticky   │
└─────────────────────────────────────────┘
```

**Health Score Configuration** (from `rotation.ts`):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `initial` | 70 | Starting health score |
| `successReward` | +1 | Score increase per successful request |
| `rateLimitPenalty` | -10 | Score decrease on rate limit |
| `failurePenalty` | -20 | Score decrease on failure |
| `recoveryRatePerHour` | +2 | Passive recovery per hour |
| `minUsable` | 50 | Minimum score to be considered healthy |
| `maxScore` | 100 | Maximum health score cap |

**Token Bucket Configuration** (from `rotation.ts`):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxTokens` | 50 | Maximum token bucket capacity |
| `regenerationRatePerMinute` | 6 | Tokens regenerated per minute |
| `initialTokens` | 50 | Starting token count |

- Combines health metrics, token budget, and freshness
- **Best for:** Overall optimal distribution across heterogeneous accounts
- **Trade-off:** More complex, slightly higher overhead

### Rate Limit Tracking

Rate limit state is tracked via `RateLimitStateV3` (defined in `src/plugin/storage.ts`):

```typescript
interface RateLimitStateV3 {
  claude?: number;              // Reset timestamp for Claude quota key
  "gemini-sovereign"?: number; // Reset timestamp for Gemini via Sovereign AI
  "gemini-cli"?: number;        // Reset timestamp for Gemini CLI fallback
  [key: string]: number | undefined;  // Extensible for future keys
}
```

This maps quota keys (`BaseQuotaKey | BaseQuotaKey:modelId`) to Unix timestamps indicating when the rate limit resets.

#### Cooldown Reasons

```typescript
type CooldownReason = "auth-failure" | "network-error" | "project-error";
```

| Reason | Description |
|--------|-------------|
| `auth-failure` | Authentication or token refresh failed |
| `network-error` | Network-level error during request |
| `project-error` | Google Cloud project resolution failed |

#### Backoff Strategy (`calculateBackoffMs` in `accounts.ts`)

Backoff is **not** a simple exponential formula — it varies by `RateLimitReason`:

```typescript
type RateLimitReason =
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMIT_EXCEEDED"
  | "MODEL_CAPACITY_EXHAUSTED"
  | "SERVER_ERROR"
  | "UNKNOWN";
```

| Reason | Backoff | Notes |
|--------|---------|-------|
| `QUOTA_EXHAUSTED` | Escalating: 60s → 5m → 30m → 2h | Array-indexed by `consecutiveFailures` |
| `RATE_LIMIT_EXCEEDED` | Fixed 30s | Constant backoff |
| `MODEL_CAPACITY_EXHAUSTED` | 45s + jitter (±15s) | Random jitter prevents thundering herd |
| `SERVER_ERROR` | Fixed 20s | Constant backoff |
| `UNKNOWN` | Fixed 60s | Fallback for unrecognized errors |

Minimum backoff floor: `MIN_BACKOFF_MS = 2s`. The `Retry-After` header (if present) overrides calculated backoff.

- **TTL-based reset** — Consecutive failure count resets after failure TTL expires
- **Success resets** — Any successful request resets `consecutiveFailures` to 0

---

## Quota System

### Quota Checking (`src/plugin/quota.ts`)

```
┌──────────────────────────────────────────────────────┐
│                  Quota Check Flow                     │
│                                                       │
│  Request ──▶ checkAccountsQuota() ──▶ QuotaSummary   │
│                                            │          │
│                        ┌───────────────────┼────┐    │
│                        ▼                   ▼    ▼    │
│                   Claude Group     Gemini Pro  Gemini  │
│                                       │      Flash    │
│                        ┌──────────────┴──────────┐   │
│                        ▼              ▼          ▼   │
│                 remainingFraction  resetTime  model   │
│                                      Count           │
│                                                       │
│  Decision:                                            │
│  - <90%  → Account is healthy, use freely             │
│  - ≥90%  → Soft warning, continue with downgrade     │
│  - 100%  → Hard stop, switch account or fail         │
└──────────────────────────────────────────────────────┘
```

### Quota Types

```typescript
type QuotaGroup = "claude" | "gemini-pro" | "gemini-flash";

interface QuotaGroupSummary {
  remainingFraction?: number;   // 0..1 remaining quota fraction
  resetTime?: string;           // When quota resets (ISO string)
  modelCount: number;           // Number of models in group
}

interface QuotaSummary {
  groups: Partial<Record<QuotaGroup, QuotaGroupSummary>>;
  modelCount: number;
  error?: string;
}
```

### Quota Groups

| Group | Models | Tracking |
|-------|--------|----------|
| `claude` | Claude Opus, Sonnet, Haiku | TPM + RPD |
| `gemini-pro` | Gemini Pro variants | TPM + RPD |
| `gemini-flash` | Gemini Flash variants | TPM + RPD |

### Main Export

```typescript
async function checkAccountsQuota(
  accounts: AccountMetadataV3[],
  client: PluginClient,
  providerId?: string,        // default = GOOGLE_GEMINI_PROVIDER_ID
): Promise<AccountQuotaResult[]>
```

### Dual Quota Pools (Gemini)

For Gemini models, two independent quota pools exist per account:

| Pool | Endpoint | When Used |
|------|----------|-----------|
| **Sovereign AI** | Sovereign AI API | Default for all requests |
| **Gemini CLI** | Gemini API directly | Automatic fallback when Sovereign AI exhausted on ALL accounts |

Transition flow:

```
1. Request on Account A (Sovereign AI) ──▶ 429
2. Try Account B (Sovereign AI)         ──▶ 429
3. Try Account C (Sovereign AI)         ──▶ 429
4. All Sovereign AI exhausted
5. Fallback: Account A (Gemini CLI)    ──▶ Success
   (Model name transformed automatically)
```

Enabled via `"quota_fallback": true` in config.

---

## Encryption & Key Management

### KeyManager (`src/plugin/key-manager.ts`)

`KeyManager` is **not** an API key manager — it provides **AES-256-GCM encryption** for sensitive data at rest (token storage, account pool). It uses machine-bound key derivation to prevent token files from being portable across machines.

#### Key Derivation

```
Machine ID (node-machine-id)
    + Application Salt (SOVEREIGN_SALT env or 'ag-default-salt-v3')
    ────────────────────────────────────────────────
    ▼ scryptSync(machineId, salt, 32)
    Master Key (32 bytes)

Override: SOVEREIGN_MASTER_KEY env → raw hex key (for CI/headless)
```

#### Encrypted Payload Format (v3)

```typescript
interface EncryptedPayload {
  version: 3;
  keyMeta: {
    keyId: string;        // "kg_{timestamp}_{random}"
    algorithm: "AES-256-GCM";
    createdAt: string;    // ISO datetime
    rotatedAt: string | null;
    machineId: string;
  };
  iv: string;       // Base64-encoded 12-byte IV
  tag: string;      // Base64-encoded 16-byte auth tag
  payload: string;  // Base64-encoded ciphertext
}
```

#### Methods

| Method | Purpose |
|--------|---------|
| `encrypt(data)` | Encrypt object → `EncryptedPayload` (AES-256-GCM) |
| `decrypt(encrypted)` | Decrypt `EncryptedPayload` → object |
| `rotate(encrypted)` | Re-encrypt with fresh key metadata |
| `exportBundle(data, passphrase)` | Create passphrase-encrypted export for migration |
| `importBundle(json, passphrase)` | Restore from passphrase-encrypted export |
| `isV3Encrypted(content)` (static) | Check if content is v3-encrypted |

#### Security Properties

- **AES-256-GCM** — Authenticated encryption (confidentiality + integrity)
- **Machine-bound** — Key derived from `machine-id`, tokens not portable
- **12-byte IV** — Random per encryption operation
- **16-byte auth tag** — Detects tampering
- **Legacy AES-256-CBC removed** — Prevents downgrade attacks

---

## Device Fingerprinting

### Purpose (`src/plugin/fingerprint.ts`)

Generates unique device fingerprints to avoid cross-account correlation detection. Each account can have its own fingerprint with independent version tracking.

### Fingerprint Structure

```typescript
interface ClientMetadata {
  ideType: string;      // Random IDE type (VSCODE, INTELLIJ, etc.)
  platform: string;     // WINDOWS, MACOS, or LINUX
  pluginType: string;   // Always "GEMINI"
  osVersion: string;    // Randomized OS version
  arch: string;         // "x64" or "arm64"
  sqmId?: string;       // Random UUID in braces
}

interface Fingerprint {
  deviceId: string;          // Random UUID
  sessionToken: string;      // Random 32-hex-char token
  userAgent: string;         // "sovereign/{version} {platform}/{arch}"
  apiClient: string;         // Random SDK client string
  clientMetadata: ClientMetadata;  // Structured metadata
  quotaUser: string;         // "device-{random hex}"
  createdAt: number;         // Generation timestamp
}

interface FingerprintVersion {
  fingerprint: Fingerprint;
  timestamp: number;
  reason: 'initial' | 'regenerated' | 'restored';
}
```

### Fingerprint Functions

| Function | Purpose |
|----------|---------|
| `generateFingerprint()` | Generate randomized fingerprint with random platform/arch/OS |
| `collectCurrentFingerprint()` | Generate fingerprint from actual system info |
| `buildFingerprintHeaders(fp)` | Build HTTP headers (`User-Agent`, `X-Goog-Api-Client`, `Client-Metadata`, `X-Goog-QuotaUser`, `X-Client-Device-Id`) |
| `getSessionFingerprint()` | Get or create singleton session fingerprint |
| `regenerateSessionFingerprint()` | Force regenerate (e.g., after rate limiting) |

### Fingerprint History

| Aspect | Detail |
|--------|--------|
| **Max history** | `MAX_FINGERPRINT_HISTORY` = 5 per account |
| **Tracking** | `FingerprintVersion` stores fingerprint + timestamp + reason |
| **Reasons** | `initial`, `regenerated`, `restored` |

---

## Persistence

### Account Pool Storage (`src/plugin/persist-account-pool.ts`)

Location: `~/.config/opencode/sovereign-accounts.json`

```json
{
  "version": 3,
  "accounts": [
    {
      "email": "user1@gmail.com",
      "refreshToken": "1//0abc...",
      "projectId": "gcp-project-123",
      "managedProjectId": "my-project-456",
      "addedAt": 1713120000000,
      "lastUsed": 1713123600000,
      "enabled": true,
      "lastSwitchReason": "initial",
      "rateLimitResetTimes": {
        "claude": 1713124000000,
        "gemini-sovereign": 1713124000000
      },
      "coolingDownUntil": null,
      "cooldownReason": null,
      "fingerprint": {
        "deviceId": "550e8400-e29b-41d4-a716-446655440000",
        "sessionToken": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        "userAgent": "sovereign/1.15.8 darwin/arm64",
        "apiClient": "google-cloud-sdk vscode/1.87.0",
        "clientMetadata": { "ideType": "VSCODE", "platform": "MACOS", ... },
        "quotaUser": "device-a1b2c3d4e5f6a1b2",
        "createdAt": 1713120000000
      },
      "healthScore": 75
    }
  ],
  "activeIndex": 0,
  "activeIndexByFamily": {
    "claude": 0,
    "gemini": 0
  }
}
```

| Operation | Function | Behavior |
|-----------|----------|----------|
| Load | `loadFromDisk()` | Read + migrate to V3 schema if older, validate structure |
| Save | `saveToDisk()` | Atomic write (write to temp, then rename) |
| Migration | `migrateV1toV2()` / `migrateV2toV3()` | Progressive schema migration |
| Backup | Auto | Previous version preserved before overwrite |

> ⚠️ **Security:** This file contains OAuth refresh tokens. Treat it like a password file. Never commit to version control.

---

## Gateway Authentication

The gateway layer provides two distinct authentication concerns:

1. **OAuth token management** — Google OAuth token storage and refresh (via `token-store.ts`, `auth-server.ts`, `browser-launcher.ts`)
2. **Gateway API authorization** — Bearer token authorization for REST/WebSocket access (via `gateway-auth-manager.ts`)

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Gateway Auth Layer                         │
│                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────┐    │
│  │ auth-server.ts       │    │ browser-launcher.ts     │    │
│  │                      │    │                         │    │
│  │ HTTP server on       │    │ launchOAuthBrowser()    │    │
│  │ 127.0.0.1:{port}    │    │ generateOAuthUrl()      │    │
│  │ Captures OAuth       │    │ Opens system browser    │    │
│  │ callback             │    │ or prints URL fallback  │    │
│  └──────────────────────┘    └─────────────────────────┘    │
│                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────┐    │
│  │ token-store.ts       │    │ oauth-port.ts           │    │
│  │                      │    │                         │    │
│  │ AES-256-GCM encrypted│    │ DEFAULT_OAUTH_CALLBACK  │    │
│  │ multi-account token  │    │ _PORT (51121)           │    │
│  │ storage + auto-      │    │ checkOAuthCallbackPort  │    │
│  │ refresh              │    │ Availability()          │    │
│  └──────────────────────┘    └─────────────────────────┘    │
│                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────┐    │
│  │ gateway-auth-manager │    │ pkce.ts                 │    │
│  │                      │    │                         │    │
│  │ Bearer token auth +  │    │ generatePKCE()          │    │
│  │ WS ticket manager    │    │ Stateless PKCE pair gen │    │
│  │ (NOT OAuth-related)  │    │                         │    │
│  └──────────────────────┘    └─────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Auth Server (`src/gateway/auth-server.ts`)

Lightweight HTTP server for the OAuth callback in gateway mode.

| Feature | Detail |
|---------|--------|
| **Bind address** | `127.0.0.1` (localhost only) |
| **Default port** | Derived from `SOVEREIGN_REDIRECT_URI` (51121) |
| **Timeout** | 10 minutes (configurable) |
| **CSRF protection** | `state` parameter validation against `expectedState` |
| **Response** | Styled HTML success page in Turkish |
| **Error codes** | `NONE`, `OAUTH_TIMEOUT`, `OAUTH_PROVIDER_ERROR`, `MISSING_CODE_OR_STATE`, `OAUTH_STATE_MISMATCH`, `TOKEN_EXCHANGE_FAILED`, `TOKEN_EXCHANGE_EXCEPTION`, `PORT_IN_USE` |

Auth result interface:

```typescript
interface AuthResult {
  success: boolean;
  token?: StoredToken;
  error: string | null;
  errorCode: AuthErrorCode;
}
```

### Token Store (`src/gateway/token-store.ts`)

AES-256-GCM encrypted, file-based multi-account token storage for the gateway.

**Storage location:** `~/.config/agent/sovereign-tokens.json` (encrypted via `KeyManager`)

```typescript
interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;      // Unix ms
  email?: string;         // Optional — used as lookup key
  projectId?: string;
  createdAt: number;      // Unix ms
}

interface TokenStoreData {
  version: 1;
  accounts: StoredToken[];
  activeIndex: number;
}
```

#### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `addOrUpdateAccount` | `(token: StoredToken) => void` | Add or update account (matched by `email`) |
| `removeAccount` | `(email: string) => boolean` | Remove account by email |
| `getActiveToken` | `() => StoredToken \| null` | Get token at `activeIndex` |
| `getAllAccounts` | `() => StoredToken[]` | Return all stored accounts |
| `getAccountCount` | `() => number` | Total account count |
| `setActiveAccountByEmail` | `(email: string) => boolean` | O(1) cached account selection |
| `hasValidToken` | `() => boolean` | Check if active token is non-expired |
| `isTokenExpired` | `(token: StoredToken) => boolean` | Check with 5-min buffer |
| `refreshActiveToken` | `() => Promise<StoredToken \| null>` | Refresh via `oauth2.googleapis.com/token` (deduplicated per email) |
| `getValidAccessToken` | `() => Promise<string \| null>` | Get valid access token (auto-refresh if needed) |
| `clear` | `() => void` | Reset to empty store and save |

#### Refresh Deduplication

Concurrent `refreshActiveToken()` calls for the same email share a single in-flight promise via `refreshInProgress` map + `AsyncLock`. This prevents token refresh races under high concurrency.

#### Encryption Flow

```
saveToDisk():
  this.data → JSON.stringify → KeyManager.encrypt() → write encrypted payload to disk

loadFromDisk():
  read file → KeyManager.isV3Encrypted()?
    yes → KeyManager.decrypt() → parse as TokenStoreData
    no  → parse as raw JSON (legacy, warned, re-encrypted on next save)
```

### Gateway Auth Manager (`src/gateway/gateway-auth-manager.ts`)

> **Important:** This component manages **gateway API bearer tokens** and **WebSocket tickets**, NOT Google OAuth tokens. It handles authorization for REST and WebSocket consumers of the gateway server.

```typescript
class GatewayAuthManager {
  constructor(token: string)               // Initial bearer token (required)

  isAuthorized(token): boolean              // Validate bearer or grace token
  rotateToken(next?, graceMs?): RotateTokenResult  // Rotate with grace period
  revokeGraceTokens(): void                 // Immediately revoke all grace tokens
  issueWsTicket(sessionId, options?): WsTicketResult  // Create single-use WS ticket
  consumeWsTicket(sessionId, ticket): ConsumedWsTicket | null  // Validate + consume ticket
  getTokenState(): { activeMasked, graceCount }  // Current state summary
  getMaskedActiveToken(): string            // Masked token for logging
}
```

Key behaviors:
- **Grace period rotation** — Old token stays valid for `graceMs` (default 60s) after rotation
- **WebSocket tickets** — Single-use, time-limited tickets (`agt_ws_{random}`) bound to a session ID
- **Auto-cleanup** — Expired grace tokens and used/expired WS tickets pruned on every operation
- **WS ticket generation** — Uses `WsSocketGeneration` ({epochMs, seq}) for reconnection ordering

### Browser Launcher (`src/gateway/browser-launcher.ts`)

Launches OAuth flow in the system browser or provides URL for manual copy.

```typescript
interface LaunchResult {
  authorization: Sovereign AIAuthorization;
  browserOpened: boolean;
}

async function launchOAuthBrowser(projectId?: string): Promise<LaunchResult>
async function generateOAuthUrl(projectId?: string): Promise<Sovereign AIAuthorization>
```

| Platform | Command |
|----------|---------|
| Windows | `cmd /c start "url"` |
| macOS | `open url` |
| Linux | `xdg-open url` |

If browser fails to open, the URL is printed to terminal as fallback.

### OAuth Port Management (`src/gateway/oauth-port.ts`)

```typescript
const DEFAULT_OAUTH_CALLBACK_PORT: number  // Parsed from SOVEREIGN_REDIRECT_URI (51121)

interface OAuthPortCheckResult {
  available: boolean;
  code?: "EADDRINUSE" | "EACCES" | "UNKNOWN";
  message?: string;
}

async function checkOAuthCallbackPortAvailability(
  port: number,
  host = "127.0.0.1",
): Promise<OAuthPortCheckResult>
```

Binds and immediately closes a test server to check if the port is available.

---

## Plugin OAuth Server (`src/plugin/server.ts`)

The plugin-layer OAuth callback server, used by the CLI/OpenCode integration.

### Key Differences from Gateway Server

| Aspect | Plugin Server | Gateway Server |
|--------|---------------|----------------|
| **Use case** | CLI/OpenCode login | Gateway web/server auth |
| **Environment detection** | OrbStack, WSL, SSH/remote aware | Standard localhost |
| **Bind address** | Auto-detected (0.0.0.0 in Docker) | Always 127.0.0.1 |
| **Timeout** | 5 minutes | 10 minutes |
| **Response** | HTML success page | HTML success page (Turkish) |
| **Interface** | `OAuthListener` with `waitForCallback()` | `AuthServer` with `start()` |

### Environment Detection

```typescript
// OrbStack Docker: bind to 127.0.0.1 for macOS host forwarding
isOrbStackDockerHost() → bind 127.0.0.1

// WSL: detect Windows Subsystem for Linux
isWSL() → adjust bind address

// SSH/Remote: detect remote session
isRemoteEnvironment() → adjust bind address
```

---

## Project Discovery

### Google Cloud Project Resolution (`src/plugin/project.ts`)

After authentication, the system must resolve the Google Cloud managed project ID.

```
Authenticated Account
        │
        ▼
┌────────────────────────┐
│ ensureProjectContext() │
│                        │
│ 1. Check cached project│
│    (per refresh token) │
│                        │
│ 2. If not cached:      │
│    loadCodeAssist()    │────▶ Sovereign AI API
│                        │       (loadCodeAssist endpoint)
│ 3. If no project:      │
│    onboardManagedProject() │─▶ Auto-provision project
│                        │
│ 4. Cache result        │
│    (dedup via pending  │
│     promise cache)     │
│                        │
│ 5. Return Project      │
│    Context             │
└────────────────────────┘
```

| Function | Signature | Purpose |
|----------|-----------|---------|
| `ensureProjectContext` | `(auth: OAuthAuthDetails) => Promise<ProjectContextResult>` | Main entry — resolves project, may update auth |
| `loadManagedProject` | `(accessToken: string, projectId?: string) => Promise<LoadCodeAssistPayload \| null>` | Call `loadCodeAssist` endpoint |
| `onboardManagedProject` | `(accessToken: string, tierId: string, projectId?: string, attempts?: number, delayMs?: number) => Promise<string \| undefined>` | Auto-provision a new GCP project (with retries) |
| `invalidateProjectContextCache` | `(refresh?: string) => void` | Clear cached project for a refresh token |

**Deduplication:** Multiple concurrent calls for the same refresh token share a single pending promise, preventing duplicate project discovery requests.

---

## Error Handling

### Token Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| `invalid_grant` | Refresh token revoked | Remove account, prompt re-login |
| `token_expired` | Access token past expiry | Auto-refresh via `refreshQueue` |
| `invalid_token` | Malformed or corrupted token | Force full re-authentication |

### Rate Limit Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| HTTP 429 | API rate limit exceeded | Switch account + exponential backoff |
| `RESOURCE_EXHAUSTED` | Quota exhausted | Switch account or fallback quota pool |
| `RetryInfo` in error | Server-provided retry delay | Wait specified duration before retry |

### OAuth Flow Errors

| Error Code | Cause | Recovery |
|------------|-------|----------|
| `NONE` | No error (success) | — |
| `OAUTH_TIMEOUT` | User didn't complete auth in time | Prompt retry |
| `OAUTH_PROVIDER_ERROR` | Google returned an error | Display error, suggest retry |
| `MISSING_CODE_OR_STATE` | Malformed callback URL | Log and retry |
| `OAUTH_STATE_MISMATCH` | CSRF state mismatch | Abort (possible attack) |
| `TOKEN_EXCHANGE_FAILED` | Code exchange returned error | Retry or re-auth |
| `TOKEN_EXCHANGE_EXCEPTION` | Network/timeout during exchange | Retry with backoff |
| `PORT_IN_USE` | Callback port already bound | Try alternate port |

---

## Security Model

### CSRF Protection

- **PKCE `state` parameter** — Random 32-byte hex string, validated on callback
- **One-time use** — State consumed and deleted after validation
- **10-minute TTL** — States expire automatically

### Token Security

- **Refresh tokens** stored on disk, encrypted with AES-256-GCM via `KeyManager`
- **Access tokens** kept in-memory only, never persisted to disk
- **PKCE verifier** stored server-side, never exposed in URLs
- **Client secret** preferred from environment variable (`AG_CLIENT_SECRET`)
- **Machine-bound encryption** — Token files not portable across machines (key derived from `machine-id`)

### Network Security

- **Callback server** binds to `127.0.0.1` (localhost only)
- **HTTPS** used for all Google/Sovereign AI API calls
- **No token logging** — Tokens never appear in debug logs

### Account Isolation

- Per-account fingerprinting prevents cross-account correlation
- Per-account rate limit tracking prevents cascading failures
- Per-account cooldown management isolates problematic accounts

---

## Test Coverage

OAuth-related test files in the codebase:

| Test File | Tests |
|-----------|-------|
| `src/sovereign/oauth.test.ts` | OAuth token exchange, PKCE state management |
| `src/plugin/auth.test.ts` | Token validation helpers |
| `src/plugin/token.test.ts` | Access token refresh logic |
| `src/plugin/accounts.test.ts` | Multi-account management, load balancing |
| `src/plugin/cache.test.ts` | Auth caching |
| `src/plugin/key-manager.test.ts` | Encryption/decryption, key rotation |
| `src/plugin/refresh-queue.test.ts` | Token refresh queue serialization |
| `src/plugin/persist-account-pool.test.ts` | Account pool persistence |
| `src/gateway/auth-server.test.ts` | Gateway OAuth callback server |
| `src/gateway/token-store.test.ts` | Token storage and refresh |
| `src/gateway/gateway-auth-manager.test.ts` | Gateway bearer token auth |
| `src/gateway/oauth-port.test.ts` | Port availability checking |

---

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Overall system architecture
- [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md) — Multi-account setup guide (user-facing)
- [CONFIGURATION.md](./CONFIGURATION.md) — Full configuration reference
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Common issues and solutions