import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { apiError, isApiEnvelope, mapErrorToApi, normalizeApiEnvelope } from "./rest-response";
import type { GatewayAuthManager } from "./gateway-auth-manager";

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 100;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RestRateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  now?: () => number;
}

function pathFromRequest(request: FastifyRequest): string {
  const rawUrl = request.raw.url ?? "";
  return rawUrl.split("?")[0] ?? rawUrl;
}

function isApiPath(path: string): boolean {
  return path.startsWith("/api/");
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

function hashIdentity(prefix: string, value: string): string {
  return `${prefix}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function extractBearerToken(request: FastifyRequest): string {
  const authHeader = getHeaderValue(request.headers.authorization);
  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice("Bearer ".length).trim();
}

function resolveRateLimitBucket(request: FastifyRequest): string {
  const apiKey = getHeaderValue(request.headers["x-api-key"] as string | string[] | undefined);
  if (apiKey) {
    return hashIdentity("api-key", apiKey);
  }

  const bearerToken = extractBearerToken(request);
  if (bearerToken) {
    return hashIdentity("bearer", bearerToken);
  }

  return "anonymous";
}

export function registerFormatWrapperMiddleware(app: FastifyInstance): void {
  app.setErrorHandler(async (error, request, reply) => {
    if (pathFromRequest(request).startsWith("/ws/")) {
      reply.status((error as { statusCode?: number }).statusCode ?? 500);
      return error;
    }

    const mapped = mapErrorToApi(error);
    return reply.status(mapped.statusCode).send(
      apiError(mapped.message, {
        code: mapped.code,
        meta: mapped.meta,
      }),
    );
  });

  app.addHook("preSerialization", async (request, reply, payload) => {
    const path = pathFromRequest(request);
    if (!isApiPath(path) && !isApiEnvelope(payload)) {
      return payload;
    }

    return normalizeApiEnvelope(request.id, reply.statusCode, payload);
  });
}

/**
 * Sliding-window rate limiter.
 * This implementation tracks requests in 1-minute buckets and calculates the windowed
 * usage across the current and previous minute to provide smooth limiting.
 */
export function registerRateLimitMiddleware(
  app: FastifyInstance,
  options: RestRateLimitOptions = {},
): void {
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
  const now = options.now ?? (() => Date.now());
  
  // Storage for rate limit buckets: identity -> { [timestampAtMinuteStart]: count }
  const state = new Map<string, Record<number, number>>();

  // Cleanup interval to prevent memory leaks from stale identities
  setInterval(() => {
    const currentWindowStart = Math.floor(now() / windowMs) * windowMs;
    const expirationThreshold = currentWindowStart - (windowMs * 2);
    
    for (const [identity, buckets] of state.entries()) {
      let active = false;
      for (const timestampStr of Object.keys(buckets)) {
        const timestamp = Number(timestampStr);
        if (timestamp < expirationThreshold) {
          delete buckets[timestamp];
        } else {
          active = true;
        }
      }
      if (!active) {
        state.delete(identity);
      }
    }
  }, Math.max(10_000, Math.min(windowMs, 5 * 60_000))).unref();

  app.addHook("onRequest", async (request, reply) => {
    const path = pathFromRequest(request);
    if (!isApiPath(path)) {
      return;
    }

    const identity = resolveRateLimitBucket(request);
    const currentTime = now();
    const currentWindowStart = Math.floor(currentTime / windowMs) * windowMs;
    const previousWindowStart = currentWindowStart - windowMs;

    // Ensure bucket exists for this identity
    let buckets = state.get(identity);
    if (!buckets) {
      buckets = {};
      state.set(identity, buckets);
    }

    // Increment current bucket
    buckets[currentWindowStart] = (buckets[currentWindowStart] ?? 0) + 1;

    // Calculate sliding window usage
    const currentCount = buckets[currentWindowStart];
    const previousCount = buckets[previousWindowStart] ?? 0;
    
    // Weight the previous window based on how far we are into the current window
    const windowElapsedRatio = (currentTime % windowMs) / windowMs;
    const slidingUsage = (previousCount * (1 - windowElapsedRatio)) + currentCount;

    const remaining = Math.max(0, Math.floor(maxRequests - slidingUsage));
    reply.header("X-RateLimit-Limit", maxRequests);
    reply.header("X-RateLimit-Remaining", remaining);
    reply.header("X-RateLimit-Reset", Math.ceil((currentWindowStart + windowMs) / 1000));

    if (slidingUsage > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (currentTime % windowMs)) / 1000));
      reply.header("Retry-After", retryAfter);
      
      request.log.warn({ identity, slidingUsage, path }, "Rate limit exceeded");
      
      return reply.status(429).send(
        apiError("Too many requests. Please slow down.", {
          code: "RATE_LIMIT",
          details: { retryAfter, limit: maxRequests },
        }),
      );
    }
  });
}

export function createApproveAuthMiddleware(
  authManager: Pick<GatewayAuthManager, "isAuthorized">,
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const bearerToken = extractBearerToken(request);
    if (!bearerToken || !authManager.isAuthorized(bearerToken)) {
      return reply.status(401).send(
        apiError("Unauthorized", {
          code: "UNAUTHORIZED",
        }),
      );
    }
  };
}
