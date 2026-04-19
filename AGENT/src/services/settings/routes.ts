/**
 * Fastify routes for the Sovereign settings service.
 *
 *   GET    /api/settings                — redacted view (safe for UI)
 *   PUT    /api/settings                — validate + persist full payload
 *   PATCH  /api/settings                — deep-merge partial payload
 *   GET    /api/settings/schema         — JSON Schema for form rendering
 *   POST   /api/settings/reset          — wipe to defaults
 *   POST   /api/settings/test/:provider — probe a provider's connectivity
 *   GET    /api/settings/export         — non-secret backup (JSON)
 *
 * The redacted view is what the UI consumes. Secrets are never returned in
 * plaintext; the UI sees `{ set: boolean, updated_at?: number }` per key.
 *
 * PATCH semantics:
 *   - Deep-merges the incoming object with the current settings.
 *   - For secret fields, an explicit `""` or `null` clears the secret;
 *     `undefined` / absent means "leave as-is".
 *   - For array fields (mcp.servers, rules.slash_commands, rag.sources)
 *     PATCH REPLACES the array — partial-array patching invites bugs.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { apiResponse, apiError } from "../../gateway/rest-response.js";
import {
  getSettingsStore,
  settingsSchema,
  SECRET_PATHS,
  type SettingsInput,
  type ProviderName,
  probeProvider,
} from "./index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getRequestId(request: FastifyRequest, reply: FastifyReply): string {
  const existing =
    (request.headers["x-request-id"] as string | undefined) ||
    (request.id as unknown as string | undefined);
  const rid =
    existing ?? `req_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  reply.header("x-request-id", rid);
  return rid;
}

/**
 * Deep-merge — arrays and nulls replace; objects merge recursively.
 * Tight scope so this can live in this file without pulling in lodash.
 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return patch as T;
  }
  if (typeof patch !== "object" || Array.isArray(patch)) {
    return patch as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) {
      out[k] = null; // explicit null clears / replaces
    } else if (
      v !== undefined &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof out[k] === "object" &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

/** Lookup current plaintext secrets for provider probes (server-side only). */
function currentSecrets(): {
  openrouter: string | null;
  anthropic: string | null;
  openai: string | null;
  azure: string | null;
} {
  const store = getSettingsStore();
  return {
    openrouter: store.getSecret("providers.openrouter.api_key"),
    anthropic: store.getSecret("providers.anthropic.api_key"),
    openai: store.getSecret("providers.openai.api_key"),
    azure: store.getSecret("providers.azure.api_key"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerSettingsRoutes(app: FastifyInstance): void {
  // ── GET /api/settings ──────────────────────────────────────────────────
  app.get("/api/settings", async (request, reply) => {
    getRequestId(request, reply);
    const store = getSettingsStore();
    return apiResponse(store.getSettingsRedacted());
  });

  // ── PUT /api/settings — full replacement ───────────────────────────────
  app.put<{ Body: SettingsInput }>("/api/settings", async (request, reply) => {
    getRequestId(request, reply);
    try {
      const store = getSettingsStore();
      const updatedBy = (request.headers["x-sovereign-user"] as string | undefined) ?? "api";
      const redacted = store.setSettings(request.body ?? {}, updatedBy);
      return apiResponse(redacted);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send(
          apiError("invalid settings", {
            code: "SETTINGS_INVALID",
            details: { issues: err.issues },
          }),
        );
      }
      throw err;
    }
  });

  // ── PATCH /api/settings — deep-merge ───────────────────────────────────
  app.patch<{ Body: Record<string, unknown> }>(
    "/api/settings",
    async (request, reply) => {
      getRequestId(request, reply);
      const store = getSettingsStore();
      const current = store.getSettingsRedacted();
      const merged = deepMerge(current as unknown as Record<string, unknown>, request.body ?? {});
      try {
        const updatedBy = (request.headers["x-sovereign-user"] as string | undefined) ?? "api";
        const redacted = store.setSettings(merged as SettingsInput, updatedBy);
        return apiResponse(redacted);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send(
            apiError("invalid settings", {
              code: "SETTINGS_INVALID",
              details: { issues: err.issues },
            }),
          );
        }
        throw err;
      }
    },
  );

  // ── GET /api/settings/schema — JSON Schema for form generation ─────────
  app.get("/api/settings/schema", async (request, reply) => {
    getRequestId(request, reply);
    // `zod-to-json-schema@3` types target Zod v3; we're on v4. Runtime works
    // fine, but the compiler can't bridge the generics — hence the cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSchema = zodToJsonSchema(settingsSchema as unknown as any, {
      name: "Settings",
      $refStrategy: "none",
    });
    return apiResponse({
      schema: jsonSchema,
      secret_paths: SECRET_PATHS,
    });
  });

  // ── POST /api/settings/reset ───────────────────────────────────────────
  app.post("/api/settings/reset", async (request, reply) => {
    getRequestId(request, reply);
    const store = getSettingsStore();
    const updatedBy = (request.headers["x-sovereign-user"] as string | undefined) ?? "api";
    const redacted = store.reset(updatedBy);
    return apiResponse(redacted);
  });

  // ── POST /api/settings/test/:provider — connectivity probe ─────────────
  app.post<{ Params: { provider: string } }>(
    "/api/settings/test/:provider",
    async (request, reply) => {
      getRequestId(request, reply);
      const { provider } = request.params;
      const valid: ProviderName[] = [
        "ollama",
        "openrouter",
        "anthropic",
        "openai",
        "google",
        "lmstudio",
        "azure",
      ];
      if (!valid.includes(provider as ProviderName)) {
        return reply.status(400).send(
          apiError(`unknown provider: ${provider}`, {
            code: "UNKNOWN_PROVIDER",
            meta: { valid },
          }),
        );
      }

      const store = getSettingsStore();
      const settings = store.getSettings();
      const secrets = currentSecrets();
      const result = await probeProvider(provider as ProviderName, settings, secrets);
      return apiResponse(result);
    },
  );

  // ── GET /api/settings/export — non-secret backup ───────────────────────
  app.get("/api/settings/export", async (request, reply) => {
    getRequestId(request, reply);
    const store = getSettingsStore();
    const redacted = store.getSettingsRedacted();
    reply.header("content-disposition", `attachment; filename="sovereign-settings.json"`);
    reply.header("content-type", "application/json");
    return reply.send({
      exported_at: new Date().toISOString(),
      note: "Secrets are NOT included in this export. Re-enter them after import.",
      settings: redacted,
    });
  });
}
