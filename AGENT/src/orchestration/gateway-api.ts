import {
  extractModelFromUrl,
  extractRetryInfoFromBody,
  getModelFamilyFromUrl,
  log,
  retryAfterMsFromResponse,
  toUrlString,
} from "./gateway-utils";
import { type SovereignGatewayConfig } from "../plugin/config";
import { isGenerativeLanguageRequest } from "../plugin/request";
import { accessTokenExpired, isOAuthAuth } from "../plugin/auth";
import { refreshAccessToken } from "../plugin/token";
import { calculateBackoffMs, parseRateLimitReason } from "../plugin/accounts";
import { sleep } from "../plugin/core/rate-limit-state";

const MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const MOCK_LATENCY_HEADER = "x-sovereign-mock-latency-ms";

export class SovereignAPI {
  // Static state for rate limiting and failure tracking
  // These are now initialized inline to avoid TypeScript initialization issues
  private static rateLimitStateByAccountQuota = new Map<string, any>();
  private static failureStateCountByEmail = new Map<string, number>();

  constructor(
    private accountManager: any,
    private config: SovereignGatewayConfig,
    private providerId: string,
    private getAuth: () => Promise<any>,
    private nativeFetch: typeof fetch
  ) {}

  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const fetchInputString = toUrlString(input);

    if (!isGenerativeLanguageRequest(fetchInputString)) {
      return this.nativeFetch(input, init);
    }

    let latestAuth = await this.getAuth();
    if (!isOAuthAuth(latestAuth)) {
      return this.nativeFetch(input, init);
    }

    const family = getModelFamilyFromUrl(fetchInputString);
    const model = extractModelFromUrl(fetchInputString);
    const headerStyle = fetchInputString.includes("gemini-cli") ? "gemini-cli" : "sovereign";
    let requestInit = stripInternalHeaders(init);
    const mockLatencyMs = getMockLatencyMs(init);
    let refreshAttempted = false;

    // Standard retry loop logic
    let attempts = 0;
    while (attempts < MAX_RETRY_ATTEMPTS) {
      if (mockLatencyMs > 0) {
        await sleep(mockLatencyMs, requestInit?.signal);
      }

      const response = await this.nativeFetch(input, requestInit);

      if (response.ok) {
        if (this.accountManager?.markAccountUsed) {
           const active = this.accountManager.getCurrentAccountForFamily?.(family);
           if (active) this.accountManager.markAccountUsed(active.index);
        }
        return response;
      }

      if (response.status === 429) {
        attempts++;
        const bodyInfo = await extractRetryInfoFromBody(response);
        const headerRetryMs = retryAfterMsFromResponse(response, 0);
        const retryAfterMs =
          headerRetryMs > 0 ? headerRetryMs : (bodyInfo.retryDelayMs ?? null);
        const reason = parseRateLimitReason(bodyInfo.reason, bodyInfo.message, response.status);

        // Strategy: Rotation over same-account retry
        if (this.accountManager?.getCurrentOrNextForFamily) {
          const current = this.accountManager.getCurrentAccountForFamily ? this.accountManager.getCurrentAccountForFamily(family) : null;
          if (current) {
            this.accountManager.markRateLimited(
              current,
              retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS,
              family,
              headerStyle,
              model,
            );
          }

          const next = this.accountManager.getCurrentOrNextForFamily(family, model, "round-robin", headerStyle);
          const nextAccessToken = getAccountAccessToken(next);
          if (next && nextAccessToken && next.index !== current?.index) {
            log.warn(`[Sovereign AI] 429 hit. Rotating from ${current?.email || 'unknown'} to ${next.email || next.index}`);

            requestInit = withAuthorizationHeader(requestInit, nextAccessToken);
            continue; // Immediate retry with new account
          }
        }

        const backoff = calculateBackoffMs(reason, attempts, retryAfterMs);
        log.warn(`Rate limit hit (429), retrying effort ${attempts} in ${backoff}ms...`);
        await sleep(backoff, requestInit?.signal);
        continue;
      }

      if (response.status === 401 && !refreshAttempted) {
        refreshAttempted = true;
        const locallyExpired = accessTokenExpired(latestAuth as any);
        log.info(
          `[Sovereign AI] Received 401${locallyExpired ? " for expired access token" : ""}, attempting refresh...`,
        );
        try {
          const refreshed = await refreshAccessToken(latestAuth as any, {} as any, this.providerId);
          const refreshedAccessToken = getAuthAccessToken(refreshed);
          if (!refreshed || !refreshedAccessToken) {
            return createGracefulErrorResponse(
              "OAuth token refresh failed: no refreshed access token was returned.",
              401,
            );
          }

          latestAuth = refreshed;
          requestInit = withAuthorizationHeader(requestInit, refreshedAccessToken);
          continue;
        } catch (error) {
          return createGracefulErrorResponse(
            `OAuth token refresh failed: ${toErrorMessage(error)}`,
            401,
          );
        }
      }

      // If not retriable, return as is
      return response;
    }

    return createGracefulErrorResponse("Max retry attempts reached", 429);
  }
}

function getMockLatencyMs(init?: RequestInit): number {
  const raw = new Headers(init?.headers).get(MOCK_LATENCY_HEADER);
  if (!raw) return 0;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function stripInternalHeaders(init?: RequestInit): RequestInit | undefined {
  if (!init?.headers) {
    return init;
  }

  const headers = new Headers(init.headers);
  if (!headers.has(MOCK_LATENCY_HEADER)) {
    return init;
  }

  headers.delete(MOCK_LATENCY_HEADER);
  return { ...init, headers };
}

function withAuthorizationHeader(init: RequestInit | undefined, accessToken: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...(init ?? {}), headers };
}

function getAccountAccessToken(account: unknown): string | null {
  if (!account || typeof account !== "object") {
    return null;
  }

  const candidate = account as { access?: unknown; accessToken?: unknown };
  if (typeof candidate.access === "string" && candidate.access.length > 0) {
    return candidate.access;
  }
  if (typeof candidate.accessToken === "string" && candidate.accessToken.length > 0) {
    return candidate.accessToken;
  }
  return null;
}

function getAuthAccessToken(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") {
    return null;
  }

  const candidate = auth as { access?: unknown; accessToken?: unknown };
  if (typeof candidate.access === "string" && candidate.access.length > 0) {
    return candidate.access;
  }
  if (typeof candidate.accessToken === "string" && candidate.accessToken.length > 0) {
    return candidate.accessToken;
  }
  return null;
}

function createGracefulErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Sovereign-Graceful-Error": "true",
    },
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}
