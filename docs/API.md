# API

Two surfaces are documented here: the **optimization bridge** (Python, internal) and the **gateway** (TypeScript, public). The gateway fronts the bridge and also exposes mission, OAuth, and WebSocket routes.

All responses are JSON unless noted. Every response carries `X-Request-ID`; if the caller sent one, it is echoed back, otherwise one is generated.

---

## Optimization bridge — `http://optimization-bridge:9100`

### Auth

All endpoints except `/health` and `/ready` require:

```
X-Bridge-Secret: <AI_STACK_BRIDGE_SECRET>
```

Comparison is constant-time. A missing or mismatched secret returns:

```
401 Unauthorized
{"error": "unauthorized"}
```

### GET `/health`

Liveness probe. No auth.

```
200 OK
{
  "status": "ok",
  "timestamp": "2026-04-19T10:53:00Z"
}
```

### GET `/ready`

Readiness probe. No auth. Returns 503 until the orchestrator has finished first-time init.

```
200 OK              503 Service Unavailable
{"ready": true}     {"ready": false, "reason": "orchestrator_not_initialized"}
```

### GET `/status`

Component-level health. Returns a map of dependency → state.

```
200 OK
{
  "ollama": "ok" | "unreachable" | "http_<code>",
  "openrouter": "configured" | "no_key",
  "exact_cache": "ok" | "unavailable",
  "semantic_cache": "ok" | "unavailable",
  "rag": "ok" | "unavailable",
  "circuit_<model>": "open" | "closed"
}
```

### POST `/optimize`

Run the full pipeline.

Request:

```json
{
  "message": "The message to optimize (required, non-empty)",
  "context": ["optional", "array", "of", "context", "chunks"],
  "force_layers": ["optional", "explicit", "layer", "order"]
}
```

Response:

```json
{
  "optimized": "the compressed / retrieved / cached response",
  "tokens": { "original": 123, "sent": 87 },
  "savings_percent": 29.3,
  "cache_hit": false,
  "layers": ["llmlingua", "dedup"],
  "model": "ollama:qwen2.5-7b-q4",
  "metadata": {
    "elapsed_ms": 142,
    "message_type": "code_generation",
    "complexity": 7
  }
}
```

Errors:

| Status | Body | Meaning |
|--------|------|---------|
| 400    | `{"error":"missing_message"}`           | Body had no `message` field or it was empty. |
| 401    | `{"error":"unauthorized"}`              | Secret missing / wrong. |
| 500    | `{"error":"internal_error","message":"…","error_type":"…","request_id":"…"}` | Uncaught exception; the middleware converted it. |

### GET `/cache-stats`

```
200 OK
{
  "exact": { "entries": 1234, "hits": 890, "misses": 344 },
  "semantic": { "entries": 5678, "hits": 412, "misses": 5266 }
}
```

### POST `/cache-clear`

Request:

```json
{"tier": "exact" | "semantic" | "all"}
```

Response:

```json
{"cleared": "exact" | "semantic" | "all", "evicted": 1234}
```

### GET `/cost-report?period=today|week|month`

```
200 OK
{
  "period": "today",
  "requests": 412,
  "tokens_original": 512340,
  "tokens_sent": 198221,
  "savings_percent": 61.3,
  "cost_usd_estimate": 0.94
}
```

---

## Gateway — `https://<public-host>`

Auth: `Authorization: Bearer <ALLOY_GATEWAY_TOKEN>` on all `/api/*` routes except `/api/health`.

### GET `/api/health`

Liveness. No auth. Always 200 if the process is alive.

### POST `/api/optimize`

Thin passthrough to the bridge's `/optimize`. Same request/response body. Additional translations:

- Bridge timeout → `504 Gateway Timeout`
- Bridge unreachable → `503 Service Unavailable`
- Bridge 500 → `502 Bad Gateway` (the upstream error is included in the body)

`X-Request-ID` from the client is forwarded to the bridge and echoed back.

### Mission + OAuth routes

See the route registrations in `AGENT/src/api/routers/` and `AGENT/src/gateway/server.ts`. OAuth is documented in `AGENT/src/gateway/auth-server.ts`.

---

## Conventions

- **Error envelopes.** Non-2xx responses always have `{"error": "<stable-slug>", ...}`. `error` is stable and safe to branch on; `message` is human-readable and may change.
- **Request correlation.** Every request has `X-Request-ID`. Use it when filing bugs or digging through logs.
- **Idempotency.** `/optimize` is not idempotent at the billing layer but is safe to retry at the protocol layer (cache dedupes identical inputs).
- **Versioning.** All routes are `/api/v0` effectively; there is no version prefix yet. When we break a contract we will introduce `/api/v1`.
