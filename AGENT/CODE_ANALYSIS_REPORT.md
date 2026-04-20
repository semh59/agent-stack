# Google Sovereign AI OAuth Plugin - Kapsamlı Kod Analiz Raporu

**Tarih:** 2026-03-09
**Proje:** LoJiNext AI - Google Sovereign AI OAuth IDE Eklentisi
**Toplam Dosya:** 130+ TypeScript dosyası
**Test Dosya:** 54 test dosyası
**Satır:** ~50,000+ satır kod

---

## İçindekiler
1. [Proje Genel Bakış](#proje-genel-bakış)
2. [Mimari Yapı](#mimari-yapı)
3. [Ana Modüller](#ana-modüller)
4. [OAuth Akışı](#oauth-akışı)
5. [Plugin Sistem](#plugin-sistem)
6. [Orchestration Motoru](#orchestration-motoru)
7. [Gateway ve API](#gateway-ve-api)
8. [Hesap ve Token Yönetimi](#hesap-ve-token-yönetimi)
9. [Caching ve State Management](#caching-ve-state-management)
10. [Test Stratejisi](#test-stratejisi)
11. [Güvenlik Özellikleri](#güvenlik-özellikleri)
12. [Performance Optimizasyonları](#performance-optimizasyonları)

---

## Proje Genel Bakış

### Amaç
Google'ın **Sovereign AI API**'sine OAuth 2.0 ile yetkilendirilmiş erişim sağlayan Opencode IDE eklentisi. Gemini 3 Pro, Gemini Flash, Claude Opus 4.5 ve diğer advanced AI modellerine erişim sağlar.

### Temel Özellikler
- ✅ Multi-account OAuth desteği (max 10 hesap)
- ✅ Dual quota sistemi (Sovereign AI + Gemini CLI)
- ✅ Session recovery ve error handling
- ✅ Otomatik token refresh (proactive)
- ✅ Rate limit yönetimi + account rotation
- ✅ Extended thinking desteği (Claude + Gemini 3)
- ✅ Autonomous loop engine (agentic orchestration)
- ✅ CSRF koruması + session binding
- ✅ WebSocket desteği

### Teknoloji Stack
```
Runtime: Node.js ES Modules
HTTP Framework: Fastify 5.8.2
Auth: @openauthjs/openauth 0.4.3
Validation: Zod 4.0.0
Testing: Vitest 3.0.0
TypeScript: 5.9.3
Database: (Optional - in-memory caching)
Encryption: Node.js crypto (AES-256-GCM)
```

---

## Mimari Yapı

### Katmanlı Mimariye Genel Bakış

```
┌─────────────────────────────────────────────────────────────┐
│                   OPENCODE IDE (Plugin Host)                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ PLUGIN LAYER (src/plugin/)                            │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ • plugin.ts: Main orchestrator (2700 satır)          │  │
│  │ • auth.ts: Token validation & refresh                │  │
│  │ • request.ts: HTTP request transformation            │  │
│  │ • request-helpers.ts: Schema cleaning, thinking      │  │
│  │ • token.ts: Token lifecycle management               │  │
│  │ • cache.ts: Signature caching (L1/L2)                │  │
│  │ • storage.ts: Account persistence + encryption       │  │
│  │ • accounts.ts: AccountManager (multi-account mgmt)    │  │
│  │ • quota.ts: Quota checking & tracking                │  │
│  │ • rotation.ts: Health score + token bucket            │  │
│  │ • refresh-queue.ts: Proactive token refresh          │  │
│  │ • config/: Zod schema validation + env override      │  │
│  └───────────────────────────────────────────────────────┘  │
│                          ↓                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ANTI-GRAVITY API CLIENT (src/orchestration/)          │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ • sovereign-client.ts: HTTP client wrapper         │  │
│  │ • pipeline-tools.ts: Tool execution engine           │  │
│  └───────────────────────────────────────────────────────┘  │
│                          ↓                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ORCHESTRATION LAYER (Agentic)                        │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ Sequential Pipeline:                                  │  │
│  │  • agents.ts: 18 agent definitions (sıralı)         │  │
│  │  • sequential-pipeline.ts: Pipeline executor         │  │
│  │  • shared-memory.ts: Agent communication state       │  │
│  │                                                       │  │
│  │ Autonomous Loop:                                      │  │
│  │  • autonomous-loop-engine.ts: Otonom task executor  │  │
│  │  • autonomy-model-router.ts: Smart model selection  │  │
│  │  • autonomy-gate-runner.ts: Strict verification     │  │
│  │  • autonomy-types.ts: Type definitions              │  │
│  │  • autonomy-git-manager.ts: Git branch/commit ops   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          ↓                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ GATEWAY LAYER (src/gateway/)                          │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ • auth-server.ts: OAuth callback HTTP handler        │  │
│  │ • token-store.ts: Token persistence + refresh        │  │
│  │ • gateway-auth-manager.ts: Token rotation            │  │
│  │ • oauth-port.ts: Port availability checker           │  │
│  │ • autonomy-session-manager.ts: Session lifecycle    │  │
│  └───────────────────────────────────────────────────────┘  │
│                          ↓                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ OAUTH & AUTHENTICATION (src/sovereign/)             │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ • oauth.ts: PKCE state management + token exchange  │  │
│  │ • oauth.test.ts: OAuth flow tests                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                          ↓                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ INFRASTRUCTURE                                        │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ Utilities:                                            │  │
│  │  • hooks/auto-update-checker: Version management    │  │
│  │  • skills/: AST indexing, sandbox, self-healing    │  │
│  │  • validators/: Auth validation                     │  │
│  │  • middleware/csrf.ts: CSRF protection              │  │
│  │                                                       │  │
│  │ Constants:                                            │  │
│  │  • constants.ts: Endpoints, headers, configs        │  │
│  │  • Client ID/Secret, API endpoints, versions        │  │
│  └───────────────────────────────────────────────────────┘  │
│                          ↓                                    │
│              GOOGLE APIS (generativelanguage.googleapis.com) │
│              & Sovereign AI API (cloudcode-pa.googleapis.com) │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Katman Sorumluluğu

| Katman | Rol | Dosyalar |
|--------|-----|----------|
| **Plugin** | Request/response transformation, auth, caching | src/plugin/** |
| **Orchestration** | Multi-agent coordination, autonomous loops | src/orchestration/** |
| **Gateway** | OAuth callback handling, token management | src/gateway/** |
| **OAuth** | PKCE state, token exchange | src/sovereign/** |
| **Infrastructure** | Utilities, config, security | hooks/, skills/, validators/, middleware/ |

---

## Ana Modüller

### 1. src/plugin.ts (2700 satır) - Ana Plugin Giriş Noktası

**Sorumluluk:** Fetch interceptor ve request orchestrator

**Ana Fonksiyonlar:**
```typescript
// Plugin Registration
export function Sovereign AICLIOAuthPlugin(options): Plugin
export function GoogleOAuthPlugin(options): Plugin

// These functions return plugin object implementing:
{
  name: "sovereign-oauth",
  version: SOVEREIGN_VERSION,

  // OAuth flow
  getAuth(): Promise<GetAuth>

  // Request interception
  prepareRequest(request): Promise<Request>
  processResponse(response): Promise<Response>

  // UI integration
  showToast(message, options)
  showErrorDialog(error)
}
```

**İş Akışı:**

```
Request Alınır
  ↓
isGenerativeLanguageRequest() kontrol et
  ├─ Hayır → Pass through (not our API)
  └─ Evet
      ↓
    [getAuth] OAuth akışı yap
      ├─ Login gerekirse → promptLoginMode()
      ├─ Multi-account ise → promptAddAnotherAccount()
      └─ Token döndür
      ↓
    [prepareSovereign AIRequest] Request dönüştür
      ├─ Thinking blocks strip et (cached signatures varsa ekle)
      ├─ Tool IDs assign et
      ├─ Schema clean et
      └─ Headers set et
      ↓
    [makeRequest] Sovereign AI API çağrı
      ├─ Rate limit kontrol et
      ├─ Account select et (strategy: sticky/round-robin/hybrid)
      ├─ Token refresh et (gerekirse)
      ├─ Retry logic (account rotation, backoff)
      └─ Response al
      ↓
    [transformSovereign AIResponse] Response dönüştür
      ├─ Thinking signatures cache et
      ├─ Tool pairing fix et
      ├─ JSON parsing et
      └─ Client model transformations yap
      ↓
    Response döndür
```

**Önemli Konfigürasyonlar:**

```typescript
const MAX_OAUTH_ACCOUNTS = 10;
const MAX_WARMUP_SESSIONS = 1000;
const MAX_WARMUP_RETRIES = 2;
const CAPACITY_BACKOFF_TIERS_MS = [5000, 10000, 20000, 30000, 60000];
const RATE_LIMIT_TOAST_COOLDOWN_MS = 5000;
```

**Error Handling Strategy:**

```typescript
// Layer 1: Network Errors
ERR_NAME_NOT_RESOLVED → Retry with backoff
ECONNREFUSED → Fallback endpoint

// Layer 2: OAuth Errors
invalid_grant → Refresh token invalid, re-auth req
unauthorized → Token expired, auto-refresh

// Layer 3: API Errors
quota_exceeded → Rate limit, switch account
resource_exhausted → Capacity limit, backoff

// Layer 4: Plugin Errors
EmptyResponseError → Warmup retry
ThinkingBlockOrderError → Recovery injection
```

**Token Management:**

```typescript
accessTokenExpired(auth)
  → Check: expires <= now + 60s buffer

refreshAccessToken(auth)
  → POST /oauth2.googleapis.com/token
  → Update storage + cache
  → Clear project context cache

proactiveRefreshQueue
  → Background: check every 5 min
  → Refresh if expiry <= now + 30 min buffer
  → Serialize: prevent concurrent refreshes
```

---

### 2. src/plugin/accounts.ts - Multi-Account Manager

**Sınıf:** AccountManager (1187 satır)

**Ana Sorumluluk:** Hesap seçimi, rate limit tracking, health score yönetimi

**Account Selection Stratejileri:**

```typescript
// STICKY: Aynı hesabı kullan sonra bitmesini bekle
getCurrentOrNextForFamily(family, model, "sticky")
  ├─ Get current index for family (claude/gemini)
  ├─ Check rate limit reset time
  ├─ If available: döndür
  └─ Else: Sonrakini seç

// ROUND-ROBIN: Her istek başında rotate et
getCurrentOrNextForFamily(family, model, "round-robin")
  ├─ cursor++ (mod account count)
  └─ Return account[cursor]

// HYBRID: Health + Token bucket + LRU
getCurrentOrNextForFamily(family, model, "hybrid")
  ├─ Filter: enabled, !rate-limited, health >= minUsable
  ├─ Score = health*2 + (tokens/max)*500 + freshness*360
  ├─ Sort by score desc
  └─ Return best with stickiness bonus
```

**Rate Limit Tracking:**

```typescript
markRateLimited(account, retryAfterMs, family, headerStyle, model)
  ├─ Parse reason: quota | rate-limit | capacity | server-error
  ├─ Set resetTime = now + backoff[reason]
  ├─ Apply health penalty (-10 ila -20)
  ├─ Track consecutive failures
  └─ Save to disk (debounced 1s)

calculateBackoffMs(reason, consecutiveFailures, retryAfterMs)
  ├─ QUOTA_EXHAUSTED: [60s, 5m, 30m, 2h] exponential
  ├─ RATE_LIMIT_EXCEEDED: 30s default
  ├─ CAPACITY_EXHAUSTED: 45s + jitter (±15s)
  ├─ SERVER_ERROR: 20s
  └─ UNKNOWN: 60s
```

**Health Score System:**

```typescript
interface HealthScoreState {
  score: 0-100    (initial: 70)
  lastUpdated
  consecutiveFailures
}

recordSuccess() → score + 1 (cap 100), reset failures
recordRateLimit() → score - 10
recordFailure() → score - 20, failures++

passiveRecovery() → +2 points per hour idle
```

**Quota Caching:**

```typescript
cachedQuota: {
  [groupName]: {
    remainingFraction: 0-1
    resetTime: ISO8601
    modelCount: number
  }
}
cachedQuotaUpdatedAt: timestamp

// Auto-trigger refresh background task
// when cachedQuotaUpdatedAt > config.quotaRefreshIntervalMinutes
```

**State Persistence:**

```json
{
  "version": 3,
  "accounts": [
    {
      "email": "user@example.com",
      "refreshToken": "...",
      "healthScore": 75,
      "rateLimitResetTimes": {"claude": 1678...},
      "coolingDownUntil": 1678...,
      "cachedQuota": {...},
      "fingerprint": {...}
    }
  ],
  "activeIndex": 0,
  "activeIndexByFamily": {"claude": 0, "gemini": 1}
}
```

---

### 3. src/plugin/request.ts - Request Transformation

**Ana Sorumluluk:** HTTP request/response processing, thinking block management

**Pipeline:**

```typescript
// 📥 REQUEST SIDE
prepareSovereign AIRequest(req) {
  1. extractThinkingConfig() → Extract thinking budget/variant
  2. buildSignatureSessionKey() → Create session:model:project:conversation
  3. deepFilterThinkingBlocks() → Strip unsigned thinking
  4. Inject cached signatures (if multi-turn)
  5. assignToolIds() → 3-pass tool ID assignment
  6. cleanJSONSchemaForSovereign AI() → Schema normalization
  7. injectParameterSignatures() → Tool hallucination prevention
  8. transformModelSpecific() → Claude/Gemini conversions
  9. Set headers (User-Agent, X-Goog-Api-Client, etc.)
  10. Return prepared request
}

// 📤 RESPONSE SIDE
transformSovereign AIResponse(resp) {
  1. Parse response body (SSE stream handling)
  2. detectThinkingBlockErrors() → Detect block order issues
  3. cacheThinkingSignatures() → Cache for multi-turn
  4. deepFilterThinkingBlocks() → Remove unsigned blocks
  5. validateAndFixClaudeToolPairing() → Fix missing tool_result
  6. recursivelyParseJsonStrings() → Deep JSON parsing
  7. transformResponseSpecific() → Model-specific conversion
  8. Return transformed response
}
```

**Thinking Block Management:**

```typescript
// Signed vs Unsigned Thinking
Unsigned: ${text}
Signed: {signature: "...", text: "..."}

// Cache decisions
├─ First message: Generate fresh signature (no cache)
├─ Multi-turn: Use cached signature (if valid)
├─ Cache miss: Inject SKIP_THOUGHT_SIGNATURE sentinel
└─ Signature validation: Verify >= 50 chars & not foreign

// Warmup handling
buildThinkingWarmupBody()
  └─ Create conversation: warmup query + response
  └─ Use for O(1) token counting before real request
```

**Tool ID Pairing (3-Pass):**

```typescript
Pass 1: Direct ID matching
  └─ function_id="call_123" ↔ id="call_123"

Pass 2: Name-based matching (fallback)
  └─ function_name="my_func" ↔ name="my_func"
  └─ FIFO order (first tool_use matches first tool_response)

Pass 3: Orphan recovery
  └─ Missing IDs get placeholder
  └─ Mismatch detection fixes
  └─ Nuclear option: remove unresolvable tool_use
```

---

### 4. src/plugin/token.ts - Token Lifecycle

**Fonksiyon:** refreshAccessToken()

```typescript
refreshAccessToken(auth, client, providerId, projectId)

  1. Parse refresh token
     └─ refreshToken | projectId | managedProjectId

  2. HTTP POST /oauth2.googleapis.com/token
     ├─ client_id: SOVEREIGN_CLIENT_ID
     ├─ client_secret: SOVEREIGN_CLIENT_SECRET
     ├─ refresh_token: parsed token
     ├─ grant_type: "refresh_token"
     └─ scope: original scopes

  3. Handle error
     ├─ invalid_grant → Token revoked, require re-auth
     ├─ 4xx/5xx → Parse error, throw Sovereign AITokenRefreshError
     └─ Network → Return undefined

  4. Update auth
     ├─ New access token
     ├─ Calculate expiry: startTime + expiresIn*1000
     ├─ Preserve refresh token
     └─ Update auth cache + storage

  5. Clear caches
     ├─ Project context cache
     ├─ Signature cache (session-specific)
     └─ Return updated auth
```

**Error Handling:**

```typescript
class Sovereign AITokenRefreshError extends Error {
  code: string           // OAuth error code
  statusCode: number     // HTTP status
  message: string        // User-friendly message
  originalError: Error   // Original for debugging
}
```

---

## OAuth Akışı

### PKCE Flow (Server-Side Verifier)

**Aşama 1: Yetkilendirme URL Oluştur**

```typescript
authorizeSovereign AI(projectId?)

  1. PKCEStateManager.generateState()
     ├─ verifier: random 64 chars (32 bytes hex)
     ├─ state: random 32 chars
     ├─ challenge: SHA-256(verifier) → base64url
     └─ Store {state, verifier, challenge, projectId, createdAt, expiresAt}

  2. Build Google OAuth URL
     ├─ https://accounts.google.com/o/oauth2/v2/auth
     ├─ client_id: SOVEREIGN_CLIENT_ID
     ├─ response_type: "code"
     ├─ redirect_uri: "http://127.0.0.1:51121/oauth-callback"
     ├─ scope: [cloud-platform, email, profile, cclog, experiments]
     ├─ access_type: "offline" (get refresh token)
     ├─ prompt: "consent" (always ask)
     ├─ code_challenge: challenge (S256 hash)
     ├─ code_challenge_method: "S256"
     ├─ state: state (CSRF token)
     └─ Return {url, verifier: "", state, projectId}

  🔐 SECURITY: verifier is NOT in URL, stays on server
```

**Aşama 2: Google Redirect**

```
User:
  Click "Login with Google" → Browser opens auth URL
  ↓
Google:
  User authenticates
  ↓ (success)
  Redirect to: /oauth-callback?code=AUTH_CODE&state=CSRF_STATE
```

**Aşama 3: Token Exchange**

```typescript
exchangeSovereign AI(code, state)

  1. Validate state
     ├─ PKCEStateManager.validateAndConsumeState(state)
     ├─ Check: exists, not expired, not consumed
     ├─ Return {verifier, projectId} or null
     └─ Mark state as consumed (one-time use)

  2. HTTP POST /oauth2.googleapis.com/token
     ├─ client_id: SOVEREIGN_CLIENT_ID
     ├─ client_secret: SOVEREIGN_CLIENT_SECRET
     ├─ code: authorization code
     ├─ grant_type: "authorization_code"
     ├─ redirect_uri: "http://127.0.0.1:51121/oauth-callback"
     ├─ code_verifier: verifier (from server!)
     └─ Google verifies: SHA-256(verifier) == challenge

  3. Handle response
     ├─ 200 OK, valid tokens
     ├─ Missing refresh token → error
     ├─ HTTP error → error
     └─ Network error → error

  4. Fetch user info
     ├─ GET /oauth2/v1/userinfo?alt=json
     ├─ Authorization: Bearer access_token
     └─ Extract email

  5. Fetch project ID (if not provided)
     ├─ POST /v1internal:loadCodeAssist
     ├─ Extract cloudaicompanionProject
     └─ Fallback: ""

  6. Return success
     ├─ type: "success"
     ├─ refresh: "$refreshToken|$projectId|$managedProjectId"
     ├─ access: access token
     ├─ expires: expiry timestamp
     ├─ email: user email
     └─ projectId: Sovereign AI project ID
```

**Aşama 4: Storage**

```typescript
{
  type: "oauth",
  refresh: "$refreshToken|$projectId|$managedProjectId",
  access: "ya29...",
  expires: 1678901234567,     // Unix ms, 1 hour from now
  email: "user@example.com",
  projectId: "rising-fact-p41fc"
}
```

### Security Properties

```
✅ PKCE Protection
   └─ Verifier NOT in URL, only challenge
   └─ Authorization code can't be used without verifier
   └─ Prevents code interception attacks

✅ CSRF Protection (State)
   └─ Random state token
   └─ Must match in callback
   └─ Prevents cross-site request forgery

✅ One-Time State Use
   └─ State consumed after first use
   └─ Prevents replay attacks

✅ State Expiration
   └─ 10 minute TTL
   └─ Cleanup timer (1 min)
   └─ Prevents stale state reuse

✅ Secure Code Exchange
   └─ Client secret protected
   └─ OAuth 2.0 standard
   └─ HTTPS enforced
```

---

## Plugin Sistem

### Request Processing Pipeline

```
OPENCODE IDE
    ↓
fetch() interceptor
    ↓
isGenerativeLanguageRequest()? → No → Pass through
    ↓ Yes
getAuth() {
  ├─ Check: Token cached?
  │  ├─ No: promptLoginMode()
  │  │  ├─ Start HTTP server (port 51121)
  │  │  ├─ Generate OAuth URL
  │  │  ├─ Launch browser
  │  │  ├─ Wait for callback
  │  │  └─ Store token
  │  └─ Yes: Use cached
  │
  ├─ Check: Multi-account?
  │  ├─ No: Use single account
  │  └─ Yes: promptAddAnotherAccount()
  │
  └─ Return GetAuth {token}
}
    ↓
[Request Transform]
prepareSovereign AIRequest()
    ├─ Extract thinking config
    ├─ Strip thinking blocks
    ├─ Cache signatures
    ├─ Assign tool IDs
    ├─ Clean schemas
    ├─ Inject headers
    └─ Return request
    ↓
[Select Account]
AccountManager.getCurrentOrNextForFamily()
    ├─ Apply selection strategy
    ├─ Check rate limits
    ├─ Verify not cooling down
    └─ Return account + token
    ↓
[Token Management]
Check: accessTokenExpired()?
    ├─ Yes: refreshAccessToken()
    └─ No: Use cached
    ↓
[Rate Limit Precheck]
checkSoftQuota()
    ├─ If < threshold: Warn user
    └─ If = 0: Return error
    ↓
[Make Request]
    ├─ Set auth header (Bearer token)
    ├─ Add account-specific headers
    ├─ Make HTTP request
    └─ Catch network/API errors
    ↓
[Response Transform]
transformSovereign AIResponse()
    ├─ Parse streaming response
    ├─ Cache thinking signatures
    ├─ Fix tool pairing
    ├─ Transform model-specific
    └─ Return response
    ↓
[Retry Logic] on error
    ├─ Parse error reason
    ├─ Calculate backoff
    ├─ Mark account rate-limited
    ├─ Select next account
    ├─ Up to 10 retries
    └─ Return response or error
    ↓
Return to OPENCODE IDE
```

### Configuration System (Zod-based)

**Priority Chain:**

```
Environment (override)
    ↓ (if not set)
User Config (~/.config/opencode/sovereign.json)
    ↓ (if not set)
Project Config (.opencode/sovereign.json)
    ↓ (if not set)
Schema Defaults
```

**Key Settings:**

```typescript
{
  // Thinking Config
  "keep_thinking": true,
  "thinking_warmup": true,

  // Recovery
  "session_recovery": true,
  "auto_resume": true,

  // Rate Limiting
  "max_rate_limit_wait_seconds": 600,
  "soft_quota_threshold_percent": 20,
  "soft_quota_check_interval_seconds": 60,

  // Account Selection
  "account_selection_strategy": "sticky",  // sticky | round-robin | hybrid

  // Health Scoring
  "health_score_initial": 70,
  "health_score_recovery_percent_per_hour": 2,
  "health_score_min_usable": 50,

  // Token Bucket (for hybrid)
  "token_bucket_max_tokens": 50,
  "token_bucket_regeneration_rate_per_minute": 6,

  // Proactive Refresh
  "proactive_token_refresh_enabled": true,
  "proactive_token_refresh_buffer_seconds": 1800,
  "proactive_token_refresh_check_interval_seconds": 300
}
```

---

## Orchestration Motoru

### Sequential Pipeline (18 Ajanlar)

**Mimari:** Sıralı execution, parallelleştirilebilir katmanlar

**18 Ajanlar (4 Tabakalı):**

```
1. MANAGEMENT LAYER (CEO → PM → Architect)
   ├─ CEO: Analyze + Plan (estimatedMinutes: 15)
   ├─ PM: Requirements + Timeline (30)
   └─ Architect: Technical spec + Architecture (60)

2. DESIGN LAYER (UI/UX → Database → API)
   ├─ UI/UX Designer: Wireframes + Components (45)
   ├─ Database Architect: Schema design (40)
   └─ API Designer: Endpoints + Models (50)

3. DEVELOPMENT LAYER (Backend → Frontend → Auth → Integration)
   ├─ Backend Dev: API implementation (120)
   ├─ Frontend Dev: UI implementation (90)
   ├─ Auth Dev: Security + session (45)
   └─ Integration Dev: Services + APIs (60)

4. QUALITY LAYER (Unit → Integration → Security → Performance → Code Review)
   ├─ QA Engineer: Unit tests (60)
   ├─ Integration Tester: Integration tests (45)
   ├─ Security Engineer: Vulnerability scan (40)
   ├─ Performance Tester: Benchmarks (30)
   └─ Code Reviewer: Review + refactor (50)

5. OUTPUT LAYER (Documentation → Tech Writer → DevOps)
   ├─ Tech Writer: README + docs (30)
   ├─ Tech Writer 2: API docs (25)
   └─ DevOps: Deployment + monitoring (40)

TOTAL ESTIMATED: 820 minutes (~13.7 hours)
```

**Parallelleştirme Kuralları:**

```typescript
// Same layer can run parallel
Design layer (4-6) can run together
Quality layer (11-15) can run together
Output layer (16-18) can run together

// Adjacent layers serialize
MANAGEMENT → DESIGN → DEVELOPMENT → QUALITY → OUTPUT
```

**Execution Model (RARV Loop):**

```
For each agent:
  1. REASON (R)
     ├─ Read previous agent outputs
     ├─ Gather context files
     ├─ Build comprehensive prompt
     └─ Include workflow + examples

  2. ACT (A)
     ├─ Call LLM (model per agent)
     ├─ Generate agent output
     ├─ Stream results to file
     └─ Store in SharedMemory

  3. VERIFY (V)
     ├─ Run verification commands
     ├─ Check build/test success
     ├─ Validate output format
     └─ Record verification status

  4. REFLECT
     ├─ Check halt conditions
     ├─ Evaluate quality gates
     ├─ Decide: next agent or backtrack?
     └─ If error: findBacktrackTarget()
        └─ Re-execute previous agent
```

**Backtracking Example:**

```
Agent 10 (Frontend Dev) → ERROR
    ↓
Halt condition: "Component compilation failed"
    ↓
findBacktrackTarget(Backend Dev)
    ↓
Re-execute Agent 7 (Backend Dev)
    ├─ Adjust: "Fix API type definition"
    └─ Re-generate
    ↓
Resume from Agent 8 (Auth Dev)
```

### Autonomous Loop Engine

**Mimari:** Event-driven, state machine, task graph

**6 Task Tipleri:**

```
analysis         → Understand problem, plan solution
implementation   → Write code changes
refactor        → Improve existing code
test-fix        → Fix failing tests
verification    → Run strict gates (manual review)
finalize        → Cleanup, commit, summary
```

**State Machine:**

```
queued → init → plan → execute → verify → reflect → done
                   ↓                            ↓
                paused ← ← ← ← ← ← ← ← ← ← retry
                ↓
              stop → stopped
              ↓
            failed
```

**Loop Execution (Deterministic):**

```typescript
for (cycle = 1 to maxCycles) {
  // 1. Budget Control
  if (wallClockTimeout || budgetExceeded) {
    FAIL_SESSION
    break
  }

  // 2. Control Requests
  if (stopRequested) {
    transition(stopped)
    break
  }
  if (pauseRequested) {
    transition(paused)
    await resume()
  }

  // 3. Pick Next Task
  task = pickNextTask(session)

  // 4. Plan Phase
  transition(plan)
  selectedModel = SmartMultiModelRouter.decide()

  // 5. Execute Phase
  transition(execute)
  execute(task, selectedModel)

  // 6. Verify Phase
  transition(verify)
  gateResult = StrictGateRunner.run(touchedFiles)

  // 7. Reflect Phase
  transition(reflect)
  if (gateResult.failed) {
    transition(retry)
    if (consecutiveGateFailures >= 3) {
      FAIL_SESSION
      break
    }
  } else {
    // Activate next phase task
    activateNextPhaseTask(task)
  }
}
```

**Smart Model Router:**

```typescript
SmartMultiModelRouter.decide({
  taskType,              // analysis | implementation | etc.
  anchorModel,          // Primary model (e.g. "claude-opus-4.5")
  previousModel,        // Last model used
  reasonCode,           // Why switching? INITIAL, RATE_LIMIT, TIMEOUT, etc.
  recoverToAnchor,      // After recovery, return to anchor
  contextPack
})

→ Selected model (same or different)

// Smart decisions:
- QA tasks → Fast models (claude-opus-4.5-haiku)
- Complex logic → Large models (claude-opus-4.5)
- Recovery → Anchor model
- Rate limited → Fallback model
```

**Budget Tracking:**

```typescript
budgets: {
  limits: {
    maxCycles: 12,
    maxDurationMs: 45 * 60 * 1000,    // 45 minutes
    maxInputTokens: 2_000_000,
    maxOutputTokens: 400_000,
    maxUsd: 20
  },

  usage: {
    cyclesUsed,
    durationMsUsed,
    inputTokensUsed,
    outputTokensUsed,
    usdEstimate
  },

  exceeded: boolean
}
```

**Git Integration:**

```typescript
gitMode: "auto_branch_commit" | "patch_only"

Session Start:
  ├─ getCurrentBranch() → baseBranch
  └─ createSessionBranch(sessionId) → branchName

Session Execution:
  ├─ Make changes on session branch
  ├─ Track touchedFiles

Session End:
  ├─ findWorkspaceConflict() → Detect merge issues
  ├─ Run tests
  ├─ commitSession() → commitHash created
  ├─ Switch back to baseBranch
  └─ Cleanup session branch
```

---

## Gateway ve API

### Auth Server (OAuth Callback Handler)

**HTTP Endpoints:**

```
GET /health
  ├─ Response: 200 "ok" (text/plain)
  └─ Purpose: Health check for reverse proxy

GET /oauth-callback?code=CODE&state=STATE
  OR
GET /?code=CODE&state=STATE
  ├─ Parameters:
  │  ├─ code: OAuth authorization code (required)
  │  ├─ state: CSRF token (required)
  │  ├─ error: Provider error (optional)
  │  └─ error_description: Error details (optional)
  ├─ Response: 200 HTML + token
  └─ On error: 400 HTML error message
```

**Callback Flow:**

```typescript
AuthServer.start()
  → Promise<AuthResult>

    ├─ Listen on port (default: 51121)
    ├─ 10 minute timeout
    ├─ Wait for request
    │
    ├─ On Request:
    │  ├─ Parse URL + params
    │  ├─ Validate: code exists, state exists
    │  ├─ Validate: state matches (CSRF)
    │  ├─ Call exchangeSovereign AI(code, state)
    │  ├─ Add token to TokenStore
    │  ├─ Return HTML success/error
    │  └─ Close server (500ms cleanup delay)
    │
    ├─ On Timeout:
    │  ├─ Return: {errorCode: OAUTH_TIMEOUT}
    │  └─ Close server
    │
    └─ On Error:
       ├─ Return: {errorCode, errorDescription}
       └─ Close server
```

### TokenStore (Token Persistence)

**Operations:**

```typescript
// Load from disk (encrypted)
loadFromDisk()
  ├─ Path: ~/.config/opencode/sovereign-tokens.json
  ├─ Decrypt with KeyManager v3 (AES-256-GCM)
  ├─ Parse JSON
  ├─ Cache in memory
  └─ Return TokenStoreData

// Save to disk (encrypted)
saveToDisk()
  ├─ Serialize TokenStoreData
  ├─ Encrypt with KeyManager
  └─ Write atomic (write .tmp, rename)

// Manage active token
getValidAccessToken(email)
  ├─ Get cached token
  ├─ Check expiry (5 min buffer)
  ├─ If expired: refreshActiveToken()
  └─ Return access token

// Add/update account
addOrUpdateAccount(account)
  ├─ Add or update in accounts[]
  ├─ Mark activeIndex
  ├─ saveToDisk()

// Refresh active token
refreshActiveToken()
  ├─ Get refresh token
  ├─ POST /oauth2.googleapis.com/token
  ├─ Update in store
  ├─ saveToDisk()
  └─ Return StoredToken
```

**Encryption:**

```
KeyManager v3:
  ├─ Master key: Derived from system machine ID + password
  ├─ Algorithm: AES-256-GCM
  ├─ IV: Random per encryption
  ├─ Salt: Random per encryption
  ├─ Auth tag: Integrity verification
  └─ Output: {ciphertext, iv, salt, tag, version}
```

### Gateway Auth Manager

**Token States:**

```
Tier 1: Active Token
  ├─ Current authorization token
  ├─ Used for all requests
  └─ Can be rotated (with grace period)

Tier 2: Grace Tokens
  ├─ Previous token during rotation
  ├─ TTL: 60 seconds
  ├─ Used for in-flight requests
  └─ Auto-cleanup when expired

Tier 3: WebSocket Tickets
  ├─ Single-use tokens for WS upgrade
  ├─ Format: "agt_ws_" + base64url(24 bytes)
  ├─ TTL: 60 seconds
  ├─ One-time consumption
  └─ Session-bound verification
```

**Token Rotation:**

```typescript
rotateToken(nextToken?) {
  // Generate new token if not provided
  const token = nextToken || generateToken()

  // Move current to grace period
  graceTokens.set(activeToken, {
    token: activeToken,
    expiresAt: Date.now() + 60000
  })

  // Update active
  activeToken = token

  // Return new token
  return { token, graceExpiresAt: ISO8601 }
}

// Cleanup on stop
revokeGraceTokens() {
  graceTokens.clear()
}
```

---

## Hesap ve Token Yönetimi

### Multi-Account Strategy

**Selection Algorithms:**

| Strategy | Seçim Kriteri | Açıklama |
|----------|---------------|----------|
| **Sticky** | `lastUsed` + rate limit | Aynı hesabı kullan, rate limit'e kadar |
| **Round-Robin** | `cursor++` modulo | Sırayla rotate et |
| **Hybrid** | Health score + token bucket + LRU | Intelligent selection |

**Rate Limit Handling:**

```
Account rate-limited on family (claude/gemini)
  ↓
Set resetTime = now + backoff[reason]
  ↓
Mark account cooling down
  ↓
Select next account
  ↓
Retry request with new account
  ↓
(Auto-repeat up to 10 times)
  ↓
If no accounts available:
  ├─ Wait for any account to cool down
  ├─ Return error (with retry hint)
  └─ User can retry manually
```

**Soft Quota (Proactive Warning):**

```
Quota < threshold (20% default)
  ├─ Show toast: "Nearing quota limit"
  ├─ Continue accepting requests
  └─ Return advisory header

Quota = 0
  ├─ Block requests on that account
  ├─ Switch to account with quota
  └─ If no accounts: return error
```

### Token Lifecycle

**Refresh Strategies:**

```
REACTIVE (On-Demand):
  Request → Check expiry
    ├─ Yes: refreshAccessToken()
    └─ No: Use cached token

PROACTIVE (Background):
  Every 5 minutes:
    ├─ Check accounts expiring within 30 min
    ├─ Refresh tokens (serialize, no concurrency)
    ├─ Update in store
    └─ Persist to disk
```

**Token Storage:**

```
Refresh Token Format:
  "${refreshToken}|${projectId}|${managedProjectId}"

  Example:
  "1//0gMm....|rising-fact-p41fc|"

  Usage:
  Split on "|" → [refreshToken, projectId, managedProjectId]
```

---

## Caching ve State Management

### L1/L2 Signature Cache (Thinking Blocks)

**Cache Structure:**

```
L1 (Memory):
  Map<sessionId, Map<textHash, SignatureEntry>>

  textHash: SHA-256(text) → first 16 hex chars
  SignatureEntry: {signature, timestamp}

  Capacity per session: 100 entries
  TTL: 1 hour
  Eviction: LRU (oldest 25%)

L2 (Disk):
  Implicit (external SignatureCache instance)

  Used when L1 miss
  Writes through from L1
  No explicit cleanup (natural TTL expiry)
```

**Lifecycle:**

```
cacheSignature(sessionId, text, signature):
  1. Compute hash = SHA-256(text)[0:16]
  2. Store in L1: memory[sessionId][hash] = {signature, now}
  3. Check capacity: if > 100
     ├─ Remove TTL-expired entries
     ├─ If still > 100: remove oldest 25%
  4. Write to L2: diskCache.store()

getCachedSignature(sessionId, text):
  1. Compute hash
  2. Check L1:
     ├─ Found & not expired: return signature
     ├─ Found & expired: delete, continue to L2
     └─ Not found: continue to L2
  3. Check L2:
     ├─ Found: promote to L1, return
     └─ Not found: return null
```

**Performance Impact:**

```
Typical multi-turn conversation:
  ├─ Turn 1: Generate signature (network call)
  ├─ Turn 2-N: Use cached signature (O(1) lookup)
  ├─ Speedup: ~100-200ms per cached turn
  └─ Conversation of 10 turns: ~1 second saved
```

### Account Storage (Disk Persistence)

**Schema (V3):**

```json
{
  "version": 3,
  "accounts": [
    {
      "email": "user@example.com",
      "refreshToken": "1//0gXXX...",
      "projectId": "rising-fact-p41fc",
      "managedProjectId": null,
      "addedAt": 1709900000000,
      "lastUsed": 1709910000000,
      "enabled": true,
      "lastSwitchReason": "rate-limit",
      "rateLimitResetTimes": {
        "claude": 1709920000000,
        "gemini": null
      },
      "coolingDownUntil": null,
      "cooldownReason": null,
      "fingerprint": {
        "userAgent": "sovereign/1.15.8 windows/amd64",
        "clientMetadata": "ideType=IDE_UNSPECIFIED,..."
      },
      "cachedQuota": {
        "claude": {
          "remainingFraction": 0.75,
          "resetTime": "2026-03-10T12:00:00Z",
          "modelCount": 3
        }
      },
      "cachedQuotaUpdatedAt": 1709910000000,
      "healthScore": 85
    }
  ],
  "activeIndex": 0,
  "activeIndexByFamily": {
    "claude": 0,
    "gemini": 1
  }
}
```

**Persistence Properties:**

```
Write Safety:
  ├─ File locking (proper-lockfile)
  ├─ Atomic rename (.tmp → final)
  ├─ Delta merge (new + existing)
  └─ Deduplication (by email)

Encryption:
  ├─ Master key: Machine ID + system password
  ├─ Algorithm: AES-256-GCM
  ├─ Per-file IV + salt
  └─ Integrity checking (auth tag)

Durability:
  ├─ Sync on every account change
  ├─ Debounced saveToDisk (1s batch)
  ├─ On crash: previous version recoverable
  └─ Unencrypted migration allowed
```

### Config State (Zod Validation)

**Resolution Order:**

```
1. Schema defaults
   └─ All types, hardcoded values

2. User config (~/.config/opencode/sovereign.json)
   └─ Partial override

3. Project config (.opencode/sovereign.json)
   └─ Final override

4. Environment variables (OPENCODE_SOVEREIGN_*)
   └─ Top priority

Final config: Zod validation + type safety
```

---

## Test Stratejisi

### Test Kategorileri

**Total: 557 test files (54 .test.ts dosyası)**

#### Plugin Tests (49 dosya)

```
accounts.test.ts (150+ cases)
  ├─ Account selection: sticky, round-robin, hybrid
  ├─ Rate limiting: family-specific, exponential backoff
  ├─ Health score: recovery, penalties, min threshold
  ├─ Quota caching: update, invalidation
  └─ Disk persistence: load, save, merge, dedup

auth.test.ts
  ├─ Token parsing: refresh token format
  ├─ Expiry calculation: buffer, clock skew
  └─ Validation: edge cases

request.test.ts (large suite)
  ├─ Thinking block management: strip, cache, inject
  ├─ Tool ID assignment: 3-pass, orphan recovery
  ├─ Schema cleaning: normalization pipeline
  ├─ Response transformation: model-specific
  └─ Error detection: tool_result_missing, blocks

request-helpers.test.ts
  ├─ Schema cleaning: refs, allOf, anyOf, oneOf flattening
  ├─ Thinking filtering: signature validation, sentinel injection
  ├─ Tool pairing fixes: 3-pass matching
  └─ JSON recovery: malformed parsing

recovery.test.ts
  ├─ Error type detection
  ├─ Recovery strategy selection
  ├─ Session repair (synthetic tool results)
  └─ Auto-resume after recovery

cache.test.ts
  ├─ Memory/disk cache hierarchy
  ├─ TTL enforcement
  ├─ Capacity management (LRU eviction)
  └─ Concurrent access

storage.test.ts
  ├─ Encryption/decryption
  ├─ Atomic writes
  ├─ Migration (V1/V2→V3)
  ├─ Deduplication
  └─ File locking

config/schema.test.ts
  ├─ Zod validation
  ├─ Type checking
  ├─ Default values
  └─ Env var override

rotation.test.ts
  ├─ Health score updates
  ├─ Passive recovery (hourly)
  ├─ Token bucket regen
  ├─ Account selection algorithms
  └─ Hybrid scoring

refresh-queue.test.ts
  ├─ Proactive check interval
  ├─ Expiry buffer calculation
  ├─ Concurrent refresh prevention
  └─ Error recovery
```

#### Orchestration Tests (13 dosya)

```
sequential-pipeline.test.ts
  ├─ Agent execution order
  ├─ Parallel grouping
  ├─ Backtracking logic
  ├─ Halt conditions
  └─ Output file management

autonomous-loop-engine.test.ts
  ├─ State machine transitions
  ├─ Task graph progression
  ├─ Gate verification
  ├─ Budget tracking
  ├─ Error recovery with model switching
  └─ Pause/resume/stop operations

autonomy-model-router.test.ts
  ├─ Model selection logic
  ├─ Recovery strategies
  ├─ Rate limit fallbacks
  └─ Quality-based decisions

skill-generator.test.ts
  ├─ Dynamic skill generation
  ├─ Tool binding
  └─ Execution validation

skill-mapper.test.ts
  ├─ Skill availability detection
  ├─ Mapping validation
  └─ Category inference
```

#### Gateway Tests (5 dosya)

```
auth-server.test.ts
  ├─ OAuth callback handling
  ├─ State validation
  ├─ Error scenarios (timeout, provider error)
  └─ HTML response generation

token-store.test.ts
  ├─ Token persistence
  ├─ Refresh lock (concurrent)
  ├─ Expiry checking
  └─ Email-based lookup

gateway-auth-manager.test.ts
  ├─ Token rotation
  ├─ Grace period
  ├─ WS ticket lifecycle
  └─ Masking

server.health.test.ts
  ├─ GET /api/health
  ├─ OAuth port conflict detection
  └─ Error responses
```

### Testing Techniques

**Mocking Strategy:**

```typescript
// Timer control
vi.useFakeTimers()
vi.advanceTimersByTime(11 * 60 * 1000)  // TTL tests
vi.useRealTimers()

// Process mocking
vi.stubGlobal('process', {platform: 'win32'})

// Module mocking
vi.mock('../accounts.ts')

// HTTP mocking
globalThis.fetch = vi.fn()
  .mockResolvedValueOnce(new Response(...))
```

**Test Fixtures:**

```typescript
beforeEach(() => {
  // Fresh state for each test
  accountManager = new AccountManager()
  healthTracker = new HealthScoreTracker()
  tokenBucket = new TokenBucketTracker()
})

afterEach(() => {
  // Cleanup
  vi.clearAllMocks()
  accountManager.clearAccounts()
})
```

**Edge Case Coverage:**

```
✓ Empty data (no accounts, no models)
✓ Boundary conditions (0 quota, max retries)
✓ Concurrent operations (parallel refreshes)
✓ Timeout scenarios (slow networks)
✓ Invalid data (corrupted tokens, malformed JSON)
✓ Protocol mismatches (gemini-cli vs sovereign headers)
✓ Model-specific behavior (Claude vs Gemini)
✓ Legacy format migration (V1/V2→V3)
✓ Permission errors (EACCES, file locked)
✓ Network errors (ECONNREFUSED, DNS failed)
```

---

## Güvenlik Özellikleri

### 1. OAuth Security (PKCE)

```
Verifier Protection:
  ├─ 64-character random value
  ├─ Generated server-side
  ├─ Never transmitted to client
  ├─ Never in URL (only challenge)
  └─ Challenge = SHA-256(verifier) base64url

State Token:
  ├─ 32-character random
  ├─ CSRF protection
  ├─ One-time use (consumed after validation)
  ├─ 10-minute expiration
  └─ TTL-based cleanup
```

**Attack Mitigation:**

```
Authorization Code Interception:
  ├─ Without verifier: Code is useless
  ├─ Attacker can't use code without verifier
  └─ Verifier only known to legitimate app

CSRF Attacks:
  ├─ State token must match
  ├─ Cross-site requests fail
  └─ Prevents malicious redirects

Replay Attacks:
  ├─ State consumed after first use
  ├─ Second use fails
  └─ Prevents token reuse
```

### 2. Token Security

**At Rest:**
```
Storage: ~/.config/opencode/sovereign-tokens.json
Encryption: AES-256-GCM (AEAD cipher)
Key Derivation: PBKDF2(machineId, password)
IV: Random per encryption
Auth Tag: Integrity verification
```

**In Transit:**
```
HTTPS enforced
Bearer token in Authorization header
X-Goog-Api-Client header for model identification
User-Agent fingerprinting (per request randomization)
```

**On Server:**
```
Token cache: In-memory, session-scoped
Refresh tokens: Encrypted on disk
Access tokens: 1-hour expiry + buffer (refresh at 30 min)
Grace tokens: Max 60-second retention during rotation
```

### 3. CSRF Protection

**Token Binding:**

```typescript
CSRFTokenManager:
  ├─ Session-bound tokens
  ├─ HMAC-SHA256 signed
  ├─ One-time consumption
  ├─ 1-hour lifetime
  └─ GET: issue token (X-CSRF-Token)
  └─ POST/PUT/DELETE: validate + consume

Mitigation:
  ├─ Cross-site form submit blocked (token required)
  ├─ Cross-origin requests fail (SameSite cookie policy)
  ├─ Token consumed immediately (prevents reuse)
```

### 4. Account Isolation

```
Per-Family Rate Limits:
  ├─ claude family independent
  ├─ gemini family independent
  └─ Prevents one family blocking another

Health Score Tracking:
  ├─ Per-account reputation
  ├─ Rate-limited accounts penalized
  ├─ Recovery over time (passive)
  └─ Failed accounts rotated out

Fingerprint Verification:
  ├─ User-Agent tracking
  ├─ Client-Metadata validation
  ├─ PID-based offset (multi-session load distribution)
  └─ Helps detect account hijacking
```

### 5. Error Handling Security

**No Information Leakage:**

```
User Errors:
  ├─ Generic messages (no token details)
  ├─ No refresh token exposed
  ├─ No email hints in debug logs
  └─ Redirects to safe error handler

Debug Logs:
  ├─ Separate log file (if debug enabled)
  ├─ Excluded from public output
  ├─ File permissions restrict access
  └─ Temp cleanup on plugin shutdown
```

### 6. Session Management

```
Plugin Session:
  ├─ Per-tab in IDE
  ├─ Private to that tab
  ├─ Isolated from other sessions
  └─ No cross-tab token sharing

Gateway Session:
  ├─ Per-HTTP-connection
  ├─ Session ID generation (secure random)
  ├─ OAuth state = session-scoped
  └─ Cleanup after use
```

---

## Performance Optimizasyonları

### 1. Caching Strategy

**Signature Cache (Thinking Blocks):**

```
Single-turn request:
  ├─ Generate fresh signature
  ├─ Cost: ~1ms crypto operation
  └─ Stored for future turns

Multi-turn conversation (10 turns):
  ├─ Turn 1: Generate + cache (1ms)
  ├─ Turns 2-10: Cache hits (0.1ms each)
  ├─ Total savings: ~1 second
  └─ Network latency reduction
```

**Auth Cache (Token):**

```
First request: Lookup, refresh if needed (~50ms network)
Subsequent: In-memory cache (<1ms)
Accounts with valid tokens: Direct use
Expired accounts: Proactive refresh (background)
```

### 2. Account Selection Optimization

**Sticky Strategy (Default):**

```
Benefits:
  ├─ Same account reused until rate-limited
  ├─ Reduces header computation
  ├─ Cache-friendly (same session context)
  └─ Minimizes connection overhead
```

**Round-Robin:**

```
Benefits:
  ├─ Distributes load evenly
  ├─ Prevents single account exhaustion
  ├─ Fair quota usage
  └─ Deterministic rotation
```

**Hybrid (Advanced):**

```
Scoring algorithm:
  score = health*2 + (tokens/max)*500 + freshness*360

  Benefits:
  ├─ Intelligent selection (best account)
  ├─ Prevents thrashing (stickiness bonus)
  ├─ Recovery-aware (health penalties)
  ├─ Token bucket fairness
  └─ Minimal switching overhead
```

### 3. Token Management

**Proactive Refresh:**

```
Benefits:
  ├─ Prevents "expired token" errors
  ├─ Background operation (non-blocking)
  ├─ Serial refresh (prevents thundering herd)
  ├─ Buffer-based (30 min before expiry)
  └─ Configurable check interval (5 min default)
```

**Debounced Persistence:**

```
Accounts: saveToDisk() delayed 1 second
  ├─ Batches multiple updates
  ├─ Reduces disk I/O
  ├─ Atomic writes prevent corruption
  └─ Async (non-blocking)
```

### 4. Request Optimization

**Thinking Warmup:**

```
Concept: Pre-count tokens before real request

Flow:
  1. Generate small conversation
  2. Call model to count tokens (O(1) vs network latency)
  3. Adjust thinking budget based on available context
  4. Make real request with optimized budget

Time Saved: ~100-200ms per request (eliminates guess-and-retry)
```

**Parallel Quota Fetching:**

```
checkAccountsQuota(accounts):
  ├─ For each account: parallel fetch
  │  ├─ fetchAvailableModels()
  │  ├─ fetchGeminiCliQuota()
  │  └─ Both concurrent (Promise.all)
  ├─ Timeout: 10s individual, no hanging
  └─ Total time: ~2s instead of 5s
```

### 5. Memory Management

**Signature Cache Capacity:**

```
Per-session: Max 100 entries
Memory/entry: ~200 bytes (signature + hash + metadata)
Total/session: ~20 KB max
Multi-session: 1000 sessions = ~20 MB max
Cleanup: LRU eviction on overflow + TTL expiry
```

**Account Store Deduplication:**

```
Before: Multiple entries per email
After: Single entry, newest wins
Benefits:
  ├─ Smaller JSON file
  ├─ Faster loading
  ├─ Reduced memory footprint
  └─ Cleaner data
```

---

## Özet: Proje Mimarisi

### Temel Prensip

1. **Modular Design:** Her modül single responsibility, loosely coupled
2. **Layered Architecture:** Clear separation (Plugin → Orchestration → Gateway → OAuth)
3. **State Isolation:** Per-session, per-family, per-account state
4. **Deterministic Behavior:** Reproducible (tests, recovery scenarios)
5. **Graceful Degradation:** Fallback endpoints, alternative models
6. **Non-Blocking:** Async operations, proactive background tasks
7. **Security-First:** PKCE, CSRF, encryption, audit logs

### Strengths

✅ **Robust Multi-Account:** Independent rate limits, health tracking, rotation
✅ **Comprehensive Testing:** 54 test files, high coverage
✅ **Production-Grade Token Management:** Encryption, persistence, refresh
✅ **Advanced Thinking Block Support:** Signature caching, multi-turn support
✅ **Agentic Orchestration:** Both sequential (18-agent) and autonomous loops
✅ **Performance Optimizations:** Caching, batching, parallel operations
✅ **Security Hardened:** PKCE, CSRF, encryption, session isolation
✅ **Extensible Architecture:** Easy to add new models, strategies, error handlers

### Areas for Enhancement

→ Quota cache invalidation strategy (currently: manual refresh)
→ Explicit fingerprint history trimming (implicit: max 10 entries)
→ PID-based offset documentation (multi-session load distribution)
→ API versioning strategy (currently: single version, hardcoded)
→ Circuit breaker pattern (rate limit exhaustion recovery)
→ Observability: Structured logging, metrics collection

---

## Dosya Yolları (Önemli Modüller)

```
d:\PROJECT\AGENT\
├── index.ts                                # Exports
├── constants.ts                            # Config values
│
├── src\
│   ├── plugin.ts                          # Main orchestrator
│   │
│   ├── sovereign\
│   │   ├── oauth.ts                       # PKCE flow
│   │   └── oauth.test.ts
│   │
│   ├── plugin\
│   │   ├── auth.ts                        # Token validation
│   │   ├── request.ts                     # Request transformation
│   │   ├── request-helpers.ts             # Helpers
│   │   ├── token.ts                       # Token lifecycle
│   │   ├── cache.ts                       # L1/L2 caching
│   │   ├── storage.ts                     # Persistence
│   │   ├── accounts.ts                    # Multi-account mgmt
│   │   ├── quota.ts                       # Quota tracking
│   │   ├── rotation.ts                    # Health + token bucket
│   │   ├── refresh-queue.ts               # Proactive refresh
│   │   ├── recovery.ts                    # Error recovery
│   │   ├── config/                        # Config resolution
│   │   │   ├── schema.ts                  # Zod validation
│   │   │   ├── loader.ts                  # Env loading
│   │   │   └── models.ts                  # Model definitions
│   │   └── ...
│   │
│   ├── orchestration\
│   │   ├── agents.ts                      # 18-agent definitions
│   │   ├── sequential-pipeline.ts         # Pipeline executor
│   │   ├── autonomous-loop-engine.ts      # Autonomous loop
│   │   ├── autonomy-model-router.ts       # Model selection
│   │   ├── autonomy-types.ts              # Type definitions
│   │   ├── shared-memory.ts               # Agent comm
│   │   ├── sovereign-client.ts          # API wrapper
│   │   └── ...
│   │
│   ├── gateway\
│   │   ├── auth-server.ts                 # OAuth callback
│   │   ├── token-store.ts                 # Token persistence
│   │   ├── gateway-auth-manager.ts        # Token rotation
│   │   ├── oauth-port.ts                  # Port checker
│   │   └── ...
│   │
│   ├── hooks\
│   │   └── auto-update-checker\           # Version mgmt
│   │
│   ├── skills\
│   │   ├── ast-indexer.ts                 # Code analysis
│   │   ├── sandbox-manager.ts             # Docker execution
│   │   └── self-healing.ts                # Error pattern detection
│   │
│   └── middleware\
│       └── csrf.ts                        # CSRF protection
│
└── vitest.config.ts                       # Test configuration
```

---

**Rapport Tarihi:** 2026-03-09
**Tarafından:** Code Analysis System
**Proje Durumu:** Production Ready (v1.4.6)

---

## Mission Control Blank Screen Stabilization (2026-03-09)

### Root Cause
1. Webview main bundle script was loaded without `type="module"`.
2. Asset resolution used "first .js" behavior, which could select `vendor-*` chunks.
3. `authToken` could be sent before UI listener was ready.

### Implemented Fixes
- Deterministic asset resolver added with priority: `assets/index.js/index.css` -> `dist/index.html` entries -> non-vendor fallback scan.
- Webview HTML contract hardened:
  - main script now `type="module"`
  - nonce + CSP invariants preserved
  - inline boot guard sends `ui_boot_started`, `ui_boot_failed`, `ui_boot_ready`.
- Extension boot handshake added:
  - outgoing messages are gated until `ui_boot_ready`
  - `authToken` and initial snapshots are sent only after boot-ready.
- UI boot/data lifecycle stabilized:
  - store states `bootState` and `dataState` added
  - post-boot init order fixed: health check -> accounts/models/sessions/queue -> optional WS subscribe.
- OAuth actionable error mapping added for `OAUTH_CALLBACK_PORT_IN_USE`.
- Mission Control fallback UX improved for empty-state/error-state visibility.

### Verification Commands
- `npm run lint --prefix ui`
- `npm run build --prefix ui`
- `npm run compile --prefix vscode-extension`
- `npm run lint --prefix vscode-extension`
- `npm run build --prefix vscode-extension`
- `npm test`

### Residual Risks
- Boot-failure telemetry depends on VS Code webview messaging channel availability.
- If extension host is unstable, queued pre-boot messages may be lost across host restarts.

### Release Decision
- **GO** (stabilization changes + regression tests added and passing).
