# Sovereign Settings

This document explains how the Sovereign Settings service — the backbone that
lets the UI configure every environment variable, provider, route, MCP server,
and pipeline layer — actually works.

## Principles

1. **Schema is truth.** A single Zod schema (`AGENT/src/services/settings/schema.ts`)
   defines the shape of every setting. The API, the UI form renderer, and the
   persistence layer are all derived from that one source.
2. **Secrets never round-trip.** API keys, OAuth tokens, and webhook secrets
   are stored in a dedicated `settings_secrets` table using AES-256-GCM envelope
   encryption. The API returns `{ set: true, updated_at }` for any secret path
   — the plaintext never leaves the server after the initial write.
3. **Live by default.** A PATCH of `appearance.theme` should be reflected in
   the UI within one render cycle, without requiring a gateway restart.
4. **Safe by default.** `PATCH` merges; only explicit `""`/`null` clears a
   value; `undefined` leaves the existing value untouched. This lets the UI
   send partial forms without accidentally wiping fields it didn't render.

## Storage layout

Settings live in SQLite under `xdgConfig/sovereign/settings.db`:

| Table              | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `settings`         | Non-secret values, stored as a single JSON blob per row. |
| `settings_secrets` | Encrypted envelopes keyed by `path` (dotted notation).   |

Secret envelopes carry `ciphertext`, `iv`, `auth_tag`, `created_at`,
`updated_at`. The master key comes from `SOVEREIGN_MASTER_KEY` (32 bytes
base64 or 64-char hex). In development, if the env var is missing, the service
logs a one-time warning and synthesizes an ephemeral in-memory key so the dev
loop isn't blocked. Staging and production refuse to start without the key.

## REST endpoints

| Method | Path                              | Purpose                                        |
| ------ | --------------------------------- | ---------------------------------------------- |
| `GET`  | `/api/settings`                   | Fetch the full redacted settings tree.         |
| `PUT`  | `/api/settings`                   | Replace the entire tree (rare — used for imports). |
| `PATCH`| `/api/settings`                   | Deep-merge a partial patch. Returns the new tree. |
| `GET`  | `/api/settings/schema`            | Return the Zod schema as JSON Schema.          |
| `POST` | `/api/settings/reset`             | Wipe all settings and secrets, re-seed defaults. |
| `POST` | `/api/settings/test/:provider`    | Run a lightweight health probe for a provider. |
| `GET`  | `/api/settings/export`            | Download a portable bundle (no secrets).       |

All responses follow the gateway's `{ data, errors }` envelope.

## PATCH semantics — the table nobody writes but everybody needs

| Client sends                  | Server behavior                           |
| ----------------------------- | ----------------------------------------- |
| `{ providers: { openai: { enabled: true } } }` | Merge — only `enabled` is touched. |
| `{ providers: { openai: { api_key: "sk-…" } } }` | Encrypt and store; future reads return `{ set: true }`. |
| `{ providers: { openai: { api_key: "" } } }`  | Delete the secret envelope.                |
| `{ providers: { openai: { api_key: null } } }`| Same as `""` — delete.                    |
| Field omitted entirely        | No change.                                 |
| `{ providers: { openai: { api_key: { set: true } } } }` | Ignored — round-trip of the redacted view. |

## Adding a new setting

1. Extend the Zod schema with the new field. If it's secret, chain
   `.brand<"secret">()`.
2. If it's a dotted path that must hit the secret table, add it to
   `SECRET_PATHS` in `schema.ts`.
3. Wire the UI in the relevant settings page — the primitives in
   `components/sovereign/primitives.tsx` cover ~95% of input shapes (Input,
   Textarea, Select, Switch, SecretInput, Row).
4. Settings that affect routing or the pipeline don't need a gateway restart —
   the optimization service reads settings on each request. Settings that
   affect process-level things (e.g. `data.data_dir`) warn the user that a
   restart is needed.

## Provider probes

Each provider ships a lightweight "can we reach this?" probe under
`AGENT/src/services/settings/provider-tests.ts`. Probes use an
`AbortController` with a short timeout and return a uniform shape:

```ts
interface ProbeResult {
  ok: boolean;
  latency_ms: number;
  reason: "ok" | "unauthorized" | "unreachable" | "oauth_required" | "disabled" | "error";
  detail?: string;
  models_seen?: string[];
}
```

The UI renders `reason` as a human label and surfaces `detail` for the
failure modes that have useful error copy.

## Operational notes

- **Backups:** copy `settings.db` alongside `settings.db-wal` and
  `settings.db-shm`. WAL mode is used so a snapshot is consistent.
- **Rotations:** re-encrypt envelopes by running
  `node scripts/rotate-master-key.ts --old $OLD --new $NEW`.
- **Audit:** every write records `updated_by` (`"user"` or `"system"`) and a
  timestamp.
