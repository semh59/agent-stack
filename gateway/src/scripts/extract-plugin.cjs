const fs = require('fs');
const lines = fs.readFileSync('plugin.ts', 'utf8').split('\n');

const fetchStart = 458; 
const fetchEnd = 1516;  

let fetchLines = lines.slice(fetchStart, fetchEnd + 1);

fetchLines[0] = fetchLines[0].replace(/async fetch\s*\(\s*input\s*,\s*init\s*\)\s*\{/, 'export async function createFetchInterceptor(input: RequestInfo, init: RequestInit | undefined, ctx: any) {');

fetchLines.splice(1, 0, '  const { getAuth, accountManager, client, providerId, config, childState, cachedGetAuth, process } = ctx;');

const interceptorFile = `import { AlloyTokenRefreshError, refreshAccessToken } from "../token";
import { isGenerativeLanguageRequest, prepareAlloyRequest, transformAlloyResponse } from "../request";
import { toUrlString, getModelFamilyFromUrl, extractModelFromUrl, getHeaderStyleFromUrl, isExplicitQuotaFromUrl, toWarmupStreamUrl } from "../fetch-helpers";
import { isDebugEnabled, startAlloyDebugRequest, getLogFilePath, logAccountContext, logRateLimitSnapshot, logAlloyDebugResponse } from "../debug";
import { isOAuthAuth, parseRefreshParts } from "../auth";
import { ensureProjectContext } from "../project";
import { getHealthTracker } from "../rotation";
import { checkAccountsQuota } from "../quota";
import { showToast, resetAllAccountsBlockedToasts, shouldShowRateLimitToast, isSoftQuotaToastShown, setSoftQuotaToastShown, isRateLimitToastShown, setRateLimitToastShown } from "./toast-manager";
import { formatWaitTime, trackAccountFailure, resetAccountFailureState, sleep } from "./rate-limit-state";
import { buildThinkingWarmupBody } from "../request";
import { computeSoftQuotaCacheTtlMs } from "../accounts";
import { accessTokenExpired } from "../auth";

${fetchLines.join('\n')}`;

fs.writeFileSync('plugin/core/fetch-interceptor.ts', interceptorFile);
console.log('Created fetch-interceptor.ts');
