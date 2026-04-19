const fs = require('fs');
const path = require('path');

const pluginPath = path.join(__dirname, '../src/plugin.ts');
const clientPath = path.join(__dirname, '../src/orchestration/antigravity-client.ts');

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

function extractCodeBlock(keyword) {
  let startIndex = lines.findIndex(l => l.includes(keyword) && !l.trim().startsWith('//'));
  if (startIndex === -1) return '';
  let braces = 0;
  let endIndex = -1;
  let foundBrace = false;
  for (let i = startIndex; i < lines.length; i++) {
    braces += (lines[i].match(/\{/g) || []).length;
    braces -= (lines[i].match(/\}/g) || []).length;
    if (lines[i].includes('{')) foundBrace = true;
    if (foundBrace && braces === 0) {
      endIndex = i;
      break;
    }
  }
  return lines.slice(startIndex, endIndex + 1).join('\n');
}

const customHelpers = `
// Extracted missing helpers from plugin.ts
type ProjectContextResult = { auth: any; effectiveProjectId: string };
${extractCodeBlock('function retryAfterMsFromResponse')}
${extractCodeBlock('async function extractRetryInfoFromBody')}
${extractCodeBlock('function headerStyleToQuotaKey')}
${extractCodeBlock('function getRateLimitBackoff')}
${extractCodeBlock('function trackAccountFailure')}
${extractCodeBlock('function resetAccountFailureState')}
${extractCodeBlock('function resetRateLimitState')}
${extractCodeBlock('async function triggerAsyncQuotaRefreshForAccount')}
${extractCodeBlock('function logAntigravityDebugResponse')}
${extractCodeBlock('function createSyntheticErrorResponse')}
${extractCodeBlock('function isEmptyResponseBody')}
class EmptyResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyResponseError';
  }
}
let emptyResponseAttempts: Record<string, number> = {};
`;

let generatedTS = `
import { ANTIGRAVITY_ENDPOINT_FALLBACKS, ANTIGRAVITY_ENDPOINT_PROD, type HeaderStyle } from "../constants";
import { accessTokenExpired, isOAuthAuth } from "../plugin/auth";
import {
  startAntigravityDebugRequest,
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
  prepareAntigravityRequest,
  transformAntigravityResponse,
  type RateLimitBodyInfo
} from "../plugin/request";
import { resolveModelWithTier } from "../plugin/transform/model-resolver";
import { AntigravityTokenRefreshError, refreshAccessToken } from "../plugin/token";
import { AccountManager, type ModelFamily, parseRateLimitReason, calculateBackoffMs, computeSoftQuotaCacheTtlMs } from "../plugin/accounts";
import { type AntigravityConfig } from "../plugin/config";
import { getHealthTracker, getTokenTracker } from "../plugin/rotation";

${customHelpers}

// Internal helpers extracted from plugin.ts bottom
${lines.slice(bottomStart).join('\n').replace(/export const __testExports.*/s, '')}

const log = {
  debug: (...args: any[]) => console.debug('[AntigravityClient]', ...args),
  info: (...args: any[]) => console.info('[AntigravityClient]', ...args),
  warn: (...args: any[]) => console.warn('[AntigravityClient]', ...args),
  error: (...args: any[]) => console.error('[AntigravityClient]', ...args)
};

const FIRST_RETRY_DELAY_MS = 1000;
const SWITCH_ACCOUNT_DELAY_MS = 5000;

export class AntigravityClient {
  private accountManager: AccountManager;
  private config: AntigravityConfig;
  private providerId: string;
  private getAuth: () => Promise<any>;
  private mockClient: any;

  constructor(
    accountManager: AccountManager, 
    config: AntigravityConfig, 
    providerId: string,
    getAuth: () => Promise<any>
  ) {
    this.accountManager = accountManager;
    this.config = config;
    this.providerId = providerId;
    this.getAuth = getAuth;
    this.mockClient = { auth: { set: async () => {} } };
  }

  private async ensureProjectContext(authRecord: any) {
    return { auth: authRecord, effectiveProjectId: authRecord.projectId || "" };
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const sleep = (ms: number, signal?: AbortSignal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      });
    });

    const formatWaitTime = (ms: number) => {
      if (ms < 1000) return \`\${ms}ms\`;
      const s = Math.ceil(ms / 1000);
      if (s < 60) return \`\${s}s\`;
      return \`\${Math.ceil(s / 60)}m\`;
    };

    const isChildSession = false;
    const client = this.mockClient;
    
    // Core variables
    const accountManager = this.accountManager;
    const config = this.config;
    const providerId = this.providerId;
    const getAuth = this.getAuth;
    const ensureProjectContext = this.ensureProjectContext.bind(this);
    const childSessionParentID = "standalone-pipeline";

    const warmupAttemptedSessionIds = new Set<string>();
    const warmupSucceededSessionIds = new Set<string>();
    const trackWarmupAttempt = (id: string) => { if (warmupAttemptedSessionIds.has(id)) return false; warmupAttemptedSessionIds.add(id); return true; };
    const markWarmupSuccess = (id: string) => warmupSucceededSessionIds.add(id);
    const clearWarmupAttempt = (id: string) => warmupAttemptedSessionIds.delete(id);

    let softQuotaToastShown = false;
    let rateLimitToastShown = false;
    const resetAllAccountsBlockedToasts = () => { softQuotaToastShown = false; rateLimitToastShown = false; };
`;

let fetchBody = lines.slice(fetchStart + 1, fetchEnd).join('\n');

generatedTS += fetchBody + `
  }
}
`;

fs.writeFileSync(clientPath, generatedTS);
console.log('Successfully generated AntigravityClient at', clientPath);
