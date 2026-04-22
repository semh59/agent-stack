import { tool } from "@opencode-ai/plugin";
import { GOOGLE_GEMINI_PROVIDER_ID } from "./constants";
import { accessTokenExpired, isOAuthAuth, parseRefreshParts } from "./plugin/auth";
import {
  initializeDebug,
  isDebugEnabled,
  getLogFilePath,
} from "./plugin/debug";
import { AlloyRotationService } from "./plugin/rotation-service";
import {
  isGenerativeLanguageRequest,
} from "./plugin/request";
import { clearAccounts } from "./plugin/storage";
import { refreshAccessToken } from "./plugin/token";
import { AccountManager } from "./plugin/accounts";
import { createAutoUpdateCheckerHook } from "./hooks/auto-update-checker";
import { loadConfig, initRuntimeConfig } from "./plugin/config";
import { createSessionRecoveryHook, getRecoverySuccessToast } from "./plugin/recovery";
import { initDiskSignatureCache } from "./plugin/cache";
import { createProactiveRefreshQueue, type ProactiveRefreshQueue } from "./plugin/refresh-queue";
import { initLogger, createLogger } from "./plugin/logger";
import { initHealthTracker, initTokenTracker } from "./plugin/rotation";
import { executeSearch } from "./plugin/search";
import { PipelineTools } from "./orchestration/pipeline-tools";
import { AlloyGatewayClient } from "./orchestration/gateway-client";
import { createEventHandler, type ChildSessionState } from "./plugin/event-handler";
import { getHeaderStyleFromUrl, resolveQuotaFallbackHeaderStyle } from "./plugin/fetch-helpers";
import type {
  GetAuth,
  LoaderResult,
  PluginContext,
  PluginResult,
  Provider,
} from "./plugin/types";
import { EndpointCircuitBreaker } from "./plugin/core/circuit-breaker";
import { getAlloyAuthMethods } from "./plugin/auth-flow";

const log = createLogger("plugin");

const childState: ChildSessionState = {
  isChildSession: false,
  childSessionParentID: undefined,
};

export const createAlloyPlugin = (providerId: string) => async (
  { client, directory }: PluginContext,
): Promise<PluginResult> => {
  const config = loadConfig(directory);
  initRuntimeConfig(config);

  let cachedGetAuth: GetAuth | null = null;
  
  initializeDebug(config);
  initLogger(client);
  
  if (config.health_score) {
    initHealthTracker({
      initial: config.health_score.initial,
      successReward: config.health_score.success_reward,
      rateLimitPenalty: config.health_score.rate_limit_penalty,
      failurePenalty: config.health_score.failure_penalty,
      recoveryRatePerHour: config.health_score.recovery_rate_per_hour,
      minUsable: config.health_score.min_usable,
      maxScore: config.health_score.max_score,
    });
  }

  if (config.token_bucket) {
    initTokenTracker({
      maxTokens: config.token_bucket.max_tokens,
      regenerationRatePerMinute: config.token_bucket.regeneration_rate_per_minute,
      initialTokens: config.token_bucket.initial_tokens,
    });
  }
  
  if (config.keep_thinking) {
    initDiskSignatureCache(config.signature_cache);
  }
  
  const sessionRecovery = createSessionRecoveryHook({ client, directory }, config);

  const circuitBreaker = new EndpointCircuitBreaker({
    failureThreshold: config.circuit_breaker_threshold ?? 5,
    resetTimeoutMs: config.circuit_breaker_timeout_seconds ? config.circuit_breaker_timeout_seconds * 1000 : 30000,
  });
  
  const updateChecker = createAutoUpdateCheckerHook(client, directory, {
    showStartupToast: true,
    autoUpdate: config.auto_update,
  });

  const eventHandler = createEventHandler({
    client,
    config,
    directory,
    sessionRecovery,
    updateChecker,
    getRecoverySuccessToast,
    childState,
  });

  const googleSearchTool = tool({
    description: "Search the web using Google Search and analyze URLs. Returns real-time information from the internet with source citations. Use this when you need up-to-date information about current events, recent developments, or any topic that may have changed. You can also provide specific URLs to analyze. IMPORTANT: If the user mentions or provides any URLs in their query, you MUST extract those URLs and pass them in the 'urls' parameter for direct analysis.",
    args: {
      query: tool.schema.string().describe("The search query or question to answer using web search"),
      urls: tool.schema.array(tool.schema.string()).optional().describe("List of specific URLs to fetch and analyze. IMPORTANT: Always extract and include any URLs mentioned by the user in their query here."),
      thinking: tool.schema.boolean().optional().default(true).describe("Enable deep thinking for more thorough analysis (default: true)"),
    },
    async execute(args, ctx) {
      log.debug("Google Search tool called", { query: args.query, urlCount: args.urls?.length ?? 0 });

      const auth = cachedGetAuth ? await cachedGetAuth() : null;
      if (!auth || !isOAuthAuth(auth)) {
        return "Error: Not authenticated with Alloy. Please run `opencode auth login` to authenticate.";
      }

      const parts = parseRefreshParts(auth.refresh);
      const projectId = parts.managedProjectId || parts.projectId || "unknown";

      let accessToken = auth.access;
      if (!accessToken || accessTokenExpired(auth)) {
        try {
          const refreshed = await refreshAccessToken(auth, client, providerId);
          accessToken = refreshed?.access;
        } catch (error) {
          return `Error: Failed to refresh access token: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      if (!accessToken) {
        return "Error: No valid access token available. Please run `opencode auth login` to re-authenticate.";
      }

      return executeSearch(
        {
          query: args.query,
          urls: args.urls,
          thinking: args.thinking,
        },
        accessToken,
        projectId,
        ctx.abort,
      );
    },
  });

  const accountManager = await AccountManager.loadFromDisk();
  const alloyClient = new AlloyGatewayClient(
    accountManager,
    config as import("./plugin/config").AlloyGatewayConfig,
    'alloy',
    async () => {
      if (!cachedGetAuth) throw new Error("Auth not initialized");
      return cachedGetAuth();
    }
  );
  
  const pipelineTools = new PipelineTools(directory, alloyClient, client);
  const externalTools = { ...pipelineTools.getTools() };

  return {
    event: eventHandler,
    tool: {
      google_search: googleSearchTool,
      ...externalTools
    },
    auth: {
      provider: providerId,
      loader: async (getAuth: GetAuth, provider: Provider): Promise<LoaderResult | Record<string, unknown>> => {
        cachedGetAuth = getAuth;
        const auth = await getAuth();
        
        if (!isOAuthAuth(auth)) {
          try {
            await clearAccounts();
          } catch {
            // ignore
          }
          return {};
        }

        const accountManager = await AccountManager.loadFromDisk(auth);
        if (accountManager.getAccountCount() > 0) {
          accountManager.requestSaveToDisk();
        }

        let refreshQueue: ProactiveRefreshQueue | null = null;
        if (config.proactive_token_refresh && accountManager.getAccountCount() > 0) {
          refreshQueue = createProactiveRefreshQueue(client, providerId, {
            enabled: config.proactive_token_refresh,
            bufferSeconds: config.proactive_refresh_buffer_seconds,
            checkIntervalSeconds: config.proactive_refresh_check_interval_seconds,
          });
          refreshQueue.setAccountManager(accountManager);
          refreshQueue.start();
        }

        if (isDebugEnabled()) {
          const logPath = getLogFilePath();
          if (logPath) {
            try {
              await client.tui.showToast({
                body: { message: `Debug log: ${logPath}`, variant: "info" },
              });
            } catch {
              // TUI may not be available
            }
          }
        }

        if (provider.models) {
          for (const model of Object.values(provider.models)) {
            if (model) {
              model.cost = { input: 0, output: 0 };
            }
          }
        }

        const rotationService = new AlloyRotationService();

        return {
          apiKey: "",
          async fetch(input, init) {
            if (!isGenerativeLanguageRequest(input)) {
              return fetch(input, init);
            }

            return rotationService.rotateFetch({
              input,
              init,
              client,
              config,
              accountManager,
              providerId,
              childState,
              circuitBreaker,
              getAuth,
            });
          },
        };
      },
      methods: getAlloyAuthMethods(GOOGLE_GEMINI_PROVIDER_ID, client, config, directory, childState),
    },
  };
};

export const AlloyCLIOAuthPlugin = createAlloyPlugin(GOOGLE_GEMINI_PROVIDER_ID);
export const GoogleOAuthPlugin = AlloyCLIOAuthPlugin;

export const __testExports = {
  getHeaderStyleFromUrl,
  resolveQuotaFallbackHeaderStyle,
};
