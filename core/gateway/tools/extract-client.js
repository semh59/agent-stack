const fs = require('fs');
const path = require('path');

const pluginPath = path.join(__dirname, '../src/plugin.ts');
const clientPath = path.join(__dirname, '../src/orchestration/alloy-client.ts');

const content = fs.readFileSync(pluginPath, 'utf-8');
const lines = content.split('\n');

const fetchStart = lines.findIndex(l => l.includes('async fetch(input, init) {'));
let openBraces = 0;
let fetchEnd = -1;
for (let i = fetchStart; i < lines.length; i++) {
  openBraces += (lines[i].match(/\{/g) || []).length;
  openBraces -= (lines[i].match(/\}/g) || []).length;
  if (openBraces === 0) {
    fetchEnd = i;
    break;
  }
}

const bottomStart = lines.findIndex(l => l.includes('function toUrlString'));

const imports = `
import { ALLOY_ENDPOINT_FALLBACKS, ALLOY_ENDPOINT_PROD, type HeaderStyle } from "../constants";
import { accessTokenExpired, isOAuthAuth } from "../plugin/auth";
import {
  startAlloyDebugRequest,
  logAccountContext,
  logRateLimitEvent,
  logRateLimitSnapshot,
  logResponseBody,
  logModelFamily,
  isDebugEnabled,
  getLogFilePath,
} from "../plugin/debug";
import {
  buildThinkingWarmupBody,
  isGenerativeLanguageRequest,
  prepareAlloyRequest,
  transformAlloyResponse,
} from "../plugin/request";
import { resolveModelWithTier } from "../plugin/transform/model-resolver";
import { AlloyTokenRefreshError, refreshAccessToken } from "../plugin/token";
import { AccountManager, type ModelFamily, parseRateLimitReason, calculateBackoffMs, computeSoftQuotaCacheTtlMs, headerStyleToQuotaKey, getRateLimitBackoff } from "../plugin/accounts";
import { type AlloyGatewayConfig } from "../plugin/config";
import { getHealthTracker, getTokenTracker, trackAccountFailure, resetAccountFailureState } from "../plugin/rotation";
import { extractRetryInfoFromBody, retryAfterMsFromResponse } from "../plugin/request-helpers";

// Internal helpers extracted from plugin.ts bottom
${lines.slice(bottomStart).join('\n').replace(/export const __testExports.*/s, '')}

const log = {
  debug: (...args) => console.debug('[AlloyGatewayClient]', ...args),
  info: (...args) => console.info('[AlloyGatewayClient]', ...args),
  warn: (...args) => console.warn('[AlloyGatewayClient]', ...args),
  error: (...args) => console.error('[AlloyGatewayClient]', ...args)
};

const FIRST_RETRY_DELAY_MS = 1000;
const SWITCH_ACCOUNT_DELAY_MS = 5000;

export class AlloyGatewayClient {
  private accountManager: AccountManager;
  private config: AlloyGatewayConfig;
  private providerId: string;
  private getAuth: () => Promise<any>;

  constructor(
    accountManager: AccountManager, 
    config: AlloyGatewayConfig, 
    providerId: string,
    getAuth: () => Promise<any>
  ) {
    this.accountManager = accountManager;
    this.config = config;
    this.providerId = providerId;
    this.getAuth = getAuth;
  }

  // Simplified project context mock for pipeline client
  private async ensureProjectContext(authRecord: any) {
    return { auth: authRecord, effectiveProjectId: authRecord.projectId || "" };
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const showToast = async (message: string, variant: string) => {
      if (!this.config.quiet_mode) {
        console.log(\`[\${variant.toUpperCase()}] \${message}\`);
      }
    };

    const sleep = (ms: number, signal?: AbortSignal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });

    const formatWaitTime = (ms: number) => {
      if (ms < 1000) return \`\${ms}ms\`;
      const s = Math.ceil(ms / 1000);
      if (s < 60) return \`\${s}s\`;
      return \`\${Math.ceil(s / 60)}m\`;
    };

    const isChildSession = false;
    const client = { auth: { set: async () => {} } }; // Mock client for token refresh
    
    // Core variables
    const accountManager = this.accountManager;
    const config = this.config;
    const providerId = this.providerId;
    const getAuth = this.getAuth;
    const ensureProjectContext = this.ensureProjectContext.bind(this);

    // Track warmup
    const warmupAttemptedSessionIds = new Set<string>();
    const warmupSucceededSessionIds = new Set<string>();
    const trackWarmupAttempt = (id) => { if (warmupAttemptedSessionIds.has(id)) return false; warmupAttemptedSessionIds.add(id); return true; };
    const markWarmupSuccess = (id) => warmupSucceededSessionIds.add(id);
    const clearWarmupAttempt = (id) => warmupAttemptedSessionIds.delete(id);

    let softQuotaToastShown = false;
    let rateLimitToastShown = false;
    const resetAllAccountsBlockedToasts = () => { softQuotaToastShown = false; rateLimitToastShown = false; };

${lines.slice(fetchStart + 1, fetchEnd).join('\n')}
  }
}
`;

fs.writeFileSync(clientPath, imports);
console.log('Successfully generated AlloyGatewayClient at', clientPath);
