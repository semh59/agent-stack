# Platform plan — Sovereign Console

**Status:** in-flight
**Owner:** CTO
**Stakeholders:** backend, frontend, devrel, product
**Revision:** 1 (2026-04-19)

---

## 1. Positioning

Sovereign is a multi-provider LLM gateway with a live prompt-optimization pipeline. It runs wherever code runs — on a developer laptop, in a VS Code extension, or on a fleet of ECS tasks — and it treats prompt tokens like dollars.

Competitors that shape user expectations:

| Product      | What they nailed                                         | Where we win                          |
|--------------|----------------------------------------------------------|---------------------------------------|
| Cline        | Model-provider breadth, approval UX, checkpoints         | Prompt optimization + cost telemetry is built-in, not bolted on |
| Kilo Code    | Per-mode prompts, rich rules files                       | MAB-driven layer selection is ours alone |
| Continue.dev | Config-as-code, role-per-model routing                   | No YAML gymnastics — every knob has a UI |
| Cursor       | Fast, editor-native feel                                 | Open stack, no SaaS lock-in           |

Our **console** (the web + VS Code webview surface) is the first touch point for every new user. Every setting must be reachable in the UI — `.env` files are a debug backdoor, not the primary interface.

---

## 2. Brand & naming

Product name: **Sovereign**. Console surface: **Sovereign Console**. CLI: **`sovereign`**. VS Code extension display name: **Sovereign for VS Code**.

Internal package names (aligned to the product):

| Package                    | Role                                               |
|----------------------------|----------------------------------------------------|
| `@sovereign/gateway`       | TS Fastify gateway (was `AGENT/`)                  |
| `@sovereign/console`       | React console (was `AGENT/ui/`)                    |
| `@sovereign/extension`     | VS Code extension (was `AGENT/vscode-extension/`)  |
| `sovereign-bridge` (py)    | Python optimization bridge (was `ai-stack-mcp/`)   |

Renaming the npm packages is a mechanical follow-up; the product-facing name and file structure are what change in this pass.

File naming rules — short, scoped, no abbreviations, no three-word compounds:

- React components: `PascalCase.tsx`
- Hooks: `useXxx.ts`
- Feature folders: `src/features/<feature>/`
- Shared primitives: `src/design/`
- Backend services: `src/services/<service>/{index,routes,store,schema,types}.ts`

---

## 3. Information architecture

Top-level navigation is **five primary destinations**, in this order:

1. **Chat** — the everyday driver. Opens to the active conversation; sidebar lists past threads.
2. **Missions** — longer-running autonomous tasks. Shows their pipelines, approvals, history.
3. **Telemetry** — dashboards: token spend, cache hit ratio, MAB arm performance, upstream health.
4. **Settings** — everything else. See §4.
5. **Docs** — contextual help + changelog.

Account switcher + theme toggle + language toggle live permanently in the bottom-left of the shell; they're not settings, they're orientation.

---

## 4. Settings surface (the ask)

Settings is a two-column page: left rail (section list), right pane (forms). Sections, in order:

### 4.1 Providers

One card per provider. Each card has:

- Header (logo, name, enabled toggle, live status dot)
- Form body (endpoint, credentials, model allowlist)
- Footer: `Test connection` button + last-tested timestamp

Providers shipped at v1:

| Provider      | Fields                                                | Test |
|---------------|-------------------------------------------------------|------|
| Ollama        | `base_url`, `default_model`, `timeout_s`              | `GET /api/tags` and list models |
| OpenRouter    | `api_key` 🔒, `default_model`, `http_referer`         | `GET /api/v1/models` |
| Claude (Anthropic) | `api_key` 🔒, `default_model`                    | `GET /v1/models` or a 1-token ping |
| OpenAI        | `api_key` 🔒, `base_url`, `default_model`, `org_id`   | `GET /v1/models` |
| Google (Sovereign AI OAuth) | OAuth button — no raw key                 | Round-trip through the OAuth server |
| LM Studio     | `base_url`, `default_model`                           | `GET /v1/models` |
| Azure OpenAI  | `endpoint`, `api_key` 🔒, `api_version`, `deployment` | `GET /openai/deployments?api-version=…` |

🔒 = secret field — see §6.

### 4.2 Models & routing

- Default model per role: `chat`, `autocomplete`, `edit`, `embed`, `rerank`.
- Per-complexity routing (low/medium/high) — maps to a provider+model.
- Fallback chain: ordered list of providers the cascade tries when the first fails.

### 4.3 Pipeline (optimization)

All optimization-layer knobs. These are what the bridge actually reads.

- **Layers** — enable/disable each layer (cli_cleaner, llmlingua, caveman, dedup, summarizer, noise_filter, rag, semantic_cache), with descriptions and expected savings.
- **Cache** — L1 exact TTL, L2 semantic similarity threshold, L2 TTL, clear-cache button.
- **MAB** — ε (exploration rate), reward threshold, reset-state button.
- **RAG** — sources list (local dirs, URLs, S3 buckets), chunk size, top-k, rebuild-index button.
- **Compression** — LLMLingua target ratio, caveman endpoint, dedup mode.
- **Budgets** — hard stop at N tokens/$ per day / per mission.

### 4.4 MCP (Model Context Protocol)

- List of registered MCP servers (name, transport, command, status).
- Per-server enable/disable, tool allowlist, test-ping.
- "Install from registry" → queries the Claude MCP registry.

### 4.5 Rules & prompts

- Global system prompt (free text).
- Per-mode prompts (code / architect / debug / ask / autonomous).
- `.sovereignrules` file editor (workspace-local + user-global, precedence documented).
- Slash-command definitions.

### 4.6 Observability

- Log level per service (`gateway`, `bridge`, `mcp`).
- OTEL endpoint + service namespace.
- Metrics port.
- Download diagnostic bundle button.

### 4.7 Data

- Data directory path (`AI_STACK_DATA_DIR`).
- Export settings (JSON, secrets redacted or encrypted depending on choice).
- Import settings.
- Reset to defaults (destructive; confirmation dialog).
- Wipe state (MAB, caches, cost log) — granular.

### 4.8 Appearance

- Theme (dark / light / system).
- Language (tr / en).
- Compact mode, accent color.

### 4.9 About

- Version, build SHA, bridge/gateway/console health.
- License, acknowledgements, privacy.

---

## 5. Chat surface

The **Chat view** is Cline-grade or better.

- **Left rail:** conversation list, sortable by recency or pinned, with search.
- **Main pane:** message list, virtualized so a 10k-message thread stays smooth.
- **Message anatomy:** role, model used, token count, duration, expandable tool-call blocks with diff view for file edits, inline approval prompts (`Approve`/`Reject`/`Auto-approve for this session`).
- **Composer:**
  - Textarea with Shift-Enter = newline, Enter = send.
  - Model picker inline (keybind `Ctrl/Cmd-.`).
  - Attachments: files (drag-drop), URLs (paste), selection capture from editor (VS Code only).
  - Context badge: current token budget, file context size, active rules.
- **Cost footer:** live token counter + $-estimate + pipeline status (`cache hit / optimized 42% / fallback`).
- **Streaming:** SSE-backed; cancel token on stop; partial messages persist across reconnects.
- **Checkpoints:** after every tool-call, snapshot workspace diff — one-click revert.

Keyboard shortcuts are first-class:

| Binding        | Action                               |
|----------------|--------------------------------------|
| Cmd/Ctrl-K     | Command palette                      |
| Cmd/Ctrl-.     | Switch model                         |
| Cmd/Ctrl-/     | Focus composer                       |
| Cmd/Ctrl-Shift-N | New conversation                   |
| Cmd/Ctrl-B     | Toggle sidebar                       |
| Cmd/Ctrl-,     | Open Settings                        |
| Esc            | Cancel current stream                |

---

## 6. Secret handling

Secrets (API keys, OAuth client secrets, bridge shared-secret) are the highest-risk piece of this surface. Rules:

1. **Storage** — SQLite table `settings_secrets` with AES-256-GCM envelope encryption. Master key is `SOVEREIGN_MASTER_KEY` (32 bytes, base64 env var); we never ship a default.
2. **Transport** — secrets are only written to the server via `PUT /api/settings/secrets/:key`. They never leave the server in GET responses; the UI shows `••••••••` + "Replace".
3. **UI UX** — `SecretInput` component: empty = "set a new value"; filled with mask = "secret present, click to replace". No "show" button ever — if you need to see the actual value, read the DB.
4. **Export** — default export strips secrets. "Include secrets" requires passphrase; export is encrypted.
5. **Key rotation** — master-key rotation is a CLI-only operation (`sovereign keys rotate`). Re-encrypts all rows atomically.

---

## 7. Settings data model

Two tables, three concerns:

```sql
CREATE TABLE settings (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,    -- JSON-encoded
  updated_at INTEGER NOT NULL
);

CREATE TABLE settings_secrets (
  key          TEXT PRIMARY KEY,
  ciphertext   BLOB NOT NULL,  -- AES-256-GCM
  iv           BLOB NOT NULL,
  auth_tag     BLOB NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

- `settings.key` is a dotted path, e.g. `providers.ollama.base_url`, `pipeline.mab.epsilon`.
- Secrets live in their own table so a stolen SQL dump without the master key is useless.
- No migrations table — schema is additive and shapes are validated by Zod at read time.

Validation layer is **one Zod schema** (`@sovereign/gateway/src/services/settings/schema.ts`). The schema is the contract: it generates TS types for the server, JSON Schema for the UI form renderer, and the public docs. Adding a field = adding one Zod entry, nothing else.

---

## 8. API (settings)

All under `/api/settings`, auth: gateway bearer token.

| Method | Path                                    | Purpose |
|--------|-----------------------------------------|---------|
| GET    | `/api/settings`                         | Return full settings, secrets redacted (mask + `has_value`). |
| PUT    | `/api/settings`                         | Patch settings. Non-secret fields only. Validated against schema. |
| GET    | `/api/settings/schema`                  | Return the JSON-schema + UI hints so the UI can render any settings tree. |
| PUT    | `/api/settings/secrets/:key`            | Write or replace a secret. Body: `{"value":"…"}`. |
| DELETE | `/api/settings/secrets/:key`            | Remove a secret. |
| POST   | `/api/settings/providers/:id/test`      | Run the connection test for a provider. Returns `{ok, latency_ms, detail}`. |
| POST   | `/api/settings/export`                  | Download a settings bundle. Body: `{include_secrets: bool, passphrase?: string}`. |
| POST   | `/api/settings/import`                  | Upload a bundle. Body: `{bundle: base64, passphrase?: string, strategy: "replace"|"merge"}`. |
| POST   | `/api/settings/reset`                   | Reset to defaults. Body: `{scope: "providers"|"pipeline"|"all"}`. |

Every endpoint emits the same `X-Request-ID` contract we use elsewhere.

---

## 9. VS Code extension angle

The extension hosts the same React console inside a webview. Two differences from the web build:

1. **Messaging** — the extension proxies `/api/settings` calls through `vscode.postMessage`, so the webview never needs a live gateway. In "bring-your-own-gateway" mode the extension just forwards to the configured gateway URL.
2. **Editor bridge commands** — palette commands (`Sovereign: New chat`, `Sovereign: Explain selection`, `Sovereign: Apply last diff`) marshal editor state into API calls and render results in the webview.

Per-workspace settings live in `.vscode/settings.json` under `sovereign.*`, and override the gateway defaults. Conflict resolution is: workspace overrides user overrides global.

---

## 10. Implementation phases

Phase 1 — **this PR** (scope of the current session):

- PLATFORM_PLAN.md (this file).
- Backend settings service: schema + store + encryption + routes + provider tests.
- Frontend console shell: new IA, five-way top-nav, Settings layout, Providers page, Pipeline page, Data page.
- Shared design system: `src/design/{tokens.ts,primitives/}`, `SecretInput`, `TestConnectionButton`, `SettingSection`, `Toggle`, `Slider`.
- Chat surface scaffold: layout + composer + message list (wired to a stub API).
- Settings + chat docs.

Phase 2 — **next sprint**:

- MCP registry integration (install + enable servers from UI).
- Rules editor with monaco.
- Telemetry dashboards (recharts wired to `/cost-report` + `/cache-stats` + `/status`).
- Missions view rebuild.
- VS Code extension webview host + palette commands.
- E2E tests with playwright.

Phase 3 — **polish quarter**:

- i18n sweep (all strings through `useTranslation`).
- A11y audit (WCAG 2.1 AA — focus states, keyboard traversal, screen-reader labels).
- Offline mode (cache last settings + health so UI doesn't hang when gateway is down).
- Plugin system for custom settings sections.

---

## 11. Non-goals (explicit)

- No "drag-to-build-your-own-pipeline" visual editor. Settings is a form, not an IDE.
- No team/org features, SSO, RBAC in Phase 1–2.
- No mobile-first layout. Desktop-class screens only (>=1280 px breakpoint).
- No billing UI. Cost telemetry yes; payments no.

---

## 12. Success criteria

This plan is delivered when:

- A new user can go from `docker compose up` to a working chat round-trip **without touching a `.env`**.
- Every setting mentioned in `env/.env.production` has a UI entry in Settings.
- Every secret is encrypted at rest and masked in the UI.
- Adding a new provider takes: (1) a Zod entry, (2) a provider-test module, (3) a logo import — and it shows up in the UI automatically.
- Chat round-trip P95 latency is within 200 ms of the bridge's latency.
