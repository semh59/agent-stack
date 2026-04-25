import { spawn } from "node:child_process";
import { tool } from "@Alloy-ai/plugin";
import { SOVEREIGN_ENDPOINT_FALLBACKS, SOVEREIGN_ENDPOINT_PROD, GOOGLE_GEMINI_PROVIDER_ID, type HeaderStyle } from "./constants";
import { authorizeGoogleGemini, exchangeGoogleGemini } from "./google-gemini/oauth";
import type { AlloyTokenExchangeResult } from "./google-gemini/oauth";
import { accessTokenExpired, isOAuthAuth, parseRefreshParts } from "./plugin/auth";
import { promptAddAnotherAccount, promptLoginMode, promptProjectId } from "./plugin/cli";
import { ensureProjectContext } from "./plugin/project";
import {
  startAlloyDebugRequest, 
  logAlloyDebugResponse,
  logAccountContext,
  logRateLimitEvent,
  logRateLimitSnapshot,
  logResponseBody,
  logModelFamily,
  isDebugEnabled,
  getLogFilePath,
  initializeDebug,
} from "./plugin/debug";
import {
  buildThinkingWarmupBody,
  isGenerativeLanguageRequest,
  prepareAlloyRequest,
  transformAlloyResponse,
} from "./plugin/request";
import { resolveModelWithTier } from "./plugin/transform/model-resolver";
import {
  isEmptyResponseBody,
  createSyntheticErrorResponse,
} from "./plugin/request-helpers";
import { z } from "zod";
import { EmptyResponseError } from "./plugin/errors";
import { AlloyTokenRefreshError, refreshAccessToken } from "./plugin/token";
import { startOAuthListener, type OAuthListener } from "./plugin/server";
import { clearAccounts, loadAccounts, saveAccounts } from "./plugin/storage";
import { persistAccountPool } from "./plugin/persist-account-pool";
import { AccountManager, type ModelFamily, parseRateLimitReason, calculateBackoffMs, computeSoftQuotaCacheTtlMs } from "./plugin/accounts";
import { createAutoUpdateCheckerHook } from "./hooks/auto-update-checker";
import { loadConfig, initRuntimeConfig, type AlloyGatewayConfig } from "./plugin/config";
import { createSessionRecoveryHook, getRecoverySuccessToast } from "./plugin/recovery";
import { checkAccountsQuota } from "./plugin/quota";
import { initDiskSignatureCache } from "./plugin/cache";
import { createProactiveRefreshQueue, type ProactiveRefreshQueue } from "./plugin/refresh-queue";
import { initLogger, createLogger } from "./plugin/logger";
import { initHealthTracker, getHealthTracker, initTokenTracker, getTokenTracker } from "./plugin/rotation";
import { executeSearch } from "./plugin/search";
import { PipelineTools } from "./orchestration/pipeline-tools";
import { AlloyGatewayClient } from "./orchestration/gateway-client";
import { createEventHandler, type ChildSessionState } from "./plugin/event-handler";
import {
  toUrlString,
  toWarmupStreamUrl,
  extractModelFromUrl,
  getModelFamilyFromUrl,
  getHeaderStyleFromUrl,
  isExplicitQuotaFromUrl,
  resolveQuotaFallbackHeaderStyle,
  getCliFirst,
} from "./plugin/fetch-helpers";
import type {
  GetAuth,
  LoaderResult,
  PluginClient,
  PluginContext,
  PluginResult,
  ProjectContextResult,
  Provider,
} from "./plugin/types";

import { 
  getCapacityBackoffDelay, 
  retryAfterMsFromResponse, 
  parseDurationToMs 
} from "./plugin/core/backoff";
import { 
  isWSL, 
  isWSL2, 
  isRemoteEnvironment, 
  shouldSkipLocalServer, 
  openBrowser 
} from "./plugin/core/system-utils";
import { 
  trackWarmupAttempt, 
  markWarmupSuccess, 
  clearWarmupAttempt, 
  getWarmupAttemptCount 
} from "./plugin/core/warmup-tracker";
import {
  extractRateLimitBodyInfo,
  extractRetryInfoFromBody,
  formatWaitTime,
  getRateLimitBackoff,
  resetRateLimitState,
  resetAllRateLimitStateForAccount,
  headerStyleToQuotaKey,
  trackAccountFailure,
  resetAccountFailureState,
  sleep,
  getEmptyResponseAttempts,
  incrementEmptyResponseAttempts,
  resetEmptyResponseAttempts,
  FIRST_RETRY_DELAY_MS,
  SWITCH_ACCOUNT_DELAY_MS
} from "./plugin/core/rate-limit-state";
import { showToast, resetAllAccountsBlockedToasts, shouldShowRateLimitToast, isSoftQuotaToastShown, setSoftQuotaToastShown, isRateLimitToastShown, setRateLimitToastShown } from "./plugin/core/toast-manager";
import { EndpointCircuitBreaker } from "./plugin/core/circuit-breaker";

const MAX_OAUTH_ACCOUNTS = 10;
const log = createLogger("plugin");

// Shared mutable state for child session tracking (passed to event-handler)
const childState: ChildSessionState = {
  isChildSession: false,
  childSessionParentID: undefined,
};

const quotaRefreshInProgressByEmail = new Set<string>();

async function triggerAsyncQuotaRefreshForAccount(
  accountManager: AccountManager,
  accountIndex: number,
  client: PluginClient,
  providerId: string,
  intervalMinutes: number,
): Promise<void> {
  if (intervalMinutes <= 0) return;
  
  const accounts = accountManager.getAccounts();
  const account = accounts[accountIndex];
  if (!account || account.enabled === false) return;
  
  const accountKey = account.email ?? `idx-${accountIndex}`;
  if (quotaRefreshInProgressByEmail.has(accountKey)) return;
  
  const intervalMs = intervalMinutes * 60 * 1000;
  const age = account.cachedQuotaUpdatedAt != null 
    ? Date.now() - account.cachedQuotaUpdatedAt 
    : Infinity;
  
  if (age < intervalMs) return;
  
  quotaRefreshInProgressByEmail.add(accountKey);
  
  try {
    const accountsForCheck = accountManager.getAccountsForQuotaCheck();
    const singleAccount = accountsForCheck[accountIndex];
    if (!singleAccount) {
      quotaRefreshInProgressByEmail.delete(accountKey);
      return;
    }
    
    const results = await checkAccountsQuota([singleAccount], client, providerId);
    
    if (results[0]?.status === "ok" && results[0]?.quota?.groups) {
      accountManager.updateQuotaCache(accountIndex, results[0].quota.groups);
      accountManager.requestSaveToDisk();
    }
  } catch (err) {
    log.debug(`quota-refresh-failed email=${accountKey}`, { error: String(err) });
  } finally {
    quotaRefreshInProgressByEmail.delete(accountKey);
  }
}



async function promptOAuthCallbackValue(message: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

type OAuthCallbackParams = { code: string; state: string };

function getStateFromAuthorizationUrl(authorizationUrl: string): string {
  try {
    return new URL(authorizationUrl).searchParams.get("state") ?? "";
  } catch {
    return "";
  }
}

function extractOAuthCallbackParams(url: URL): OAuthCallbackParams | null {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return null;
  }
  return { code, state };
}

function parseOAuthCallbackInput(
  value: string,
  fallbackState: string,
): OAuthCallbackParams | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: "Missing authorization code" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? fallbackState;

    if (!code) {
      return { error: "Missing code in callback URL" };
    }
    if (!state) {
      return { error: "Missing state in callback URL" };
    }

    return { code, state };
  } catch {
    if (!fallbackState) {
      return { error: "Missing state. Paste the full redirect URL instead of only the code." };
    }

    return { code: trimmed, state: fallbackState };
  }
}

async function promptManualOAuthInput(
  fallbackState: string,
): Promise<AlloyTokenExchangeResult> {
  console.log("1. Open the URL above in your browser and complete Google sign-in.");
  console.log("2. After approving, copy the full redirected localhost URL from the address bar.");
  console.log("3. Paste it back here.\n");

  const callbackInput = await promptOAuthCallbackValue(
    "Paste the redirect URL (or just the code) here: ",
  );
  const params = parseOAuthCallbackInput(callbackInput, fallbackState);
  if ("error" in params) {
    return { type: "failed", error: params.error };
  }

  return exchangeGoogleGemini(params.code, params.state);
}






/**
 * Creates an Alloy OAuth plugin for a specific provider ID.
 */
export const createAlloyPlugin = (providerId: string) => async (
  { client, directory }: PluginContext,
): Promise<PluginResult> => {
  // Load configuration from files and environment variables
  const config = loadConfig(directory);
  initRuntimeConfig(config);

  // Cached getAuth function for tool access
  let cachedGetAuth: GetAuth | null = null;
  
  // Initialize debug with config
  initializeDebug(config);
  
  // Initialize structured logger for TUI integration
  initLogger(client);
  
  // Initialize health tracker for hybrid strategy
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

  // Initialize token tracker for hybrid strategy
  if (config.token_bucket) {
    initTokenTracker({
      maxTokens: config.token_bucket.max_tokens,
      regenerationRatePerMinute: config.token_bucket.regeneration_rate_per_minute,
      initialTokens: config.token_bucket.initial_tokens,
    });
  }
  
  // Initialize disk signature cache if keep_thinking is enabled
  // This integrates with the in-memory cacheSignature/getCachedSignature functions
  if (config.keep_thinking) {
    initDiskSignatureCache(config.signature_cache);
  }
  
  // Initialize session recovery hook with full context
  const sessionRecovery = createSessionRecoveryHook({ client, directory }, config);

  // Initialize Endpoint Circuit Breaker
  const circuitBreaker = new EndpointCircuitBreaker({
    failureThreshold: config.circuit_breaker_threshold ?? 5,
    resetTimeoutMs: config.circuit_breaker_timeout_seconds ? config.circuit_breaker_timeout_seconds * 1000 : 30000,
  });
  
  const updateChecker = createAutoUpdateCheckerHook(client, directory, {
    showStartupToast: true,
    autoUpdate: config.auto_update,
  });

  // Event handler â€” extracted to plugin/event-handler.ts
  const eventHandler = createEventHandler({
    client,
    config,
    directory,
    sessionRecovery,
    updateChecker,
    getRecoverySuccessToast,
    childState,
  });

  // Create google_search tool with access to auth context
  const googleSearchTool = tool({
    description: "Search the web using Google Search and analyze URLs. Returns real-time information from the internet with source citations. Use this when you need up-to-date information about current events, recent developments, or any topic that may have changed. You can also provide specific URLs to analyze. IMPORTANT: If the user mentions or provides any URLs in their query, you MUST extract those URLs and pass them in the 'urls' parameter for direct analysis.",
    args: {
      query: tool.schema.string().describe("The search query or question to answer using web search"),
      urls: tool.schema.array(tool.schema.string()).optional().describe("List of specific URLs to fetch and analyze. IMPORTANT: Always extract and include any URLs mentioned by the user in their query here."),
      thinking: tool.schema.boolean().optional().default(true).describe("Enable deep thinking for more thorough analysis (default: true)"),
    },
    async execute(args, ctx) {
      log.debug("Google Search tool called", { query: args.query, urlCount: args.urls?.length ?? 0 });

      // Get current auth context
      const auth = cachedGetAuth ? await cachedGetAuth() : null;
      if (!auth || !isOAuthAuth(auth)) {
        return "Error: Not authenticated with Alloy. Please run `Alloy auth login` to authenticate.";
      }

      // Get access token and project ID
      const parts = parseRefreshParts(auth.refresh);
      const projectId = parts.managedProjectId || parts.projectId || "unknown";

      // Ensure we have a valid access token
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
        return "Error: No valid access token available. Please run `Alloy auth login` to re-authenticate.";
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

  // Initialize AlloyGatewayClient for internal tools
  const accountManager = await AccountManager.loadFromDisk();
  const AlloyClient = new AlloyGatewayClient(
    accountManager,
    config as any,
    'Alloy',
    async () => {
      if (!cachedGetAuth) throw new Error("Auth not initialized");
      return cachedGetAuth();
    }
  );
  
  const pipelineTools = new PipelineTools(directory, AlloyClient, client);
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
      // Cache getAuth for tool access
      cachedGetAuth = getAuth;

      const auth = await getAuth();
      
      // If Alloy has no valid OAuth auth, clear any stale account storage
      if (!isOAuthAuth(auth)) {
        try {
          await clearAccounts();
        } catch {
          // ignore
        }
        return {};
      }

      // Validate that stored accounts are in sync with Alloy's auth
      // If Alloy's refresh token doesn't match any stored account, clear stale storage
      const authParts = parseRefreshParts(auth.refresh);
      const storedAccounts = await loadAccounts();
      
      // Note: AccountManager now ensures the current auth is always included in accounts

      const accountManager = await AccountManager.loadFromDisk(auth);
      if (accountManager.getAccountCount() > 0) {
        accountManager.requestSaveToDisk();
      }

      // Initialize proactive token refresh queue (ported from LLM-API-Key-Proxy)
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

      return {
        apiKey: "",
        async fetch(input, init) {
          if (!isGenerativeLanguageRequest(input)) {
            return fetch(input, init);
          }

          const latestAuth = await getAuth();
          if (!isOAuthAuth(latestAuth)) {
            return fetch(input, init);
          }

          if (accountManager.getAccountCount() === 0) {
            throw new Error("No Alloy accounts configured. Run `Alloy auth login`.");
          }

          const urlString = toUrlString(input);
          const family = getModelFamilyFromUrl(urlString);
          const model = extractModelFromUrl(urlString);
          const debugLines: string[] = [];
          const pushDebug = (line: string) => {
            if (!isDebugEnabled()) return;
            debugLines.push(line);
          };
          pushDebug(`request=${urlString}`);

          type FailureContext = {
            response: Response;
            streaming: boolean;
            debugContext: ReturnType<typeof startAlloyDebugRequest>;
            requestedModel?: string;
            projectId?: string;
            endpoint?: string;
            effectiveModel?: string;
            sessionId?: string;
            toolDebugMissing?: number;
            toolDebugSummary?: string;
            toolDebugPayload?: string;
          };

          let lastFailure: FailureContext | null = null;
          let lastError: Error | null = null;
          const abortSignal = init?.signal ?? undefined;

          // Helper to check if request was aborted
          const checkAborted = () => {
            if (abortSignal?.aborted) {
              throw abortSignal.reason instanceof Error ? abortSignal.reason : new Error("Aborted");
            }
          };

          // Use while(true) loop to handle rate limits with backoff
          // This ensures we wait and retry when all accounts are rate-limited
          const quietMode = config.quiet_mode;
          const toastScope = config.toast_scope;

          // Circuit Breaker: Track total retries for this request across all accounts/endpoints
          let totalRetryCount = 0;
          const MAX_TOTAL_RETRIES = 10;

          // Helper to check if request was aborted or circuit broken
          const checkRequestViability = () => {
            checkAborted();
            if (totalRetryCount >= MAX_TOTAL_RETRIES) {
              throw new Error(`Circuit Breaker: Request failed after ${totalRetryCount} retries. Please try again later.`);
            }
          };

          // Bounded by MAX_TOTAL_RETRIES via checkRequestViability() which
          // throws once the circuit-breaker trips. The explicit cap here
          // keeps the loop header finite for ESLint and documents intent.
          while (totalRetryCount <= MAX_TOTAL_RETRIES) {
            // Check for viability at the start of each iteration
            checkRequestViability();
            
            const accountCount = accountManager.getAccountCount();
            
            if (accountCount === 0) {
              throw new Error("No Alloy accounts available. Run `Alloy auth login`.");
            }

            const softQuotaCacheTtlMs = computeSoftQuotaCacheTtlMs(
              config.soft_quota_cache_ttl_minutes,
              config.quota_refresh_interval_minutes,
            );

            const account = accountManager.getCurrentOrNextForFamily(
              family, 
              model, 
              config.account_selection_strategy,
              'Alloy',
              config.pid_offset_enabled,
              config.soft_quota_threshold_percent,
              softQuotaCacheTtlMs,
            );
            
            if (!account) {
              if (accountManager.areAllAccountsOverSoftQuota(family, config.soft_quota_threshold_percent, softQuotaCacheTtlMs, model)) {
                const threshold = config.soft_quota_threshold_percent;
                const softQuotaWaitMs = accountManager.getMinWaitTimeForSoftQuota(family, threshold, softQuotaCacheTtlMs, model);
                const maxWaitMs = (config.max_rate_limit_wait_seconds ?? 300) * 1000;
                
                if (softQuotaWaitMs === null || (maxWaitMs > 0 && softQuotaWaitMs > maxWaitMs)) {
                  const waitTimeFormatted = softQuotaWaitMs ? formatWaitTime(softQuotaWaitMs) : "unknown";
                  await showToast(client, config, `All accounts over ${threshold}% quota threshold. Resets in ${waitTimeFormatted}.`, "error", childState.isChildSession, childState.childSessionParentID);
                  throw new Error(
                    `Quota protection: All ${accountCount} account(s) are over ${threshold}% usage for ${family}. ` +
                    `Quota resets in ${waitTimeFormatted}. ` +
                    `Add more accounts, wait for quota reset, or set soft_quota_threshold_percent: 100 to disable.`
                  );
                }
                
                const waitSecValue = Math.max(1, Math.ceil(softQuotaWaitMs / 1000));
                pushDebug(`all-over-soft-quota family=${family} accounts=${accountCount} waitMs=${softQuotaWaitMs}`);
                
                if (!isSoftQuotaToastShown()) {
                  await showToast(client, config, `All ${accountCount} account(s) over ${threshold}% quota. Waiting ${formatWaitTime(softQuotaWaitMs)}...`, "warning", childState.isChildSession, childState.childSessionParentID);
                  setSoftQuotaToastShown(true);
                }
                
                await sleep(softQuotaWaitMs, abortSignal);
                continue;
              }

              const headerStyle = getHeaderStyleFromUrl(urlString, family);
              const explicitQuota = isExplicitQuotaFromUrl(urlString);
              // All accounts are rate-limited - wait and retry
              const waitMs = accountManager.getMinWaitTimeForFamily(
                family,
                model,
                headerStyle,
                explicitQuota,
              ) || 60_000;
              const waitSecValue = Math.max(1, Math.ceil(waitMs / 1000));

              pushDebug(`all-rate-limited family=${family} accounts=${accountCount} waitMs=${waitMs}`);
              if (isDebugEnabled()) {
                logAccountContext("All accounts rate-limited", {
                  index: -1,
                  family,
                  totalAccounts: accountCount,
                });
                logRateLimitSnapshot(family, accountManager.getAccountsSnapshot());
              }

              // If wait time exceeds max threshold, return error immediately instead of hanging
              // 0 means disabled (wait indefinitely)
              const maxWaitMs = (config.max_rate_limit_wait_seconds ?? 300) * 1000;
              if (maxWaitMs > 0 && waitMs > maxWaitMs) {
                const waitTimeFormatted = formatWaitTime(waitMs);
                await showToast(
                  client,
                  config,
                  `Rate limited for ${waitTimeFormatted}. Try again later or add another account.`,
                  "error",
                  childState.isChildSession,
                  childState.childSessionParentID
                );
                
                // Return a proper rate limit error response
                throw new Error(
                  `All ${accountCount} account(s) rate-limited for ${family}. ` +
                  `Quota resets in ${waitTimeFormatted}. ` +
                  `Add more accounts with \`Alloy auth login\` or wait and retry.`
                );
              }

              if (!isRateLimitToastShown()) {
                await showToast(client, config, `All ${accountCount} account(s) rate-limited for ${family}. Waiting ${waitSecValue}s...`, "warning", childState.isChildSession, childState.childSessionParentID);
                setRateLimitToastShown(true);
              }

              // Wait for the rate-limit cooldown to expire, then retry
              await sleep(waitMs, abortSignal);
              continue;
            }

            // Account is available - reset the toast flag
            resetAllAccountsBlockedToasts();

            pushDebug(
              `selected idx=${account.index} email=${account.email ?? ""} family=${family} accounts=${accountCount} strategy=${config.account_selection_strategy}`,
            );
            if (isDebugEnabled()) {
              logAccountContext("Selected", {
                index: account.index,
                email: account.email,
                family,
                totalAccounts: accountCount,
                rateLimitState: account.rateLimitResetTimes,
              });
            }

            // Show toast when switching to a different account (debounced, quiet_mode handled by showToast)
            if (accountCount > 1 && accountManager.shouldShowAccountToast(account.index)) {
              const accountLabel = account.email || `Account ${account.index + 1}`;
              // Calculate position among enabled accounts (not absolute index)
              const enabledAccounts = accountManager.getEnabledAccounts();
              const enabledPosition = enabledAccounts.findIndex(a => a.index === account.index) + 1;
              await showToast(client, config, `Using ${accountLabel} (${enabledPosition}/${accountCount})`, "info", childState.isChildSession, childState.childSessionParentID);
              accountManager.markToastShown(account.index);
            }

            accountManager.requestSaveToDisk();

            let authRecord = accountManager.toAuthDetails(account);

            if (accessTokenExpired(authRecord)) {
              try {
                const refreshed = await refreshAccessToken(authRecord, client, providerId);
                if (!refreshed) {
                  const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index);
                  getHealthTracker().recordFailure(account.index);
                  lastError = new Error("Alloy token refresh failed");
                  if (shouldCooldown) {
                    accountManager.markAccountCoolingDown(account, cooldownMs, "auth-failure");
                    accountManager.markRateLimited(account, cooldownMs, family, "Alloy", model);
                    pushDebug(`token-refresh-failed: cooldown ${cooldownMs}ms after ${failures} failures`);
                  }
                  continue;
                }
                resetAccountFailureState(account.index);
                accountManager.updateFromAuth(account, refreshed);
                authRecord = refreshed;
                try {
                  await accountManager.saveToDisk();
                } catch (error) {
                  log.error("Failed to persist refreshed auth", { error: String(error) });
                }
              } catch (error) {
                if (error instanceof AlloyTokenRefreshError && error.code === "invalid_grant") {
                  const removed = accountManager.removeAccount(account);
                  if (removed) {
                    log.warn("Removed revoked account from pool - reauthenticate via `Alloy auth login`");
                    try {
                      await accountManager.saveToDisk();
                    } catch (persistError) {
                      log.error("Failed to persist revoked account removal", { error: String(persistError) });
                    }
                  }

                  if (accountManager.getAccountCount() === 0) {
                    try {
                      await client.auth.set({
                        path: { id: providerId },
                        body: { type: "oauth", refresh: "", access: "", expires: 0 },
                      });
                    } catch (storeError) {
                      log.error("Failed to clear stored Alloy OAuth credentials", { error: String(storeError) });
                    }

                    throw new Error(
                      "All Alloy accounts have invalid refresh tokens. Run `Alloy auth login` and reauthenticate.",
                    );
                  }

                  lastError = error;
                  continue;
                }

                const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index);
                getHealthTracker().recordFailure(account.index);
                lastError = error instanceof Error ? error : new Error(String(error));
                if (shouldCooldown) {
                  accountManager.markAccountCoolingDown(account, cooldownMs, "auth-failure");
                  accountManager.markRateLimited(account, cooldownMs, family, "Alloy", model);
                  pushDebug(`token-refresh-error: cooldown ${cooldownMs}ms after ${failures} failures`);
                }
                continue;
              }
            }

            const accessToken = authRecord.access;
            if (!accessToken) {
              lastError = new Error("Missing access token");
              if (accountCount <= 1) {
                throw lastError;
              }
              continue;
            }

            let projectContext: ProjectContextResult;
            try {
              projectContext = await ensureProjectContext(authRecord);
              resetAccountFailureState(account.index);
            } catch (error) {
              const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index);
              getHealthTracker().recordFailure(account.index);
              lastError = error instanceof Error ? error : new Error(String(error));
              if (shouldCooldown) {
                accountManager.markAccountCoolingDown(account, cooldownMs, "project-error");
                accountManager.markRateLimited(account, cooldownMs, family, "Alloy", model);
                pushDebug(`project-context-error: cooldown ${cooldownMs}ms after ${failures} failures`);
              }
              continue;
            }

            if (projectContext.auth !== authRecord) {
              accountManager.updateFromAuth(account, projectContext.auth);
              authRecord = projectContext.auth;
              try {
                await accountManager.saveToDisk();
              } catch (error) {
                log.error("Failed to persist project context", { error: String(error) });
              }
            }

            const runThinkingWarmup = async (
              prepared: ReturnType<typeof prepareAlloyRequest>,
              projectId: string,
            ): Promise<void> => {
              if (!prepared.needsSignedThinkingWarmup || !prepared.sessionId) {
                return;
              }

              if (!trackWarmupAttempt(prepared.sessionId)) {
                return;
              }

              const warmupBody = buildThinkingWarmupBody(
                typeof prepared.init.body === "string" ? prepared.init.body : undefined,
                Boolean(prepared.effectiveModel?.toLowerCase().includes("claude") && prepared.effectiveModel?.toLowerCase().includes("thinking")),
              );
              if (!warmupBody) {
                return;
              }

              const warmupUrl = toWarmupStreamUrl(prepared.request);
              const warmupHeaders = new Headers(prepared.init.headers ?? {});
              warmupHeaders.set("accept", "text/event-stream");

              const warmupInit: RequestInit = {
                ...prepared.init,
                method: prepared.init.method ?? "POST",
                headers: warmupHeaders,
                body: warmupBody,
              };

              const warmupDebugContext = startAlloyDebugRequest({
                originalUrl: warmupUrl,
                resolvedUrl: warmupUrl,
                method: warmupInit.method,
                headers: warmupHeaders,
                body: warmupBody,
                streaming: true,
                projectId,
              });

              try {
                pushDebug("thinking-warmup: start");
                const warmupResponse = await fetch(warmupUrl, warmupInit);
                const transformed = await transformAlloyResponse(
                  warmupResponse,
                  true,
                  warmupDebugContext,
                  prepared.requestedModel,
                  projectId,
                  warmupUrl,
                  prepared.effectiveModel,
                  prepared.sessionId,
                );
                await transformed.text();
                markWarmupSuccess(prepared.sessionId);
                pushDebug("thinking-warmup: done");
              } catch (error) {
                clearWarmupAttempt(prepared.sessionId);
                pushDebug(
                  `thinking-warmup: failed ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            };

            // Try endpoint fallbacks with single header style based on model suffix
            let shouldSwitchAccount = false;
            
            // Determine header style from model suffix:
            // - Gemini models default to Alloy
            // - Claude models always use Alloy
            let headerStyle = getHeaderStyleFromUrl(urlString, family);
            const explicitQuota = isExplicitQuotaFromUrl(urlString);
            const cliFirst = getCliFirst(config);
            pushDebug(`headerStyle=${headerStyle} explicit=${explicitQuota}`);
            if (account.fingerprint) {
              pushDebug(`fingerprint: quotaUser=${account.fingerprint.quotaUser} deviceId=${account.fingerprint.deviceId.slice(0, 8)}...`);
            }
            
            // Check if this header style is rate-limited for this account
            if (accountManager.isRateLimitedForHeaderStyle(account, family, headerStyle, model)) {
              // Alloy-first fallback: exhaust Alloy across ALL accounts before gemini-cli
              if (config.quota_fallback && !explicitQuota && family === "gemini" && headerStyle === "Alloy" && !cliFirst) {
                // Check if ANY other account has Alloy available
                if (accountManager.hasOtherAccountWithAlloyAvailable(account.index, family, model)) {
                  // Switch to another account with Alloy (preserve Alloy priority)
                  pushDebug(`Alloy rate-limited on account ${account.index}, but available on other accounts. Switching.`);
                  shouldSwitchAccount = true;
                } else {
                  // All accounts exhausted Alloy - fall back to gemini-cli on this account
                  const alternateStyle = accountManager.getAvailableHeaderStyle(account, family, model);
                  const fallbackStyle = resolveQuotaFallbackHeaderStyle({
                    quotaFallback: config.quota_fallback,
                    cliFirst,
                    explicitQuota,
                    family,
                    headerStyle,
                    alternateStyle,
                  });
                  if (fallbackStyle) {
                    await showToast(client, config, `Alloy quota exhausted on all accounts. Using Gemini CLI quota.`, "warning", childState.isChildSession, childState.childSessionParentID);
                    headerStyle = fallbackStyle;
                    pushDebug(`all-accounts Alloy exhausted, quota fallback: ${headerStyle}`);
                  } else {
                    shouldSwitchAccount = true;
                  }
                }
              } else if (config.quota_fallback && !explicitQuota && family === "gemini") {
                // gemini-cli rate-limited - try alternate style (Alloy) on same account
                const alternateStyle = accountManager.getAvailableHeaderStyle(account, family, model);
                const fallbackStyle = resolveQuotaFallbackHeaderStyle({
                  quotaFallback: config.quota_fallback,
                  cliFirst,
                  explicitQuota,
                  family,
                  headerStyle,
                  alternateStyle,
                });
                if (fallbackStyle) {
                  const quotaName = headerStyle === "gemini-cli" ? "Gemini CLI" : "Alloy";
                  const altQuotaName = fallbackStyle === "gemini-cli" ? "Gemini CLI" : "Alloy";
                  await showToast(client, config, `${quotaName} quota exhausted, using ${altQuotaName} quota`, "warning", childState.isChildSession, childState.childSessionParentID);
                  headerStyle = fallbackStyle;
                  pushDebug(`quota fallback: ${headerStyle}`);
                } else {
                  shouldSwitchAccount = true;
                }
              } else {
                shouldSwitchAccount = true;
              }
            }
            
            while (!shouldSwitchAccount) {
            
            // Flag to force thinking recovery on retry after API error
            let forceThinkingRecovery = false;
            
            // Track if token was consumed (for hybrid strategy refund on error)
            let tokenConsumed = false;
            
            // Track capacity retries per endpoint to prevent infinite loops
            let capacityRetryCount = 0;
            let lastEndpointIndex = -1;
            
            for (let i = 0; i < SOVEREIGN_ENDPOINT_FALLBACKS.length; i++) {
              const currentEndpoint = SOVEREIGN_ENDPOINT_FALLBACKS[i];
              if (!currentEndpoint) continue;

              // Circuit Breaker Check
              if (!circuitBreaker.isUsable(currentEndpoint)) {
                const waitMs = circuitBreaker.getRemainingWaitMs(currentEndpoint);
                pushDebug(`Circuit Breaker: Skipping endpoint ${currentEndpoint} (tripped, ${Math.round(waitMs / 1000)}s left)`);
                continue;
              }

              // Reset capacity retry counter when switching to a new endpoint

              // Skip sandbox endpoints for Gemini CLI models - they only work with Alloy quota
              // Gemini CLI models must use production endpoint (cloudcode-pa.googleapis.com)
              if (headerStyle === "gemini-cli" && currentEndpoint !== SOVEREIGN_ENDPOINT_PROD) {
                pushDebug(`Skipping sandbox endpoint ${currentEndpoint} for gemini-cli headerStyle`);
                continue;
              }

              try {
                const prepared = prepareAlloyRequest(
                  input,
                  init,
                  accessToken,
                  projectContext.effectiveProjectId,
                  currentEndpoint,
                  headerStyle,
                  forceThinkingRecovery,
                  {
                    claudeToolHardening: config.claude_tool_hardening,
                    fingerprint: account.fingerprint,
                  },
                );

                const originalUrl = toUrlString(input);
                const resolvedUrl = toUrlString(prepared.request);
                pushDebug(`endpoint=${currentEndpoint}`);
                pushDebug(`resolved=${resolvedUrl}`);
                const debugContext = startAlloyDebugRequest({
                  originalUrl,
                  resolvedUrl,
                  method: prepared.init.method,
                  headers: prepared.init.headers,
                  body: prepared.init.body,
                  streaming: prepared.streaming,
                  projectId: projectContext.effectiveProjectId,
                });

                await runThinkingWarmup(prepared, projectContext.effectiveProjectId);

                if (config.request_jitter_max_ms > 0) {
                  const jitterMs = Math.floor(Math.random() * config.request_jitter_max_ms);
                  if (jitterMs > 0) {
                    await sleep(jitterMs, abortSignal);
                  }
                }

                // Consume token for hybrid strategy
                // Refunded later if request fails (429 or network error)
                if (config.account_selection_strategy === 'hybrid') {
                  tokenConsumed = getTokenTracker().consume(account.index);
                }

                const response = await fetch(prepared.request, prepared.init);
                pushDebug(`status=${response.status} ${response.statusText}`);




                // Handle 429 rate limit (or Service Overloaded) with improved logic
                if (response.status === 429 || response.status === 503 || response.status === 529) {
                  // Refund token on rate limit
                  if (tokenConsumed) {
                    getTokenTracker().refund(account.index);
                    tokenConsumed = false;
                  }

                  const defaultRetryMs = (config.default_retry_after_seconds ?? 60) * 1000;
                  const maxBackoffMs = (config.max_backoff_seconds ?? 60) * 1000;
                  const headerRetryMs = retryAfterMsFromResponse(response, defaultRetryMs);
                  const bodyInfo = await extractRetryInfoFromBody(response);
                  const serverRetryMs = bodyInfo.retryDelayMs ?? headerRetryMs;

                  // [Enhanced Parsing] Pass status to handling logic
                  const rateLimitReason = parseRateLimitReason(bodyInfo.reason, bodyInfo.message, response.status);

                  // STRATEGY 1: CAPACITY / SERVER ERROR (Transient)
                  // Goal: Wait and Retry SAME Account. DO NOT LOCK.
                  // We handle this FIRST to avoid calling getRateLimitBackoff() and polluting the global rate limit state for transient errors.
                  if (rateLimitReason === "MODEL_CAPACITY_EXHAUSTED" || rateLimitReason === "SERVER_ERROR") {
                     // Exponential backoff with jitter for capacity errors: 1s â†’ 2s â†’ 4s â†’ 8s (max)
                     // Matches Alloy-Manager's ExponentialBackoff(1s, 8s)
                     const baseDelayMs = 1000;
                     const maxDelayMs = 8000;
                     const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, capacityRetryCount), maxDelayMs);
                     // Add Â±10% jitter to prevent thundering herd
                     const jitter = exponentialDelay * (0.9 + Math.random() * 0.2);
                     const waitMs = Math.round(jitter);
                     const waitSec = Math.round(waitMs / 1000);
                     
                     pushDebug(`Server busy (${rateLimitReason}) on account ${account.index}, exponential backoff ${waitMs}ms (attempt ${capacityRetryCount + 1})`);

                     await showToast(
                       client,
                       config,
                       `â³ Server busy (${response.status}). Retrying in ${waitSec}s...`,
                       "warning",
                       childState.isChildSession,
                       childState.childSessionParentID
                     );
                     
                     await sleep(waitMs, abortSignal);
                     
                     // CRITICAL FIX: Decrement i so that the loop 'continue' retries the SAME endpoint index
                     // (i++ in the loop will bring it back to the current index)
                     // But limit retries to prevent infinite loops (Greptile feedback)
                     if (capacityRetryCount < 3) {
                       capacityRetryCount++;
                       i -= 1;
                       continue; 
                      } else {
                        pushDebug(`Max capacity retries (3) exhausted for endpoint ${currentEndpoint}, regenerating fingerprint...`);
                        // Regenerate fingerprint to get fresh device identity before trying next endpoint
                        const newFingerprint = accountManager.regenerateAccountFingerprint(account.index);
                        if (newFingerprint) {
                          pushDebug(`Fingerprint regenerated for account ${account.index}`);
                        }
                        continue;
                      }
                  }

                  // STRATEGY 2: RATE LIMIT EXCEEDED (RPM) / QUOTA EXHAUSTED / UNKNOWN
                  // Goal: Lock and Rotate (Standard Logic)
                  
                  // Only now do we call getRateLimitBackoff, which increments the global failure tracker
                  const quotaKey = headerStyleToQuotaKey(headerStyle, family);
                  const { attempt, delayMs, isDuplicate } = getRateLimitBackoff(account.index, quotaKey, serverRetryMs);
                  
                  // Calculate potential backoffs
                  const smartBackoffMs = calculateBackoffMs(rateLimitReason, account.consecutiveFailures ?? 0, serverRetryMs);
                  const effectiveDelayMs = Math.max(delayMs, smartBackoffMs);

                  pushDebug(
                    `429 idx=${account.index} email=${account.email ?? ""} family=${family} delayMs=${effectiveDelayMs} attempt=${attempt} reason=${rateLimitReason}`,
                  );
                  if (bodyInfo.message) {
                    pushDebug(`429 message=${bodyInfo.message}`);
                  }
                  if (bodyInfo.quotaResetTime) {
                    pushDebug(`429 quotaResetTime=${bodyInfo.quotaResetTime}`);
                  }
                  if (bodyInfo.reason) {
                    pushDebug(`429 reason=${bodyInfo.reason}`);
                  }

                   logRateLimitEvent(
                    account.index,
                    account.email,
                    family,
                    response.status,
                    effectiveDelayMs,
                    bodyInfo,
                  );

                  await logResponseBody(debugContext, response, 429);

                  getHealthTracker().recordRateLimit(account.index);

                  const accountLabel = account.email || `Account ${account.index + 1}`;

                  // Progressive retry for standard 429s: 1st 429 â†’ 1s then switch (if enabled) or retry same
                  if (attempt === 1 && rateLimitReason !== "QUOTA_EXHAUSTED") {
                    await showToast(client, config, `Rate limited. Quick retry in 1s...`, "warning", childState.isChildSession, childState.childSessionParentID);
                    await sleep(FIRST_RETRY_DELAY_MS, abortSignal);
                    
                    // CacheFirst mode: wait for same account if within threshold (preserves prompt cache)
                    if (config.scheduling_mode === 'cache_first') {
                      const maxCacheFirstWaitMs = config.max_cache_first_wait_seconds * 1000;
                      // effectiveDelayMs is the backoff calculated for this account
                      if (effectiveDelayMs <= maxCacheFirstWaitMs) {
                        pushDebug(`cache_first: waiting ${effectiveDelayMs}ms for same account to recover`);
                        await showToast(client, config, `â³ Waiting ${Math.ceil(effectiveDelayMs / 1000)}s for same account (prompt cache preserved)...`, "info", childState.isChildSession, childState.childSessionParentID);
                        accountManager.markRateLimitedWithReason(account, family, headerStyle, model, rateLimitReason, serverRetryMs, currentEndpoint);
                        await sleep(effectiveDelayMs, abortSignal);
                        // Retry same endpoint after wait
                        i -= 1;
                        continue;
                      }
                      // Wait time exceeds threshold, fall through to switch
                      pushDebug(`cache_first: wait ${effectiveDelayMs}ms exceeds max ${maxCacheFirstWaitMs}ms, switching account`);
                    }
                    
                    if (config.switch_on_first_rate_limit && accountCount > 1) {
                      accountManager.markRateLimitedWithReason(account, family, headerStyle, model, rateLimitReason, serverRetryMs, currentEndpoint, config.failure_ttl_seconds * 1000);
                      shouldSwitchAccount = true;
                      break;
                    }
                    
                    // Same endpoint retry for first RPM hit
                    i -= 1; 
                    continue;
                  }

                  accountManager.markRateLimitedWithReason(account, family, headerStyle, model, rateLimitReason, serverRetryMs, currentEndpoint, config.failure_ttl_seconds * 1000);

                  accountManager.requestSaveToDisk();

                  // For Gemini, preserve preferred quota across accounts before fallback
                  if (family === "gemini") {
                    if (headerStyle === "Alloy" && !cliFirst) {
                      // Check if any other account has Alloy quota for this model
                      if (accountManager.hasOtherAccountWithAlloyAvailable(account.index, family, model)) {
                        pushDebug(`Alloy exhausted on account ${account.index}, but available on others. Switching account.`);
                        await showToast(client, config, `Rate limited again. Switching account in 5s...`, "warning", childState.isChildSession, childState.childSessionParentID);
                        await sleep(SWITCH_ACCOUNT_DELAY_MS, abortSignal);
                        shouldSwitchAccount = true;
                        break;
                      }

                      // All accounts exhausted for Alloy on THIS model.
                      // Before falling back to gemini-cli, check if it's the last option (automatic fallback)
                      if (config.quota_fallback && !explicitQuota) {
                        const alternateStyle = accountManager.getAvailableHeaderStyle(account, family, model);
                        const fallbackStyle = resolveQuotaFallbackHeaderStyle({
                          quotaFallback: config.quota_fallback,
                          cliFirst,
                          explicitQuota,
                          family,
                          headerStyle,
                          alternateStyle,
                        });
                        if (fallbackStyle) {
                          const safeModelName = model || "this model";
                          await showToast(
                            client,
                            config,
                            `Alloy quota exhausted for ${safeModelName}. Switching to Gemini CLI quota...`,
                            "warning",
                            childState.isChildSession,
                            childState.childSessionParentID
                          );
                          headerStyle = fallbackStyle;
                          pushDebug(`quota fallback: ${headerStyle}`);
                          continue;
                        }
                      }
                    } else if (headerStyle === "gemini-cli" && cliFirst) {
                      if (config.quota_fallback && !explicitQuota) {
                        const alternateStyle = accountManager.getAvailableHeaderStyle(account, family, model);
                        const fallbackStyle = resolveQuotaFallbackHeaderStyle({
                          quotaFallback: config.quota_fallback,
                          cliFirst,
                          explicitQuota,
                          family,
                          headerStyle,
                          alternateStyle,
                        });
                        if (fallbackStyle) {
                          const safeModelName = model || "this model";
                          await showToast(
                            client,
                            config,
                            `Gemini CLI quota exhausted for ${safeModelName}. Switching to Alloy quota...`,
                            "warning",
                            childState.isChildSession,
                            childState.childSessionParentID
                          );
                          headerStyle = fallbackStyle;
                          pushDebug(`quota fallback: ${headerStyle}`);
                          continue;
                        }
                      }
                    }
                  }

                  const quotaName = headerStyle === "Alloy" ? "Alloy" : "Gemini CLI";

                  if (accountCount > 1) {
                    const quotaMsg = bodyInfo.quotaResetTime 
                      ? ` (quota resets ${bodyInfo.quotaResetTime})`
                      : ``;
                    await showToast(client, config, `Rate limited again. Switching account in 5s...${quotaMsg}`, "warning", childState.isChildSession, childState.childSessionParentID);
                    await sleep(SWITCH_ACCOUNT_DELAY_MS, abortSignal);
                    
                    lastFailure = {
                      response,
                      streaming: prepared.streaming,
                      debugContext,
                      requestedModel: prepared.requestedModel,
                      projectId: prepared.projectId,
                      endpoint: prepared.endpoint,
                      effectiveModel: prepared.effectiveModel,
                      sessionId: prepared.sessionId,
                      toolDebugMissing: prepared.toolDebugMissing,
                      toolDebugSummary: prepared.toolDebugSummary,
                      toolDebugPayload: prepared.toolDebugPayload,
                    };
                    shouldSwitchAccount = true;
                    break;
                  } else {
                    // Single account: exponential backoff (1s, 2s, 4s, 8s... max 60s)
                    const expBackoffMs = Math.min(FIRST_RETRY_DELAY_MS * Math.pow(2, attempt - 1), 60000);
                    const expBackoffFormatted = expBackoffMs >= 1000 ? `${Math.round(expBackoffMs / 1000)}s` : `${expBackoffMs}ms`;
                    await showToast(client, config, `Rate limited. Retrying in ${expBackoffFormatted} (attempt ${attempt})...`, "warning", childState.isChildSession, childState.childSessionParentID);
                    
                    lastFailure = {
                      response,
                      streaming: prepared.streaming,
                      debugContext,
                      requestedModel: prepared.requestedModel,
                      projectId: prepared.projectId,
                      endpoint: prepared.endpoint,
                      effectiveModel: prepared.effectiveModel,
                      sessionId: prepared.sessionId,
                      toolDebugMissing: prepared.toolDebugMissing,
                      toolDebugSummary: prepared.toolDebugSummary,
                      toolDebugPayload: prepared.toolDebugPayload,
                    };
                    
                    await sleep(expBackoffMs, abortSignal);
                    shouldSwitchAccount = true;
                    break;
                  }
                }

                // Success - reset rate limit backoff state for this quota
                const quotaKey = headerStyleToQuotaKey(headerStyle, family);
                resetRateLimitState(account.index, quotaKey);
                resetAccountFailureState(account.index);

                const shouldRetryEndpoint = (
                  response.status === 403 ||
                  response.status === 404 ||
                  response.status >= 500
                );

                if (shouldRetryEndpoint) {
                  await logResponseBody(debugContext, response, response.status);
                }

                if (shouldRetryEndpoint && i < SOVEREIGN_ENDPOINT_FALLBACKS.length - 1) {
                  if (currentEndpoint) circuitBreaker.recordFailure(currentEndpoint);
                  lastFailure = {
                    response,
                    streaming: prepared.streaming,
                    debugContext,
                    requestedModel: prepared.requestedModel,
                    projectId: prepared.projectId,
                    endpoint: prepared.endpoint,
                    effectiveModel: prepared.effectiveModel,
                    sessionId: prepared.sessionId,
                    toolDebugMissing: prepared.toolDebugMissing,
                    toolDebugSummary: prepared.toolDebugSummary,
                    toolDebugPayload: prepared.toolDebugPayload,
                  };
                  continue;
                }

                // Success!
                if (currentEndpoint) circuitBreaker.recordSuccess(currentEndpoint);

                // Success or non-retryable error - return the response
                if (response.ok) {
                  account.consecutiveFailures = 0;
                  getHealthTracker().recordSuccess(account.index);
                  accountManager.markAccountUsed(account.index);
                  
                  void triggerAsyncQuotaRefreshForAccount(
                    accountManager,
                    account.index,
                    client,
                    providerId,
                    config.quota_refresh_interval_minutes,
                  );
                }
                logAlloyDebugResponse(debugContext, response, {
                  note: response.ok ? "Success" : `Error ${response.status}`,
                });
                if (!response.ok) {
                  await logResponseBody(debugContext, response, response.status);
                  
                  // Handle 400 "Prompt too long" with synthetic response to avoid session lock
                  if (response.status === 400) {
                    const cloned = response.clone();
                    const bodyText = await cloned.text();
                    if (bodyText.includes("Prompt is too long") || bodyText.includes("prompt_too_long")) {
                      await showToast(
                        client,
                        config,
                        "Context too long - use /compact to reduce size",
                        "warning",
                        childState.isChildSession,
                        childState.childSessionParentID
                      );
                      const errorMessage = `[Alloy Error] Context is too long for this model.\n\nPlease use /compact to reduce context size, then retry your request.\n\nAlternatively, you can:\n- Use /clear to start fresh\n- Use /undo to remove recent messages\n- Switch to a model with larger context window`;
                      return createSyntheticErrorResponse(errorMessage, prepared.requestedModel);
                    }
                  }
                }
                
                // Empty response retry logic (ported from LLM-API-Key-Proxy)
                // For non-streaming responses, check if the response body is empty
                // and retry if so (up to config.empty_response_max_attempts times)
                if (response.ok && !prepared.streaming) {
                  const maxAttempts = config.empty_response_max_attempts ?? 4;
                  const retryDelayMs = config.empty_response_retry_delay_ms ?? 2000;
                  
                  // Clone to check body without consuming original
                  const clonedForCheck = response.clone();
                  const bodyText = await clonedForCheck.text();
                  
                  if (isEmptyResponseBody(bodyText)) {
                    // Track empty response attempts per request
                    const emptyAttemptKey = `${prepared.sessionId ?? "none"}:${prepared.effectiveModel ?? "unknown"}`;
                    incrementEmptyResponseAttempts(emptyAttemptKey);
                    const currentAttempts = getEmptyResponseAttempts(emptyAttemptKey);
                    
                    pushDebug(`empty-response: attempt ${currentAttempts}/${maxAttempts}`);
                    
                    if (currentAttempts < maxAttempts) {
                      await showToast(
                        client,
                        config,
                        `Empty response received. Retrying (${currentAttempts}/${maxAttempts})...`,
                        "warning",
                        childState.isChildSession,
                        childState.childSessionParentID
                      );
                      await sleep(retryDelayMs, abortSignal);
                      continue; // Retry the endpoint loop
                    }
                    
                    // Clean up and throw after max attempts
                    resetEmptyResponseAttempts(emptyAttemptKey);
                    throw new EmptyResponseError(
                      "Alloy",
                      prepared.effectiveModel ?? "unknown",
                      currentAttempts,
                    );
                  }
                  
                  // Clean up successful attempt tracking
                  const emptyAttemptKeyClean = `${prepared.sessionId ?? "none"}:${prepared.effectiveModel ?? "unknown"}`;
                  resetEmptyResponseAttempts(emptyAttemptKeyClean);
                }

                // UNBREAKABLE: Zod Response Validation
                // Validate that the response is at least a valid object if it's supposed to be JSON
                if (response.ok && response.headers.get("content-type")?.includes("application/json") && !prepared.streaming) {
                  try {
                    const clonedForValidation = response.clone();
                    const json = await clonedForValidation.json();
                    const AlloyResponseSchema = z.object({
                      type: z.string().optional(),
                      message: z.any().optional(),
                      error: z.any().optional(),
                    }).passthrough();
                    
                    const result = AlloyResponseSchema.safeParse(json);
                    if (!result.success) {
                      log.error("Alloy response validation failed", { errors: result.error.format() });
                      // We don't throw here to avoid breaking everything, but we log for hardening and can add stricter logic later
                    }
                  } catch (e) {
                    log.error("Failed to parse response for validation", { error: String(e) });
                  }
                }
                
                const transformedResponse = await transformAlloyResponse(
                  response,
                  prepared.streaming,
                  debugContext,
                  prepared.requestedModel,
                  prepared.projectId,
                  prepared.endpoint,
                  prepared.effectiveModel,
                  prepared.sessionId,
                  prepared.toolDebugMissing,
                  prepared.toolDebugSummary,
                  prepared.toolDebugPayload,
                  debugLines,
                );

                // Check for context errors and show appropriate toast
                const contextError = transformedResponse.headers.get("x-Alloy-context-error");
                if (contextError) {
                  if (contextError === "prompt_too_long") {
                    await showToast(
                      client,
                      config,
                      "Context too long - use /compact to reduce size, or trim your request",
                      "warning",
                      childState.isChildSession,
                      childState.childSessionParentID
                    );
                  } else if (contextError === "tool_pairing") {
                    await showToast(
                      client,
                      config,
                      "Tool call/result mismatch - use /compact to fix, or /undo last message",
                      "warning",
                      childState.isChildSession,
                      childState.childSessionParentID
                    );
                  }
                }

                return transformedResponse;
              } catch (error) {
                // Refund token on network/API error (only if consumed)
                if (tokenConsumed) {
                  getTokenTracker().refund(account.index);
                  tokenConsumed = false;
                }

                // Handle recoverable thinking errors - retry with forced recovery
                if (error instanceof Error && error.message === "THINKING_RECOVERY_NEEDED") {
                  // Only retry once with forced recovery to avoid infinite loops
                  if (!forceThinkingRecovery) {
                    pushDebug("thinking-recovery: API error detected, retrying with forced recovery");
                    forceThinkingRecovery = true;
                    i = -1; // Will become 0 after loop increment, restart endpoint loop
                    continue;
                  }
                  
                  // Already tried with forced recovery, give up and return error
                  const recoveryError = error as any;
                  const originalError = recoveryError.originalError || { error: { message: "Thinking recovery triggered" } };
                  
                  const recoveryMessage = `${originalError.error?.message || "Session recovery failed"}\n\n[RECOVERY] Thinking block corruption could not be resolved. Try starting a new session.`;
                  
                  return new Response(JSON.stringify({
                    type: "error",
                    error: {
                      type: "unrecoverable_error",
                      message: recoveryMessage
                    }
                  }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                  });
                }

                if (i < SOVEREIGN_ENDPOINT_FALLBACKS.length - 1) {
                  lastError = error instanceof Error ? error : new Error(String(error));
                  continue;
                }

                // All endpoints failed for this account - track failure and try next account
                const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index);
                lastError = error instanceof Error ? error : new Error(String(error));
                if (shouldCooldown) {
                  accountManager.markAccountCoolingDown(account, cooldownMs, "network-error");
                  accountManager.markRateLimited(account, cooldownMs, family, headerStyle, model);
                  pushDebug(`endpoint-error: cooldown ${cooldownMs}ms after ${failures} failures`);
                }
                shouldSwitchAccount = true;
              }
            }
          }
            
          if (shouldSwitchAccount) {
              totalRetryCount++; // Increment circuit breaker
              // Avoid tight retry loops when there's only one account.
              if (accountCount <= 1) {
                if (lastFailure) {
                  return transformAlloyResponse(
                    lastFailure.response,
                    lastFailure.streaming,
                    lastFailure.debugContext,
                    lastFailure.requestedModel,
                    lastFailure.projectId,
                    lastFailure.endpoint,
                    lastFailure.effectiveModel,
                    lastFailure.sessionId,
                    lastFailure.toolDebugMissing,
                    lastFailure.toolDebugSummary,
                    lastFailure.toolDebugPayload,
                    debugLines,
                  );
                }

                throw lastError || new Error("All Alloy endpoints failed");
              }

              continue;
            }

            // If we get here without returning, something went wrong
            if (lastFailure) {
              return transformAlloyResponse(
                lastFailure.response,
                lastFailure.streaming,
                lastFailure.debugContext,
                lastFailure.requestedModel,
                lastFailure.projectId,
                lastFailure.endpoint,
                lastFailure.effectiveModel,
                lastFailure.sessionId,
                lastFailure.toolDebugMissing,
                lastFailure.toolDebugSummary,
                lastFailure.toolDebugPayload,
                debugLines,
              );
            }

            throw lastError || new Error("All Alloy accounts failed");
          }
        }
      }
    },
    methods: [
        {
          label: "OAuth with Google (Alloy)",
        type: "oauth",
        authorize: async (inputs?: Record<string, string>) => {
          const isHeadless = !!(
            process.env.SSH_CONNECTION ||
            process.env.SSH_CLIENT ||
            process.env.SSH_TTY ||
            process.env.Alloy_HEADLESS
          );

          // CLI flow (`Alloy auth login`) passes an inputs object.
          if (inputs) {
            const accounts: Array<Extract<AlloyTokenExchangeResult, { type: "success" }>> = [];
            const noBrowser = inputs.noBrowser === "true" || inputs["no-browser"] === "true";
            const useManualMode = noBrowser || shouldSkipLocalServer();

            // Check for existing accounts and prompt user for login mode
            let startFresh = true;
            let refreshAccountIndex: number | undefined;
            const existingStorage = await loadAccounts();
            if (existingStorage && existingStorage.accounts.length > 0) {
              let menuResult: any;
              // Bounded at 500 iterations to catch runaway menu loops; a real
              // interactive session exits via `break` on a terminal selection
              // long before this cap. 500 is generous for users who page
              // through the quota-check view multiple times.
              let menuIterations = 0;
              const MAX_MENU_ITERATIONS = 500;
              while (menuIterations++ < MAX_MENU_ITERATIONS) {
                const now = Date.now();
                const existingAccounts = existingStorage.accounts.map((acc, idx) => {
                  let status: 'active' | 'rate-limited' | 'expired' | 'unknown' = 'unknown';
                  
                  const rateLimits = acc.rateLimitResetTimes;
                  if (rateLimits) {
                    const isRateLimited = Object.values(rateLimits).some(
                      (resetTime) => typeof resetTime === 'number' && resetTime > now
                    );
                    if (isRateLimited) {
                      status = 'rate-limited';
                    } else {
                      status = 'active';
                    }
                  } else {
                    status = 'active';
                  }

                  if (acc.coolingDownUntil && acc.coolingDownUntil > now) {
                    status = 'rate-limited';
                  }

                  return {
                    email: acc.email,
                    index: idx,
                    addedAt: acc.addedAt,
                    lastUsed: acc.lastUsed,
                    status,
                    isCurrentAccount: idx === (existingStorage.activeIndex ?? 0),
                    enabled: acc.enabled !== false,
                  };
                });
                
                menuResult = await promptLoginMode(existingAccounts);

                if (menuResult.mode === "check") {
                  console.log("\nğŸ“Š Checking quotas for all accounts...\n");
                  const results = await checkAccountsQuota(existingStorage.accounts, client, providerId);
                  let storageUpdated = false;
                  
                  for (const res of results) {
                    const label = res.email || `Account ${res.index + 1}`;
                    const disabledStr = res.disabled ? " (disabled)" : "";
                    console.log(`â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`);
                    console.log(`  ${label}${disabledStr}`);
                    console.log(`â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`);
                    
                    if (res.status === "error") {
                      console.log(`  âŒ Error: ${res.error}\n`);
                      continue;
                    }

                    // ANSI color codes
                    const colors = {
                      red: '\x1b[31m',
                      orange: '\x1b[33m',  // Yellow/orange
                      green: '\x1b[32m',
                      reset: '\x1b[0m',
                    };

                    // Get color based on remaining percentage
                    const getColor = (remaining?: number): string => {
                      if (typeof remaining !== 'number') return colors.reset;
                      if (remaining < 0.2) return colors.red;
                      if (remaining < 0.6) return colors.orange;
                      return colors.green;
                    };

                    // Helper to create colored progress bar
                    const createProgressBar = (remaining?: number, width: number = 20): string => {
                      if (typeof remaining !== 'number') return 'â–‘'.repeat(width) + ' ???';
                      const filled = Math.round(remaining * width);
                      const empty = width - filled;
                      const color = getColor(remaining);
                      const bar = `${color}${'â–ˆ'.repeat(filled)}${colors.reset}${'â–‘'.repeat(empty)}`;
                      const pct = `${color}${Math.round(remaining * 100)}%${colors.reset}`.padStart(4 + color.length + colors.reset.length);
                      return `${bar} ${pct}`;
                    };

                    // Helper to format reset time with days support
                    const formatReset = (resetTime?: string): string => {
                      if (!resetTime) return '';
                      const ms = Date.parse(resetTime) - Date.now();
                      if (ms <= 0) return ' (resetting...)';
                      
                      const hours = ms / (1000 * 60 * 60);
                      if (hours >= 24) {
                        const days = Math.floor(hours / 24);
                        const remainingHours = Math.floor(hours % 24);
                        if (remainingHours > 0) {
                          return ` (resets in ${days}d ${remainingHours}h)`;
                        }
                        return ` (resets in ${days}d)`;
                      }
                      return ` (resets in ${formatWaitTime(ms)})`;
                    };

                    // Display Gemini CLI Quota first (as requested - swap order)
                    const hasGeminiCli = res.geminiCliQuota && res.geminiCliQuota.models.length > 0;
                    console.log(`\n  â”Œâ”€ Gemini CLI Quota`);
                    if (!hasGeminiCli) {
                      const errorMsg = res.geminiCliQuota?.error || "No Gemini CLI quota available";
                      console.log(`  â”‚  â””â”€ ${errorMsg}`);
                    } else {
                      const models = res.geminiCliQuota!.models;
                      models.forEach((model, idx) => {
                        const isLast = idx === models.length - 1;
                        const connector = isLast ? "â””â”€" : "â”œâ”€";
                        const bar = createProgressBar(model.remainingFraction);
                        const reset = formatReset(model.resetTime);
                        const modelName = model.modelId.padEnd(29);
                        console.log(`  â”‚  ${connector} ${modelName} ${bar}${reset}`);
                      });
                    }

                    // Display Alloy Quota second
                    const hasAlloy = res.quota && Object.keys(res.quota.groups).length > 0;
                    console.log(`  â”‚`);
                    console.log(`  â””â”€ Alloy Quota`);
                    if (!hasAlloy) {
                      const errorMsg = res.quota?.error || "No quota information available";
                      console.log(`     â””â”€ ${errorMsg}`);
                    } else {
                      const groups = res.quota!.groups;
                      const groupEntries = [
                        { name: "Claude", data: groups.claude },
                        { name: "Gemini 3 Pro", data: groups["gemini-pro"] },
                        { name: "Gemini 3 Flash", data: groups["gemini-flash"] },
                      ].filter(g => g.data);
                      
                      groupEntries.forEach((g, idx) => {
                        const isLast = idx === groupEntries.length - 1;
                        const connector = isLast ? "â””â”€" : "â”œâ”€";
                        const bar = createProgressBar(g.data!.remainingFraction);
                        const reset = formatReset(g.data!.resetTime);
                        const modelName = g.name.padEnd(29);
                        console.log(`     ${connector} ${modelName} ${bar}${reset}`);
                      });
                    }
                    console.log("");

                    // Cache quota data for soft quota protection
                    if (res.quota?.groups) {
                      const acc = existingStorage.accounts[res.index];
                      if (acc) {
                        acc.cachedQuota = res.quota.groups;
                        acc.cachedQuotaUpdatedAt = Date.now();
                        storageUpdated = true;
                      }
                    }

                    if (res.updatedAccount) {
                      existingStorage.accounts[res.index] = {
                        ...res.updatedAccount,
                        cachedQuota: res.quota?.groups,
                        cachedQuotaUpdatedAt: Date.now(),
                      };
                      storageUpdated = true;
                    }
                  }
                  if (storageUpdated) {
                    await saveAccounts(existingStorage);
                  }
                  console.log("");
                  continue;
                }

                if (menuResult.mode === "manage") {
                  if (menuResult.toggleAccountIndex !== undefined) {
                    const acc = existingStorage.accounts[menuResult.toggleAccountIndex];
                    if (acc) {
                      acc.enabled = acc.enabled === false;
                      await saveAccounts(existingStorage);
                      console.log(`\nAccount ${acc.email || menuResult.toggleAccountIndex + 1} ${acc.enabled ? 'enabled' : 'disabled'}.\n`);
                    }
                  }
                  continue;
                }

                break;
              }
              
              if (menuResult.mode === "cancel") {
                return {
                  url: "",
                  instructions: "Authentication cancelled",
                  method: "auto",
                  callback: async () => ({ type: "failed", error: "Authentication cancelled" }),
                };
              }
              
              if (menuResult.deleteAccountIndex !== undefined) {
                const updatedAccounts = existingStorage.accounts.filter(
                  (_, idx) => idx !== menuResult.deleteAccountIndex
                );
                await saveAccounts({
                  version: 3,
                  accounts: updatedAccounts,
                  activeIndex: 0,
                  activeIndexByFamily: { claude: 0, gemini: 0 },
                });
                console.log("\nAccount deleted.\n");
                
                if (updatedAccounts.length > 0) {
                  return {
                    url: "",
                    instructions: "Account deleted. Please run `Alloy auth login` again to continue.",
                    method: "auto",
                    callback: async () => ({ type: "failed", error: "Account deleted - please re-run auth" }),
                  };
                }
              }

              if (menuResult?.refreshAccountIndex !== undefined && typeof menuResult.refreshAccountIndex === 'number') {
                refreshAccountIndex = menuResult.refreshAccountIndex;
                const refreshEmail = existingStorage.accounts[refreshAccountIndex as number]?.email;
                console.log(`\nRe-authenticating ${refreshEmail || 'account'}...\n`);
                startFresh = false;
              }
              
              if (menuResult?.deleteAll) {
                await clearAccounts();
                console.log("\nAll accounts deleted.\n");
                startFresh = true;
              } else {
                startFresh = menuResult?.mode === "fresh";
              }
              
              if (startFresh && !menuResult?.deleteAll) {
                console.log("\nStarting fresh - existing accounts will be replaced.\n");
              } else if (!startFresh) {
                console.log("\nAdding to existing accounts.\n");
              }
            }

            while (accounts.length < MAX_OAUTH_ACCOUNTS) {
              console.log(`\n=== Alloy OAuth (Account ${accounts.length + 1}) ===`);

              const projectId = await promptProjectId();

              const result = await (async (): Promise<AlloyTokenExchangeResult> => {
                const authorization = await authorizeGoogleGemini(projectId);
                const fallbackState = getStateFromAuthorizationUrl(authorization.url);

                console.log("\nOAuth URL:\n" + authorization.url + "\n");

                if (useManualMode) {
                  const browserOpened = await openBrowser(authorization.url);
                  if (!browserOpened) {
                    console.log("Could not open browser automatically.");
                    console.log("Please open the URL above manually in your local browser.\n");
                  }
                  return promptManualOAuthInput(fallbackState);
                }

                let listener: OAuthListener | null = null;
                if (!isHeadless) {
                  try {
                    listener = await startOAuthListener();
                  } catch {
                    listener = null;
                  }
                }

                if (!isHeadless) {
                  await openBrowser(authorization.url);
                }

                if (listener) {
                  try {
                    const SOFT_TIMEOUT_MS = 30000;
                    const callbackPromise = listener.waitForCallback();
                    const timeoutPromise = new Promise<never>((_, reject) =>
                      setTimeout(() => reject(new Error("SOFT_TIMEOUT")), SOFT_TIMEOUT_MS)
                    );

                    let callbackUrl: URL;
                    try {
                      callbackUrl = await Promise.race([callbackPromise, timeoutPromise]);
                    } catch (err) {
                      if (err instanceof Error && err.message === "SOFT_TIMEOUT") {
                        console.log("\nâ³ Automatic callback not received after 30 seconds.");
                        console.log("You can paste the redirect URL manually.\n");
                        console.log("OAuth URL (in case you need it again):");
                        console.log(authorization.url + "\n");
                        
                        try {
                          await listener.close();
                        } catch {}
                        
                        return promptManualOAuthInput(fallbackState);
                      }
                      throw err;
                    }

                    const params = extractOAuthCallbackParams(callbackUrl);
                    if (!params) {
                      return { type: "failed", error: "Missing code or state in callback URL" };
                    }

                    return exchangeGoogleGemini(params.code, params.state);
                  } catch (error) {
                    if (error instanceof Error && error.message !== "SOFT_TIMEOUT") {
                      return {
                        type: "failed",
                        error: error.message,
                      };
                    }
                    return {
                      type: "failed",
                      error: error instanceof Error ? error.message : "Unknown error",
                    };
                  } finally {
                    try {
                      await listener.close();
                    } catch {}
                  }
                }

                return promptManualOAuthInput(fallbackState);
              })();

              if (result.type === "failed") {
                if (accounts.length === 0) {
                  return {
                    url: "",
                    instructions: `Authentication failed: ${result.error}`,
                    method: "auto",
                    callback: async () => result,
                  };
                }

                console.warn(
                  `[Alloy-ai] Skipping failed account ${accounts.length + 1}: ${result.error}`,
                );
                break;
              }

              accounts.push(result);

              try {
                await client.tui.showToast({
                  body: {
                    message: `Account ${accounts.length} authenticated${result.email ? ` (${result.email})` : ""}`,
                    variant: "success",
                  },
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log.error("Failed to persist authenticated account", { error: message });
                try {
                  await client.tui.showToast({
                    body: {
                      message: `Account could not be saved: ${message}`,
                      variant: "error",
                    },
                  });
                } catch {
                }
                return {
                  url: "",
                  instructions: `Authentication failed: ${message}`,
                  method: "auto",
                  callback: async () => ({ type: "failed", error: message }),
                };
              }

              try {
                if (refreshAccountIndex !== undefined) {
                  const currentStorage = await loadAccounts();
                  if (currentStorage) {
                    const updatedAccounts = [...currentStorage.accounts];
                    const parts = parseRefreshParts(result.refresh);
                    if (parts.refreshToken) {
                      updatedAccounts[refreshAccountIndex] = {
                        email: result.email ?? updatedAccounts[refreshAccountIndex]?.email,
                        refreshToken: parts.refreshToken,
                        projectId: parts.projectId ?? updatedAccounts[refreshAccountIndex]?.projectId,
                        managedProjectId: parts.managedProjectId ?? updatedAccounts[refreshAccountIndex]?.managedProjectId,
                        addedAt: updatedAccounts[refreshAccountIndex]?.addedAt ?? Date.now(),
                        lastUsed: Date.now(),
                      };
                      await saveAccounts({
                        version: 3,
                        accounts: updatedAccounts,
                        activeIndex: currentStorage.activeIndex,
                        activeIndexByFamily: currentStorage.activeIndexByFamily,
                      });
                    }
                  }
                } else {
                  const isFirstAccount = accounts.length === 1;
                  await persistAccountPool([result], isFirstAccount && startFresh);
                }
              } catch {
              }

              if (refreshAccountIndex !== undefined) {
                break;
              }

              if (accounts.length >= MAX_OAUTH_ACCOUNTS) {
                break;
              }

              // Get the actual deduplicated account count from storage for the prompt
              let currentAccountCount = accounts.length;
              try {
                const currentStorage = await loadAccounts();
                if (currentStorage) {
                  currentAccountCount = currentStorage.accounts.length;
                }
              } catch {
                // Fall back to accounts.length if we can't read storage
              }

              const addAnother = await promptAddAnotherAccount(currentAccountCount);
              if (!addAnother) {
                break;
              }
            }

            const primary = accounts[0];
            if (!primary) {
              return {
                url: "",
                instructions: "Authentication cancelled",
                method: "auto",
                callback: async () => ({ type: "failed", error: "Authentication cancelled" }),
              };
            }

            let actualAccountCount = accounts.length;
            try {
              const finalStorage = await loadAccounts();
              if (finalStorage) {
                actualAccountCount = finalStorage.accounts.length;
              }
            } catch {
            }

            const successMessage = refreshAccountIndex !== undefined
              ? `Token refreshed successfully.`
              : `Multi-account setup complete (${actualAccountCount} account(s)).`;

            return {
              url: "",
              instructions: successMessage,
              method: "auto",
              callback: async (): Promise<AlloyTokenExchangeResult> => primary,
            };
          }

          // TUI flow (`/connect`) does not support per-account prompts.
          // Default to adding new accounts (non-destructive).
          // Users can run `Alloy auth logout` first if they want a fresh start.
          const projectId = "";

          // Check existing accounts count for toast message
          const existingStorage = await loadAccounts();
          const existingCount = existingStorage?.accounts.length ?? 0;

          const useManualFlow = isHeadless || shouldSkipLocalServer();

          let listener: OAuthListener | null = null;
          if (!useManualFlow) {
            try {
              listener = await startOAuthListener();
            } catch {
              listener = null;
            }
          }

          const authorization = await authorizeGoogleGemini(projectId);
          const fallbackState = getStateFromAuthorizationUrl(authorization.url);

          if (!useManualFlow) {
            const browserOpened = await openBrowser(authorization.url);
            if (!browserOpened) {
              listener?.close().catch(() => {});
              listener = null;
            }
          }

          if (listener) {
            return {
              url: authorization.url,
              instructions:
                "Complete sign-in in your browser. We'll automatically detect the redirect back to localhost.",
              method: "auto",
              callback: async (): Promise<AlloyTokenExchangeResult> => {
                const CALLBACK_TIMEOUT_MS = 30000;
                try {
                  const callbackPromise = listener.waitForCallback();
                  const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("CALLBACK_TIMEOUT")), CALLBACK_TIMEOUT_MS),
                  );

                  let callbackUrl: URL;
                  try {
                    callbackUrl = await Promise.race([callbackPromise, timeoutPromise]);
                  } catch (err) {
                    if (err instanceof Error && err.message === "CALLBACK_TIMEOUT") {
                      return {
                        type: "failed",
                        error: "Callback timeout - please use CLI with --no-browser flag for manual input",
                      };
                    }
                    throw err;
                  }

                  const params = extractOAuthCallbackParams(callbackUrl);
                  if (!params) {
                    return { type: "failed", error: "Missing code or state in callback URL" };
                  }

                  const result = await exchangeGoogleGemini(params.code, params.state);
                  if (result.type === "success") {
                    try {
                      await persistAccountPool([result], false);
                    } catch (error) {
                      const message = error instanceof Error ? error.message : String(error);
                      log.error("Failed to persist account after OAuth callback", {
                        error: message,
                      });
                      return {
                        type: "failed",
                        error: message,
                      };
                    }

                    const newTotal = existingCount + 1;
                    const toastMessage = existingCount > 0
                      ? `Added account${result.email ? ` (${result.email})` : ""} - ${newTotal} total`
                      : `Authenticated${result.email ? ` (${result.email})` : ""}`;

                    try {
                      await client.tui.showToast({
                        body: {
                          message: toastMessage,
                          variant: "success",
                        },
                      });
                    } catch {
                    }
                  }

                  return result;
                } catch (error) {
                  return {
                    type: "failed",
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                } finally {
                  try {
                    await listener.close();
                  } catch {
                  }
                }
              },
            };
          }

          return {
            url: authorization.url,
            instructions:
              "Visit the URL above, complete OAuth, then paste either the full redirect URL or the authorization code.",
            method: "code",
            callback: async (codeInput: string): Promise<AlloyTokenExchangeResult> => {
              const params = parseOAuthCallbackInput(codeInput, fallbackState);
              if ("error" in params) {
                return { type: "failed", error: params.error };
              }

              const result = await exchangeGoogleGemini(params.code, params.state);
              if (result.type === "success") {
                try {
                  // TUI flow adds to existing accounts (non-destructive)
                  await persistAccountPool([result], false);
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  log.error("Failed to persist account in manual OAuth flow", {
                    error: message,
                  });
                  return {
                    type: "failed",
                    error: message,
                  };
                }

                // Show appropriate toast message
                const newTotal = (existingStorage?.accounts.length ?? 0) + 1;
                const toastMessage = (existingStorage?.accounts.length ?? 0) > 0
                  ? `Added account${result.email ? ` (${result.email})` : ""} - ${newTotal} total`
                  : `Authenticated${result.email ? ` (${result.email})` : ""}`;

                try {
                  await client.tui.showToast({
                    body: {
                      message: toastMessage,
                      variant: "success",
                    },
                  });
                } catch {
                  // TUI may not be available
                }
              }

              return result;
            },
          };
        },
      },
      {
        label: "Manually enter API Key",
        type: "api",
      },
    ],
  },
};
};

export const AlloyCLIOAuthPlugin = createAlloyPlugin(GOOGLE_GEMINI_PROVIDER_ID);
export const GoogleOAuthPlugin = AlloyCLIOAuthPlugin;

export const __testExports = {
  getHeaderStyleFromUrl,
  resolveQuotaFallbackHeaderStyle,
};
