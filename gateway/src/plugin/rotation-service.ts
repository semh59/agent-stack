import { 
  ALLOY_ENDPOINT_FALLBACKS, 
  ALLOY_ENDPOINT_PROD 
} from "../constants";
import { 
  accessTokenExpired
} from "./auth";
import { ensureProjectContext } from "./project";
import { 
  startAlloyDebugRequest, 
  isDebugEnabled 
} from "./debug";
import { 
  prepareAlloyRequest, 
  transformAlloyResponse,
  buildThinkingWarmupBody
} from "./request";
import { AlloyTokenRefreshError, refreshAccessToken } from "./token";
import type { AccountManager, ModelFamily, ManagedAccount, QuotaKey, CooldownReason, HeaderStyle } from "./accounts";
import { computeSoftQuotaCacheTtlMs, parseRateLimitReason, calculateBackoffMs } from "./accounts";
import { getHealthTracker, getTokenTracker } from "./rotation";
import { 
  toUrlString, 
  toWarmupStreamUrl, 
  getModelFamilyFromUrl, 
  extractModelFromUrl, 
  getHeaderStyleFromUrl, 
  isExplicitQuotaFromUrl, 
  resolveQuotaFallbackHeaderStyle,
  getCliFirst
} from "./fetch-helpers";
import { 
  formatWaitTime, 
  getRateLimitBackoff, 
  resetAccountFailureState, 
  trackAccountFailure, 
  sleep, 
  headerStyleToQuotaKey,
  resetRateLimitState
} from "./core/rate-limit-state";
import { 
  retryAfterMsFromResponse
} from "./core/backoff";
import { 
  markWarmupSuccess, 
  trackWarmupAttempt, 
  clearWarmupAttempt 
} from "./core/warmup-tracker";
import { showToast, isSoftQuotaToastShown, setSoftQuotaToastShown, isRateLimitToastShown, setRateLimitToastShown } from "./core/toast-manager";
import type { EndpointCircuitBreaker } from "./core/circuit-breaker";
import { extractRetryInfoFromBody } from "./core/rate-limit-state"; 
import type { 
  PluginClient, 
  GetAuth,
} from "./types";
import type { AlloyGatewayConfig } from "./config";
import type { ChildSessionState } from "./event-handler";
import { createLogger } from "./logger";

const log = createLogger("rotation-service");

export interface RotationRequestContext {
  input: URL | RequestInfo;
  init?: RequestInit;
  client: PluginClient;
  config: AlloyGatewayConfig;
  accountManager: AccountManager;
  providerId: string;
  childState: ChildSessionState;
  circuitBreaker: EndpointCircuitBreaker;
  getAuth: GetAuth;
}

interface PreparedAlloyRequest {
    request: string | Request;
    init: RequestInit;
    streaming: boolean;
    headerStyle: HeaderStyle;
    sessionId?: string;
    effectiveModel?: string;
    requestedModel?: string;
    needsSignedThinkingWarmup?: boolean;
}

type RotationErrorResult = 
  | { type: 'retry-endpoint' }
  | { type: 'switch-account' }
  | { type: 'next-endpoint' }
  | { type: 'fallback-quota', newStyle: HeaderStyle }
  | { type: 'error', error: Error };

export class AlloyRotationService {
  /**
   * Primary entry point for executing a request through the rotation pool.
   */
  public async rotateFetch(ctx: RotationRequestContext): Promise<Response> {
    const { input, init, client, config, accountManager, providerId, childState, circuitBreaker } = ctx;

    const urlString = toUrlString(input as string | Request);
    const family = getModelFamilyFromUrl(urlString) as ModelFamily;
    const model = extractModelFromUrl(urlString) || "unknown";
    const debugLines: string[] = [];
    const pushDebug = (line: string) => {
      if (!isDebugEnabled()) return;
      debugLines.push(line);
    };
    
    const abortSignal = init?.signal ?? undefined;
    const checkAborted = () => {
      if (abortSignal?.aborted) {
        throw abortSignal.reason instanceof Error ? abortSignal.reason : new Error("Aborted");
      }
    };

    let totalRetryCount = 0;
    const MAX_TOTAL_RETRIES = 10;

    const checkRequestViability = () => {
      checkAborted();
      if (totalRetryCount >= MAX_TOTAL_RETRIES) {
        throw new Error(`Circuit Breaker: Request failed after ${totalRetryCount} retries. Please try again later.`);
      }
    };

    let lastError: Error | null = null;

    while (totalRetryCount <= MAX_TOTAL_RETRIES) {
      checkRequestViability();
      
      const accountCount = accountManager.getAccountCount();
      if (accountCount === 0) {
        throw new Error("No Alloy accounts available. Run `opencode auth login`.");
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
      ) as ManagedAccount;
      
      if (!account) {
        const waitMs = await this.handleAllAccountsUnavailable(ctx, family, model, urlString);
        if (waitMs > 0) {
            await sleep(waitMs, abortSignal as AbortSignal);
            continue;
        }
        throw lastError || new Error("All accounts unavailable");
      }

      resetRateLimitState(account.index, "Alloy");
      
      // Account Selection Toast
      if (accountCount > 1 && accountManager.shouldShowAccountToast(account.index)) {
        const accountLabel = account.email || `Account ${account.index + 1}`;
        const enabledAccounts = accountManager.getEnabledAccounts();
        const enabledPosition = enabledAccounts.findIndex(a => (a as ManagedAccount).index === account.index) + 1;
        try {
            await showToast(client, config, `Using ${accountLabel} (${enabledPosition}/${accountCount})`, "info", childState.isChildSession, childState.childSessionParentID);
        } catch (_) {
            // Ignore toast failures
        }
        accountManager.markToastShown(account.index);
      }

      accountManager.requestSaveToDisk();
      let authRecord = accountManager.toAuthDetails(account);

      // Token Refresh
      if (accessTokenExpired(authRecord)) {
        try {
          const refreshed = await refreshAccessToken(authRecord, client, providerId);
          if (!refreshed) {
             this.handleAccountFailure(accountManager, account, "auth-failure", family, model);
             continue;
          }
          resetAccountFailureState(account.index);
          accountManager.updateFromAuth(account, refreshed);
          authRecord = refreshed;
          await accountManager.saveToDisk().catch(e => log.error("Persist failed", {error: String(e)}));
        } catch (error) {
           if (error instanceof AlloyTokenRefreshError && error.code === "invalid_grant") {
              if (await this.handleRevokedAccount(accountManager, account, providerId, client)) continue;
           }
           this.handleAccountFailure(accountManager, account, "auth-failure", family, model, error);
           continue;
        }
      }

      const accessToken = authRecord.access;
      if (!accessToken) {
        if (accountCount <= 1) throw new Error("Missing access token");
        continue;
      }

      // Project Context
      let projectContext;
      try {
        projectContext = await ensureProjectContext(authRecord);
        resetAccountFailureState(account.index);
        if (projectContext.auth !== authRecord) {
          accountManager.updateFromAuth(account, projectContext.auth);
          authRecord = projectContext.auth;
          await accountManager.saveToDisk().catch(e => log.error("Persist failed", {error: String(e)}));
        }
      } catch (error) {
        this.handleAccountFailure(accountManager, account, "project-error", family, model, error);
        continue;
      }

      // Endpoint Loop
      let shouldSwitchAccount = false;
      let headerStyle = getHeaderStyleFromUrl(urlString, family) as HeaderStyle;
      
      if (accountManager.isRateLimitedForHeaderStyle(account, family, headerStyle, model)) {
          const handled = await this.handleQuotaExhaustion(ctx, account, family, model, urlString, headerStyle);
          if (handled.type === 'switch') { shouldSwitchAccount = true; }
          else if (handled.type === 'fallback') { headerStyle = handled.newStyle as HeaderStyle; }
          else { throw new Error("Quota exhausted on all paths"); }
      }

      while (!shouldSwitchAccount) {
        let capacityRetryCount = 0;
        
        for (let i = 0; i < ALLOY_ENDPOINT_FALLBACKS.length; i++) {
          const currentEndpoint = ALLOY_ENDPOINT_FALLBACKS[i];
          if (!currentEndpoint || !circuitBreaker.isUsable(currentEndpoint)) continue;
          if (headerStyle === "gemini-cli" && currentEndpoint !== ALLOY_ENDPOINT_PROD) continue;

          try {
            const prepared = prepareAlloyRequest(input as string | Request, init, accessToken, projectContext.effectiveProjectId, currentEndpoint, headerStyle, false, {
                claudeToolHardening: config.claude_tool_hardening,
                fingerprint: account.fingerprint,
            });

            const debugContext = startAlloyDebugRequest({
              originalUrl: urlString,
              resolvedUrl: toUrlString(prepared.request as string | Request),
              method: prepared.init.method || "POST",
              headers: (prepared.init.headers as HeadersInit) || {},
              body: prepared.init.body,
              streaming: prepared.streaming,
              projectId: projectContext.effectiveProjectId,
            });

            await this.runThinkingWarmup(prepared, pushDebug);

            if (config.account_selection_strategy === 'hybrid') {
              getTokenTracker().consume(account.index);
            }

            const response = await fetch(prepared.request as string | Request, prepared.init);
            
            // Success!
            if (response.ok) {
              getHealthTracker().recordSuccess(account.index);
              resetAccountFailureState(account.index);
              const transformed = await transformAlloyResponse(response, prepared.streaming, debugContext, prepared.requestedModel, projectContext.effectiveProjectId, currentEndpoint, prepared.effectiveModel, prepared.sessionId);
              return transformed;
            }

            // Error handling...
            const result = await this.handleResponseError(ctx, response, account, family, model, headerStyle, capacityRetryCount);
            if (result.type === 'retry-endpoint') { i--; capacityRetryCount++; continue; }
            if (result.type === 'next-endpoint') { continue; }
            if (result.type === 'switch-account') { shouldSwitchAccount = true; break; }
            if (result.type === 'fallback-quota') { headerStyle = result.newStyle; continue; }
            if (result.type === 'error') { throw result.error; }
            
          } catch (error) {
            // Network error
            const { shouldCooldown, cooldownMs } = trackAccountFailure(account.index);
            getHealthTracker().recordFailure(account.index);
            lastError = error instanceof Error ? error : new Error(String(error));
            if (shouldCooldown) {
                accountManager.markAccountCoolingDown(account, cooldownMs, "network-error" as CooldownReason);
                accountManager.markRateLimited(account, cooldownMs, family as ModelFamily, headerStyle as HeaderStyle, model);
            }
            shouldSwitchAccount = true;
            break;
          }
        }
        if (!shouldSwitchAccount) { shouldSwitchAccount = true; } // Safety exit if for loop finishes without yielding
      }
      totalRetryCount++;
    }
    throw lastError || new Error("All Alloy accounts failed");
  }

  private async handleAllAccountsUnavailable(ctx: RotationRequestContext, family: string, model: string, urlString: string): Promise<number> {
    const { accountManager, config, client, childState } = ctx;
    const softQuotaCacheTtlMs = computeSoftQuotaCacheTtlMs(config.soft_quota_cache_ttl_minutes, config.quota_refresh_interval_minutes);
    
    if (accountManager.areAllAccountsOverSoftQuota(family as ModelFamily, config.soft_quota_threshold_percent, softQuotaCacheTtlMs, model)) {
        const threshold = config.soft_quota_threshold_percent;
        const waitMs = accountManager.getMinWaitTimeForSoftQuota(family as ModelFamily, threshold, softQuotaCacheTtlMs, model);
        if (waitMs === null) return 0;
        if (!isSoftQuotaToastShown()) {
            await showToast(client, config, `All accounts over ${threshold}% quota. Waiting ${formatWaitTime(waitMs)}...`, "warning", childState.isChildSession, childState.childSessionParentID);
            setSoftQuotaToastShown(true);
        }
        return waitMs;
    }

    const headerStyle = getHeaderStyleFromUrl(urlString, family as ModelFamily);
    const explicitQuota = isExplicitQuotaFromUrl(urlString);
    const waitMs = accountManager.getMinWaitTimeForFamily(family as ModelFamily, model, headerStyle as HeaderStyle, explicitQuota) || 60000;
    
    if (!isRateLimitToastShown()) {
        await showToast(client, config, `All accounts rate-limited for ${family}. Waiting ${Math.ceil(waitMs/1000)}s...`, "warning", childState.isChildSession, childState.childSessionParentID);
        setRateLimitToastShown(true);
    }
    return waitMs;
  }

  private handleAccountFailure(accountManager: AccountManager, account: ManagedAccount, type: string, family: string, model: string, error?: unknown) {
    const { shouldCooldown, cooldownMs } = trackAccountFailure(account.index);
    getHealthTracker().recordFailure(account.index);
    if (shouldCooldown) {
      accountManager.markAccountCoolingDown(account, cooldownMs, type as CooldownReason);
      accountManager.markRateLimited(account, cooldownMs, family as ModelFamily, "Alloy", model);
    }
    if (error) {
      log.error(`Account failure: ${type}`, { error: String(error) });
    }
  }

  private async handleRevokedAccount(accountManager: AccountManager, account: ManagedAccount, providerId: string, client: PluginClient): Promise<boolean> {
     accountManager.removeAccount(account);
     await accountManager.saveToDisk().catch(() => {});
     if (accountManager.getAccountCount() === 0) {
         await client.auth.set({ path: { id: providerId }, body: { type: "oauth", refresh: "", access: "", expires: 0 } }).catch(() => {});
         throw new Error("All accounts revoked. Please re-authenticate.");
     }
     return true;
  }

  private async handleQuotaExhaustion(ctx: RotationRequestContext, account: ManagedAccount, family: string, model: string, urlString: string, headerStyle: string): Promise<{type: 'switch'} | {type: 'fallback', newStyle: string} | {type: 'error'}> {
      const { accountManager, config } = ctx;
      const explicitQuota = isExplicitQuotaFromUrl(urlString);
      const cliFirst = getCliFirst(config);

      if (config.quota_fallback && !explicitQuota && family === "gemini") {
          if (headerStyle === "Alloy" && !cliFirst) {
              if (accountManager.hasOtherAccountWithAlloyAvailable(account.index, family as ModelFamily, model)) return { type: 'switch' };
          }
          const alternateStyle = accountManager.getAvailableHeaderStyle(account, family as ModelFamily, model) as HeaderStyle;
          const fallbackStyle = resolveQuotaFallbackHeaderStyle({ quotaFallback: config.quota_fallback, cliFirst, explicitQuota, family: family as ModelFamily, headerStyle: headerStyle as HeaderStyle, alternateStyle }) as HeaderStyle;
          if (fallbackStyle) return { type: 'fallback', newStyle: fallbackStyle };
      }
      return { type: 'switch' };
  }

  private async handleResponseError(ctx: RotationRequestContext, response: Response, account: ManagedAccount, family: string, model: string, headerStyle: string, capacityRetryCount: number): Promise<RotationErrorResult> {
      const { accountManager, config } = ctx;
      if (response.status === 429 || response.status === 503 || response.status === 529) {
          const bodyInfo = await extractRetryInfoFromBody(response);
          const rateLimitReason = parseRateLimitReason(bodyInfo.reason, bodyInfo.message, response.status);

          if ((rateLimitReason === "MODEL_CAPACITY_EXHAUSTED" || rateLimitReason === "SERVER_ERROR") && capacityRetryCount < 3) {
              return { type: 'retry-endpoint' };
          }

          const quotaKey = headerStyleToQuotaKey(headerStyle as HeaderStyle, family as ModelFamily);
          const { delayMs } = getRateLimitBackoff(account.index, quotaKey as QuotaKey, retryAfterMsFromResponse(response));
          const effectiveDelayMs = Math.max(delayMs, calculateBackoffMs(rateLimitReason, getHealthTracker().getConsecutiveFailures(account.index), delayMs));

          accountManager.markRateLimitedWithReason(account, family as ModelFamily, headerStyle as HeaderStyle, model, rateLimitReason, effectiveDelayMs, "", config.failure_ttl_seconds * 1000);
          return { type: 'switch-account' };
      }
      return { type: 'next-endpoint' };
  }

  private async runThinkingWarmup(prepared: PreparedAlloyRequest, _pushDebug: (line: string) => void): Promise<void> {
    if (!prepared.needsSignedThinkingWarmup || !prepared.sessionId) return;
    if (!trackWarmupAttempt(prepared.sessionId)) return;
    const warmupBody = buildThinkingWarmupBody(typeof prepared.init.body === "string" ? prepared.init.body : undefined, Boolean(prepared.effectiveModel?.toLowerCase().includes("thinking")));
    if (!warmupBody) return;
    try {
      const warmupUrl = toWarmupStreamUrl(prepared.request as string | Request);
      const res = await fetch(warmupUrl, { ...prepared.init, body: warmupBody });
      await res.text();
      markWarmupSuccess(prepared.sessionId);
    } catch (_) {
      clearWarmupAttempt(prepared.sessionId);
    }
  }
}
