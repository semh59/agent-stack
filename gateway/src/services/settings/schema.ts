/**
 * Alloy settings schema.
 *
 * This is the single source of truth for every knob the console exposes.
 * Adding a new setting = adding an entry here. The schema drives:
 *   - runtime validation on PUT /api/settings
 *   - JSON Schema generation for the UI form renderer
 *   - TypeScript types consumed by both gateway and console
 *
 * Fields marked with `.brand("secret")` are stored in the encrypted
 * `settings_secrets` table and never returned to clients in plaintext.
 * The UI sees them as `{ set: boolean, updated_at?: number }`.
 */
import { z } from "zod";

/**
 * Zod v4 tightened `.default()` so the argument must match the resolved
 * *output* type. Every leaf in this schema has its own `.default(...)`, which
 * means `{}` is a semantically-valid default at runtime â€” Zod walks the
 * children and fills everything in. The compiler can't infer that through the
 * generic plumbing, so we provide a typed sentinel used by every
 * all-defaulted object schema below.
 */
// Sentinel for defaulted objects
const emptyDefault = {};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Branded primitives
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Secret string or redacted metadata object. */
export const secret = () =>
  z.union([
    z.string(),
    z.object({
      set: z.boolean(),
      updated_at: z.number().optional(),
    }),
  ]).brand<"secret">();




/** A URL that must be resolvable (http/https). */
const urlString = () =>
  z
    .string()
    .min(1)
    .url({ message: "must be a valid URL" });

/** A host:port or absolute URL; we're lenient for local Ollama on `127.0.0.1:11434`. */
const endpointString = () => z.string().min(1).max(512);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Providers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ollamaProvider = z.object({
  enabled: z.boolean().default(true),
  base_url: endpointString().default("http://127.0.0.1:11434"),
  default_model: z.string().default("qwen2.5:7b"),
  timeout_s: z.number().int().positive().max(600).default(60),
});

const openRouterProvider = z.object({
  enabled: z.boolean().default(false),
  api_key: secret().nullish(),
  default_model: z.string().default("anthropic/claude-3.5-sonnet"),
  http_referer: urlString().optional(),
});

const anthropicProvider = z.object({
  enabled: z.boolean().default(false),
  api_key: secret().nullish(),
  default_model: z.string().default("claude-sonnet-4-5"),
});

const openAIProvider = z.object({
  enabled: z.boolean().default(false),
  api_key: secret().nullish(),
  base_url: urlString().default("https://api.openai.com/v1"),
  default_model: z.string().default("gpt-4o-mini"),
  organization_id: z.string().optional(),
});

const googleProvider = z.object({
  enabled: z.boolean().default(false),
  // OAuth-driven â€” no api_key field here; tokens live in the accounts table.
  default_model: z.string().default("gemini-2.0-pro"),
});

const lmStudioProvider = z.object({
  enabled: z.boolean().default(false),
  base_url: urlString().default("http://127.0.0.1:1234/v1"),
  default_model: z.string().default("local-model"),
});

const azureProvider = z.object({
  enabled: z.boolean().default(false),
  endpoint: urlString().optional(),
  api_key: secret().nullish(),
  api_version: z.string().default("2024-10-21"),
  deployment: z.string().optional(),
});

export const providersSchema = z.object({
  ollama: ollamaProvider.default(ollamaProvider.parse({})),
  openrouter: openRouterProvider.default(openRouterProvider.parse({})),
  anthropic: anthropicProvider.default(anthropicProvider.parse({})),
  openai: openAIProvider.default(openAIProvider.parse({})),
  google: googleProvider.default(googleProvider.parse({})),
  lmstudio: lmStudioProvider.default(lmStudioProvider.parse({})),
  azure: azureProvider.default(azureProvider.parse({})),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Model routing
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const modelRef = z.string().min(1).max(256); // "provider/model" or "provider:model"

export const routingSchema = z.object({
  roles: z
    .object({
      chat: modelRef.default("ollama:qwen2.5:7b"),
      autocomplete: modelRef.default("ollama:qwen2.5-coder:7b"),
      edit: modelRef.default("anthropic:claude-sonnet-4-5"),
      embed: modelRef.default("ollama:nomic-embed-text"),
      rerank: modelRef.default("ollama:qwen2.5:7b"),
    })
    .default({
      chat: "ollama:qwen2.5:7b",
      autocomplete: "ollama:qwen2.5-coder:7b",
      edit: "anthropic:claude-sonnet-4-5",
      embed: "ollama:nomic-embed-text",
      rerank: "ollama:qwen2.5:7b",
    }),
  complexity: z
    .object({
      low: modelRef.default("ollama:qwen2.5:7b"),
      medium: modelRef.default("ollama:qwen2.5:14b"),
      high: modelRef.default("anthropic:claude-sonnet-4-5"),
    })
    .default({
      low: "ollama:qwen2.5:7b",
      medium: "ollama:qwen2.5:14b",
      high: "anthropic:claude-sonnet-4-5",
    }),
  fallback_chain: z
    .array(modelRef)
    .default(["ollama:qwen2.5:7b", "openrouter:anthropic/claude-3.5-sonnet"]),
  timeout_s: z.number().int().positive().max(600).default(60),
}).default({
  roles: {
    chat: "ollama:qwen2.5:7b",
    autocomplete: "ollama:qwen2.5-coder:7b",
    edit: "anthropic:claude-sonnet-4-5",
    embed: "ollama:nomic-embed-text",
    rerank: "ollama:qwen2.5:7b",
  },
  complexity: {
    low: "ollama:qwen2.5:7b",
    medium: "ollama:qwen2.5:14b",
    high: "anthropic:claude-sonnet-4-5",
  },
  fallback_chain: ["ollama:qwen2.5:7b", "openrouter:anthropic/claude-3.5-sonnet"],
  timeout_s: 60,
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Pipeline (optimization)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const LAYERS = [
  "cli_cleaner",
  "llmlingua",
  "caveman",
  "dedup",
  "summarizer",
  "noise_filter",
  "rag",
  "semantic_cache",
] as const;

export const pipelineSchema = z.object({
  layers: z
    .object(
       Object.fromEntries(LAYERS.map((l) => [l, z.boolean().default(true)])),
    )
    .default(Object.fromEntries(LAYERS.map((l) => [l, true]))),
  cache: z
    .object({
      exact_ttl_s: z.number().int().min(0).max(30 * 86400).default(86400),
      semantic_ttl_s: z.number().int().min(0).max(30 * 86400).default(7 * 86400),
      semantic_threshold: z.number().min(0).max(1).default(0.87),
      max_entries: z.number().int().positive().max(10_000_000).default(100_000),
    })
    .default({
      exact_ttl_s: 86400,
      semantic_ttl_s: 7 * 86400,
      semantic_threshold: 0.87,
      max_entries: 100_000,
    }),
  mab: z
    .object({
      epsilon: z.number().min(0).max(1).default(0.1),
      reward_threshold: z.number().min(0).max(1).default(0.2),
    })
    .default({
      epsilon: 0.1,
      reward_threshold: 0.2,
    }),
  rag: z
    .object({
      sources: z
        .array(
          z.object({
            name: z.string().min(1),
            kind: z.enum(["local_dir", "url", "s3"]),
            path: z.string().min(1),
            enabled: z.boolean().default(true),
          }),
        )
        .default([]),
      chunk_size: z.number().int().min(64).max(8192).default(512),
      top_k: z.number().int().min(1).max(50).default(5),
    })
    .default({
      sources: [],
      chunk_size: 512,
      top_k: 5,
    }),
  compression: z
    .object({
      llmlingua_target_ratio: z.number().min(0.1).max(1).default(0.5),
      caveman_endpoint: z.string().url().optional(),
      dedup_mode: z.enum(["off", "exact", "semantic"]).default("exact"),
    })
    .default({
      llmlingua_target_ratio: 0.5,
      dedup_mode: "exact",
    }),
  budgets: z
    .object({
      max_tokens_per_day: z.number().int().nonnegative().default(0), // 0 = no cap
      max_usd_per_day: z.number().nonnegative().default(0),
      max_tokens_per_mission: z.number().int().nonnegative().default(0),
    })
    .default({
      max_tokens_per_day: 0,
      max_usd_per_day: 0,
      max_tokens_per_mission: 0,
    }),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MCP
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const mcpSchema = z.object({
  servers: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        enabled: z.boolean().default(true),
        transport: z.enum(["stdio", "http", "websocket"]),
        command: z.string().optional(), // stdio
        args: z.array(z.string()).default([]),
        url: urlString().optional(), // http/ws
        env: z.record(z.string(), z.string()).default(emptyDefault),
        tool_allowlist: z.array(z.string()).default([]),
      }),
    )
    .default([]),
}).default({ servers: [] });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Rules & prompts
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const rulesSchema = z.object({
  system_prompt: z.string().default(""),
  modes: z
    .record(
      z.string(),
      z.object({
        label: z.string(),
        prompt: z.string(),
      }),
    )
    .default({
      code: { label: "Code", prompt: "You are a senior engineerâ€¦" },
      architect: { label: "Architect", prompt: "You are a systems architectâ€¦" },
      debug: { label: "Debug", prompt: "You help reproduce and isolate bugsâ€¦" },
      ask: { label: "Ask", prompt: "You answer questions conciselyâ€¦" },
      autonomous: { label: "Autonomous", prompt: "You operate autonomouslyâ€¦" },
    }),
  rules_file: z.string().default(""),
  slash_commands: z
    .array(
      z.object({
        name: z.string().min(1),
        prompt: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([]),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Observability
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const observabilitySchema = z.object({
  log_level: z
    .object({
      gateway: z.enum(["debug", "info", "warn", "error"]).default("info"),
      bridge: z.enum(["DEBUG", "INFO", "WARNING", "ERROR"]).default("INFO"),
      mcp: z.enum(["debug", "info", "warn", "error"]).default("info"),
    })
    .default({
      gateway: "info",
      bridge: "INFO",
      mcp: "info",
    }),
  otel: z
    .object({
      enabled: z.boolean().default(false),
      endpoint: urlString().optional(),
      service_namespace: z.string().default("alloy-ai"),
    })
    .default({
      enabled: false,
      service_namespace: "alloy-ai",
    }),
  metrics: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1).max(65535).default(9090),
    })
    .default({
      enabled: true,
      port: 9090,
    }),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Data
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const dataSchema = z.object({
  data_dir: z.string().default("/data"),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Appearance
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const appearanceSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  language: z.enum(["tr", "en"]).default("tr"),
  accent: z.enum(["blue", "violet", "emerald", "amber"]).default("violet"),
  compact: z.boolean().default(false),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Root schema
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const settingsSchema = z.object({
  providers: providersSchema.default(providersSchema.parse({})),
  routing: routingSchema.default(routingSchema.parse({})),
  pipeline: pipelineSchema.default(pipelineSchema.parse({})),
  mcp: mcpSchema.default({ servers: [] }),
  rules: rulesSchema.default(rulesSchema.parse({})),
  observability: observabilitySchema.default(observabilitySchema.parse({})),
  data: dataSchema.default(dataSchema.parse({})),
  appearance: appearanceSchema.default(appearanceSchema.parse({})),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

/**
 * Known secret-field paths (dotted). Used by the store to decide which fields
 * go into the encrypted `settings_secrets` table.
 *
 * Keep in sync with `secret()` calls above. A test enforces the invariant.
 */
export const SECRET_PATHS = [
  "providers.openrouter.api_key",
  "providers.anthropic.api_key",
  "providers.openai.api_key",
  "providers.azure.api_key",
] as const;

export type SecretPath = (typeof SECRET_PATHS)[number];

/** Default settings â€” convenient for first-boot seeding. */
export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}
