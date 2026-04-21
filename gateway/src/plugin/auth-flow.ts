import { authorizeGoogleGemini, exchangeGoogleGemini } from "../google-gemini/oauth";
import type { AlloyTokenExchangeResult } from "../google-gemini/oauth";
import { promptAddAnotherAccount, promptLoginMode, promptProjectId } from "./cli";
import { startOAuthListener } from "./server";
import { clearAccounts, loadAccounts, saveAccounts } from "./storage";
import { persistAccountPool } from "./persist-account-pool";
import type { AccountManager } from "./accounts";
import { checkAccountsQuota } from "./quota";
import { createLogger } from "./logger";
import { 
  openBrowser, 
  shouldSkipLocalServer 
} from "./core/system-utils";
import { showToast } from "./core/toast-manager";
import type { 
  PluginClient, 
  AuthMethod,
  OAuthAuthorizationResult,
} from "./types";
import type { AlloyGatewayConfig } from "./config";
import type { ChildSessionState } from "./event-handler";

const log = createLogger("auth-flow");
const quotaRefreshInProgressByEmail = new Set<string>();

const MAX_OAUTH_ACCOUNTS = 10;

export async function triggerAsyncQuotaRefreshForAccount(
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

export function getStateFromAuthorizationUrl(authorizationUrl: string): string {
  try {
    return new URL(authorizationUrl).searchParams.get("state") ?? "";
  } catch {
    return "";
  }
}

export function extractOAuthCallbackParams(url: URL): { code: string; state: string } | null {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return null;
  }
  return { code, state };
}

export function parseOAuthCallbackInput(
  value: string,
  fallbackState: string,
): { code: string; state: string } | { error: string } {
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

export async function promptManualOAuthInput(
  fallbackState: string,
): Promise<AlloyTokenExchangeResult> {
  console.log("1. Open the URL above in your browser and complete Google sign-in.");
  console.log("2. After approving, copy the full redirected localhost URL from the address bar.");
  console.log("3. Paste it back here.\n");

  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const callbackInput = (await rl.question("Paste the redirect URL (or just the code) here: ")).trim();
    const params = parseOAuthCallbackInput(callbackInput, fallbackState);
    if ("error" in params) {
      return { type: "failed", error: params.error };
    }
    return exchangeGoogleGemini(params.code, params.state);
  } finally {
    rl.close();
  }
}

export async function handleAlloyAuthorize(
  providerId: string,
  client: PluginClient,
  config: AlloyGatewayConfig,
  directory: string,
  childState: ChildSessionState,
  inputs?: Record<string, string>,
): Promise<{ refresh: string; apiKey?: string } | Record<string, unknown>> {
  if (inputs?.apiKey) {
    return { apiKey: inputs.apiKey };
  }

  await showToast(client, config, "Initiating Alloy Authentication...", "info", childState.isChildSession, childState.childSessionParentID);

  const storage = await loadAccounts();
  const accounts = storage?.accounts ?? [];
  
  if (accounts.length > 0) {
      const firstEnabled = accounts.find(a => a.enabled !== false);
      if (firstEnabled) {
          return { refresh: firstEnabled.refreshToken };
      }
  }

  throw new Error("No active Alloy accounts found. Please run 'opencode auth login' first.");
}

export function getAlloyAuthMethods(
  providerId: string,
  client: PluginClient,
  config: AlloyGatewayConfig,
  directory: string,
  childState: ChildSessionState,
): AuthMethod[] {
  return [
    {
      label: "OAuth with Google (Alloy)",
      type: "oauth",
      authorize: async (inputs?: Record<string, string>): Promise<OAuthAuthorizationResult> => {
        const isHeadless = !!(
          process.env.SSH_CONNECTION ||
          process.env.SSH_CLIENT ||
          process.env.SSH_TTY ||
          process.env.OPENCODE_HEADLESS
        );

        if (inputs) {
            // CLI flow implementation...
            return runCliAuthFlow(providerId, client, config, directory, childState, inputs);
        }

        // TUI flow...
        const useManualFlow = isHeadless || shouldSkipLocalServer();
        const authorization = await authorizeGoogleGemini();
        const fallbackState = authorization.state;

        return {
          url: authorization.url,
          instructions: useManualFlow 
            ? "Visit the URL above, complete OAuth, then paste either the full redirect URL or the authorization code."
            : "Complete sign-in in your browser. We'll automatically detect the redirect back to localhost.",
          method: useManualFlow ? "code" : "auto",
          callback: async (codeInput?: string): Promise<AlloyTokenExchangeResult> => {
             if (useManualFlow && codeInput) {
                const params = parseOAuthCallbackInput(codeInput, fallbackState);
                if ("error" in params) return { type: "failed", error: params.error };
                const result = await exchangeGoogleGemini(params.code, params.state);
                if (result.type === "success") {
                    await persistAccountPool([result], false);
                }
                return result;
             }

             const listener = await startOAuthListener({ timeoutMs: 60000 });
             try {
                if (!isHeadless) await openBrowser(authorization.url);
                const callbackUrl = await listener.waitForCallback();
                const params = extractOAuthCallbackParams(callbackUrl);
                if (!params) return { type: "failed", error: "Missing params" };
                const result = await exchangeGoogleGemini(params.code, params.state);
                if (result.type === "success") {
                    await persistAccountPool([result], false);
                }
                return result;
             } finally {
                await listener.close();
             }
          }
        };
      }
    },
    {
      label: "Manually enter API Key",
      type: "api",
    }
  ];
}

async function runCliAuthFlow(
  providerId: string,
  client: PluginClient,
  config: AlloyGatewayConfig,
  directory: string,
  childState: ChildSessionState,
  inputs: Record<string, string>,
): Promise<OAuthAuthorizationResult> {
    const noBrowser = inputs.noBrowser === "true" || inputs["no-browser"] === "true";
    const useManualMode = noBrowser || shouldSkipLocalServer();
    
    let existingStorage = await loadAccounts();
    const accounts: any[] = [];
    let startFresh = true;
    let refreshAccountIndex: number | undefined;

    if (existingStorage && existingStorage.accounts.length > 0) {
        let menuIterations = 0;
        while (menuIterations++ < 500) {
            const now = Date.now();
            const existingAccounts = existingStorage.accounts.map((acc, idx) => ({
                email: acc.email,
                index: idx,
                status: ((acc.coolingDownUntil && acc.coolingDownUntil > now) ? 'rate-limited' : 'active') as any,
                isCurrentAccount: idx === (existingStorage?.activeIndex ?? 0),
                enabled: acc.enabled !== false,
            }));

            const menuResult = await promptLoginMode(existingAccounts);
            
            if (menuResult.mode === "check") {
                await renderQuotaTui(existingStorage, client, providerId);
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

            if (menuResult.mode === "cancel") {
                return {
                    url: "",
                    instructions: "Cancelled",
                    method: "auto",
                    callback: async () => ({ type: "failed", error: "Cancelled" })
                };
            }

            if (menuResult.deleteAccountIndex !== undefined) {
                const refreshed = await loadAccounts();
                if (refreshed) {
                    refreshed.accounts = refreshed.accounts.filter((_, idx) => idx !== menuResult.deleteAccountIndex);
                    await saveAccounts(refreshed, true);
                    existingStorage = refreshed;
                }
                continue;
            }

            if (menuResult.refreshAccountIndex !== undefined) {
                refreshAccountIndex = menuResult.refreshAccountIndex;
                startFresh = false;
                break;
            }

            if (menuResult.deleteAll) {
                await clearAccounts();
                startFresh = true;
                break;
            }

            startFresh = menuResult.mode === "fresh";
            break;
        }
    }

    return {
        url: "",
        instructions: "Follow CLI prompts...",
        method: "auto",
        callback: async () => {
            while (accounts.length < MAX_OAUTH_ACCOUNTS) {
                const projectId = await promptProjectId();
                const authorization = await authorizeGoogleGemini(projectId);
                const state = authorization.state;

                console.log("\nOAuth URL:\n" + authorization.url + "\n");
                if (useManualMode) {
                    await openBrowser(authorization.url).catch(() => {});
                }

                let result: AlloyTokenExchangeResult;
                if (useManualMode) {
                    result = await promptManualOAuthInput(state);
                } else {
                    const listener = await startOAuthListener();
                    await openBrowser(authorization.url).catch(() => {});
                    try {
                        const callbackUrl = await listener.waitForCallback();
                        const params = extractOAuthCallbackParams(callbackUrl);
                        result = params ? await exchangeGoogleGemini(params.code, params.state) : { type: "failed", error: "Missing params" };
                    } finally {
                        await listener.close();
                    }
                }

                if (result.type === "failed") return result;

                accounts.push(result);
                if (refreshAccountIndex !== undefined) {
                    const curr = await loadAccounts();
                    if (curr && curr.accounts[refreshAccountIndex]) {
                        const targetAccount = curr.accounts[refreshAccountIndex]!;
                        curr.accounts[refreshAccountIndex] = {
                            ...targetAccount,
                            refreshToken: result.refresh,
                            email: result.email || targetAccount.email,
                            lastUsed: Date.now(),
                            addedAt: targetAccount.addedAt ?? Date.now()
                        };
                        await saveAccounts(curr, true);
                    }
                    break;
                } else {
                    await persistAccountPool([result], accounts.length === 1 && startFresh);
                }

                if (!(await promptAddAnotherAccount(accounts.length))) break;
            }
            return accounts[0]!;
        }
    };
}

async function renderQuotaTui(storage: any, client: PluginClient, providerId: string) {
    console.log("\nChecking quotas...\n");
    const results = await checkAccountsQuota(storage.accounts, client, providerId);
    for (const res of results) {
        console.log(`----------------------------------------`);
        console.log(`  ${res.email || `Account ${res.index + 1}`}${res.disabled ? " (disabled)" : ""}`);
        if (res.status === "error") {
            console.log(`    Error: ${res.error}`);
            continue;
        }
        // Simplified rendering for brevity in refactor
        if (res.quota?.groups) {
            Object.entries(res.quota.groups).forEach(([name, data]: [string, any]) => {
                const pct = Math.round((data.remainingFraction || 0) * 100);
                console.log(`    ${name.padEnd(15)} [${'#'.repeat(pct/10).padEnd(10)}] ${pct}%`);
            });
        }
    }
    console.log("");
}
