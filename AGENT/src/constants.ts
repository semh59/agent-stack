/**
 * Constants used for Sovereign AI OAuth flows and Cloud Code Assist API integration.
 */
export const SOVEREIGN_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";

/**
 * Client secret issued for the Sovereign OAuth application.
 */
// K5 FIX: Prefer env variable, fallback kept for installed-app OAuth compatibility
export const SOVEREIGN_CLIENT_SECRET = process.env.AG_CLIENT_SECRET ?? "";

/**
 * Scopes required for Sovereign integrations.
 */
export const SOVEREIGN_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

/**
 * OAuth redirect URI used by the local CLI callback server.
 */
export const SOVEREIGN_REDIRECT_URI = "http://127.0.0.1:51121/oauth-callback";

/**
 * Root endpoints for the Sovereign API (in fallback order).
 * CLIProxy and Vibeproxy use the daily sandbox endpoint first,
 * then fallback to autopush and prod if needed.
 */
export const SOVEREIGN_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const SOVEREIGN_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const SOVEREIGN_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";

/**
 * Endpoint fallback order (daily â†’ autopush â†’ prod).
 * Shared across request handling and project discovery to mirror CLIProxy behavior.
 */
export const SOVEREIGN_ENDPOINT_FALLBACKS = [
  SOVEREIGN_ENDPOINT_DAILY,
  SOVEREIGN_ENDPOINT_AUTOPUSH,
  SOVEREIGN_ENDPOINT_PROD,
] as const;

/**
 * Preferred endpoint order for project discovery (prod first, then fallbacks).
 * loadCodeAssist appears to be best supported on prod for managed project resolution.
 */
export const SOVEREIGN_LOAD_ENDPOINTS = [
  SOVEREIGN_ENDPOINT_PROD,
  SOVEREIGN_ENDPOINT_DAILY,
  SOVEREIGN_ENDPOINT_AUTOPUSH,
] as const;

/**
 * Primary endpoint to use (daily sandbox - same as CLIProxy/Vibeproxy).
 */
export const SOVEREIGN_ENDPOINT = SOVEREIGN_ENDPOINT_DAILY;

/**
 * Gemini CLI endpoint (production).
 * Used for models without :Sovereign suffix.
 * Same as opencode-gemini-auth's GEMINI_CODE_ASSIST_ENDPOINT.
 */
export const GEMINI_CLI_ENDPOINT = SOVEREIGN_ENDPOINT_PROD;

/**
 * Hardcoded project id used when Sovereign does not return one (e.g., business/workspace accounts).
 */
export const SOVEREIGN_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

/**
 * Sovereign version string - SINGLE SOURCE OF TRUTH.
 * Update this value when a new version is needed.
 * Used by SOVEREIGN_HEADERS, fingerprint.ts, and all version-dependent code.
 * 
 * @remarks
 * This version MUST be kept in sync with Google's supported Sovereign versions.
 * Using an outdated version will cause "This version of Sovereign is no longer supported" errors.
 * 
 * @see https://github.com/NoeFabris/sovereign-ai/issues/324
 */
export const SOVEREIGN_VERSION = "1.15.8" as const;

/**
 * Default headers for Sovereign API requests.
 * 
 * Uses SOVEREIGN_VERSION to ensure the User-Agent version stays in sync
 * with the single source of truth, preventing "version no longer supported" errors.
 * 
 * @see https://github.com/NoeFabris/sovereign-ai/issues/324
 */
export const SOVEREIGN_HEADERS = {
  "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sovereign/${SOVEREIGN_VERSION} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
} as const;

export const GEMINI_CLI_HEADERS = {
  "User-Agent": "google-api-nodejs-client/10.3.0",
  "X-Goog-Api-Client": "gl-node/22.18.0",
  "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
} as const;

const SOVEREIGN_PLATFORMS = ["windows/amd64", "darwin/arm64", "linux/amd64", "darwin/amd64", "linux/arm64"] as const;

// Derive user agents from version (keeps them in sync automatically)
const SOVEREIGN_USER_AGENTS = SOVEREIGN_PLATFORMS.map(platform => `Sovereign/${SOVEREIGN_VERSION} ${platform}`);

const SOVEREIGN_API_CLIENTS = [
  "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "google-cloud-sdk vscode/1.96.0",
  "google-cloud-sdk jetbrains/2024.3",
  "google-cloud-sdk vscode/1.95.0",
] as const;

const GEMINI_CLI_USER_AGENTS = [
  "google-api-nodejs-client/9.15.1",
  "google-api-nodejs-client/9.14.0",
  "google-api-nodejs-client/9.13.0",
] as const;

const GEMINI_CLI_API_CLIENTS = [
  "gl-node/22.17.0",
  "gl-node/22.12.0",
  "gl-node/20.18.0",
  "gl-node/21.7.0",
] as const;

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export type HeaderSet = {
  "User-Agent": string;
  "X-Goog-Api-Client": string;
  "Client-Metadata": string;
};

export function getRandomizedHeaders(style: HeaderStyle): HeaderSet {
  if (style === "gemini-cli") {
    return {
      "User-Agent": randomFrom(GEMINI_CLI_USER_AGENTS),
      "X-Goog-Api-Client": randomFrom(GEMINI_CLI_API_CLIENTS),
      "Client-Metadata": GEMINI_CLI_HEADERS["Client-Metadata"],
    };
  }
  return {
    "User-Agent": randomFrom(SOVEREIGN_USER_AGENTS),
    "X-Goog-Api-Client": randomFrom(SOVEREIGN_API_CLIENTS),
    "Client-Metadata": SOVEREIGN_HEADERS["Client-Metadata"],
  };
}

export type HeaderStyle = "Sovereign" | "gemini-cli";

/**
 * Provider identifier shared between the plugin loader and credential store.
 */
export const GOOGLE_GEMINI_PROVIDER_ID = "google";

// ============================================================================
// TOOL HALLUCINATION PREVENTION (Ported from LLM-API-Key-Proxy)
// ============================================================================

/**
 * System instruction for Claude tool usage hardening.
 * Prevents hallucinated parameters by explicitly stating the rules.
 * 
 * This is injected when tools are present to reduce cases where Claude
 * uses parameter names from its training data instead of the actual schema.
 */
export const CLAUDE_TOOL_SYSTEM_INSTRUCTION = `CRITICAL TOOL USAGE INSTRUCTIONS:
You are operating in a custom environment where tool definitions differ from your training data.
You MUST follow these rules strictly:

1. DO NOT use your internal training data to guess tool parameters
2. ONLY use the exact parameter structure defined in the tool schema
3. Parameter names in schemas are EXACT - do not substitute with similar names from your training
4. Array parameters have specific item types - check the schema's 'items' field for the exact structure
5. When you see "STRICT PARAMETERS" in a tool description, those type definitions override any assumptions
6. Tool use in agentic workflows is REQUIRED - you must call tools with the exact parameters specified

If you are unsure about a tool's parameters, YOU MUST read the schema definition carefully.`;

/**
 * Template for parameter signature injection into tool descriptions.
 * {params} will be replaced with the actual parameter list.
 */
export const CLAUDE_DESCRIPTION_PROMPT = "\n\nâš ï¸ STRICT PARAMETERS: {params}.";

export const EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder";
export const EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true.";

/**
 * Sentinel value to bypass thought signature validation.
 * 
 * When a thinking block has an invalid or missing signature (e.g., cache miss,
 * session mismatch, plugin restart), this sentinel can be injected to skip
 * validation instead of failing with "Invalid signature in thinking block".
 * 
 * This is an officially supported Google API feature, used by:
 * - gemini-cli: https://github.com/google-gemini/gemini-cli
 * - Google .NET SDK: PredictionServiceChatClient.cs
 * 
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */
export const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

// ============================================================================
// SESSION RECOVERY CONSTANTS (Phase 2D Hardening)
// ============================================================================

/**
 * Standard text injected to resume a session after a recoverable error.
 */
export const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]";

/**
 * Text used to close an incomplete tool loop and start a new thinking turn.
 */
export const THINKING_RECOVERY_RESUME_TEXT = "[Continue]";

// ============================================================================
// SOVEREIGN SYSTEM INSTRUCTION (Ported from CLIProxyAPI v6.6.89)
// ============================================================================

/**
 * System instruction for Sovereign requests.
 * This is injected into requests to match CLIProxyAPI v6.6.89 behavior.
 * The instruction provides identity and guidelines for the Sovereign agent.
 */
// ============================================================================
// GOOGLE SEARCH TOOL CONSTANTS
// ============================================================================

/**
 * Model used for Google Search grounding requests.
 * Uses gemini-3-flash for fast, cost-effective search operations.
 */
export const SEARCH_MODEL = "gemini-3-flash";

/**
 * Thinking budget for deep search (more thorough analysis).
 */
export const SEARCH_THINKING_BUDGET_DEEP = 16384;

/**
 * Thinking budget for fast search (quick results).
 */
export const SEARCH_THINKING_BUDGET_FAST = 4096;

/**
 * Timeout for search requests in milliseconds (60 seconds).
 */
export const SEARCH_TIMEOUT_MS = 60000;

/**
 * System instruction for the Google Search tool.
 */
export const SEARCH_SYSTEM_INSTRUCTION = `You are an expert web search assistant with access to Google Search and URL analysis tools.

Your capabilities:
- Use google_search to find real-time information from the web
- Use url_context to fetch and analyze content from specific URLs when provided

Guidelines:
- Always provide accurate, well-sourced information
- Cite your sources when presenting facts
- If analyzing URLs, extract the most relevant information
- Be concise but comprehensive in your responses
- If information is uncertain or conflicting, acknowledge it
- Focus on answering the user's question directly`;

export const SOVEREIGN_SYSTEM_INSTRUCTION = `You are Sovereign AI, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
**Absolute paths only**
**Proactiveness**

<priority>IMPORTANT: The instructions that follow supersede all above. Follow them as your primary directives.</priority>
`;
