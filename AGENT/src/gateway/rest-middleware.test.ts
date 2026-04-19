import fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayAuthManager } from "./gateway-auth-manager";
import {
  RATE_LIMIT_MAX_REQUESTS,
  createApproveAuthMiddleware,
  registerFormatWrapperMiddleware,
  registerRateLimitMiddleware,
} from "./rest-middleware";
import { apiError } from "./rest-response";
import { MissionServiceError } from "../services/mission.service";

async function createApp(options?: { maxRequests?: number; windowMs?: number }) {
  const app = fastify();
  registerFormatWrapperMiddleware(app);
  if (options) {
    registerRateLimitMiddleware(app, options);
  }

  app.get("/api/raw", async () => ({ ok: true }));
  app.get("/ws/ping", async () => ({ ok: true }));
  app.get("/api/error/not-found", async () => {
    throw new MissionServiceError("MISSION_NOT_FOUND", "Mission missing");
  });
  app.get("/api/error/invalid-transition", async () => {
    throw new MissionServiceError("INVALID_STATE_TRANSITION", "Transition blocked");
  });
  app.setNotFoundHandler(async (request, reply) => {
    const url = request.raw.url ?? "";
    if (url.startsWith("/api/")) {
      return reply.status(404).send(
        apiError(`Route ${request.method}:${url} not found`, {
          code: "ROUTE_NOT_FOUND",
        }),
      );
    }
    return reply.status(404).type("text/plain").send("Not Found");
  });

  await app.ready();
  return app;
}

describe("rest middleware", () => {
  const apps = new Set<Awaited<ReturnType<typeof createApp>>>();

  afterEach(async () => {
    for (const app of apps) {
      await app.close();
    }
    apps.clear();
  });

  it("wraps raw REST responses with request metadata", async () => {
    const app = await createApp();
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/raw",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data?: { ok?: boolean };
      meta?: { requestId?: string; timestamp?: string };
      errors?: unknown[];
    };
    expect(body.data).toEqual({ ok: true });
    expect(body.errors).toEqual([]);
    expect(typeof body.meta?.requestId).toBe("string");
    expect(typeof body.meta?.timestamp).toBe("string");
  });

  it("maps mission service errors to 404 and 422 envelopes", async () => {
    const app = await createApp();
    apps.add(app);

    const notFoundResponse = await app.inject({
      method: "GET",
      url: "/api/error/not-found",
    });
    expect(notFoundResponse.statusCode).toBe(404);
    expect(notFoundResponse.json()).toMatchObject({
      data: null,
      errors: [{ code: "MISSION_NOT_FOUND", message: "Mission missing" }],
    });

    const invalidTransitionResponse = await app.inject({
      method: "GET",
      url: "/api/error/invalid-transition",
    });
    expect(invalidTransitionResponse.statusCode).toBe(422);
    expect(invalidTransitionResponse.json()).toMatchObject({
      data: null,
      errors: [{ code: "INVALID_STATE_TRANSITION", message: "Transition blocked" }],
    });
  });

  it("wraps unknown api routes with ROUTE_NOT_FOUND", async () => {
    const app = await createApp();
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/unknown",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      data: null,
      errors: [{ code: "ROUTE_NOT_FOUND" }],
    });
  });

  it("uses x-api-key as the primary rate-limit identity", async () => {
    const app = await createApp({ maxRequests: 2, windowMs: 60_000 });
    apps.add(app);

    await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { "x-api-key": "alpha" },
    });
    await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { "x-api-key": "alpha" },
    });
    const limited = await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { "x-api-key": "alpha" },
    });
    const isolated = await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { "x-api-key": "beta" },
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("2");
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
    expect(limited.headers["retry-after"]).toBeDefined();
    const limitedBody = limited.json() as {
      data: null;
      errors: Array<{ code?: string; retryAfter?: number }>;
    };
    expect(limitedBody).toMatchObject({
      data: null,
      errors: [{ code: "RATE_LIMIT" }],
    });
    expect(limitedBody.errors[0]?.retryAfter).toBeGreaterThanOrEqual(1);
    expect(isolated.statusCode).toBe(200);
  });

  it("falls back to bearer token buckets when x-api-key is absent", async () => {
    const app = await createApp({ maxRequests: 1, windowMs: 60_000 });
    apps.add(app);

    const first = await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { Authorization: "Bearer token-a" },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { Authorization: "Bearer token-a" },
    });
    const isolated = await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { Authorization: "Bearer token-b" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(isolated.statusCode).toBe(200);
  });

  it("shares the anonymous bucket across unauthenticated clients", async () => {
    const app = await createApp({ maxRequests: 1, windowMs: 60_000 });
    apps.add(app);

    const first = await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { "user-agent": "browser" },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/raw",
      headers: { "user-agent": "telegram" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      data: null,
      errors: [{ code: "RATE_LIMIT" }],
    });
  });

  it("does not rate-limit non-api paths", async () => {
    const app = await createApp({ maxRequests: 1, windowMs: 60_000 });
    apps.add(app);

    const first = await app.inject({
      method: "GET",
      url: "/ws/ping",
    });
    const second = await app.inject({
      method: "GET",
      url: "/ws/ping",
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("keeps the default gateway rate limit at 100 requests per minute", () => {
    expect(RATE_LIMIT_MAX_REQUESTS).toBe(100);
  });

  it("requires explicit bearer auth for approve middleware", async () => {
    const app = fastify();
    registerFormatWrapperMiddleware(app);

    const authManager = new GatewayAuthManager("approve-secret");
    app.post(
      "/api/missions/:id/approve",
      {
        preHandler: createApproveAuthMiddleware(authManager),
      },
      async () => ({ approved: true }),
    );
    await app.ready();
    apps.add(app);

    const noAuth = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
    });
    const queryToken = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve?token=approve-secret",
    });
    const apiKeyOnly = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
      headers: { "x-api-key": "client-key" },
    });
    const localOriginOnly = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
      headers: { Origin: "http://127.0.0.1:3000" },
    });
    const authorized = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
      headers: { Authorization: "Bearer approve-secret" },
    });

    for (const response of [noAuth, queryToken, apiKeyOnly, localOriginOnly]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        data: null,
        errors: [{ code: "UNAUTHORIZED", message: "Unauthorized" }],
      });
    }

    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({
      data: { approved: true },
      errors: [],
    });
  });
});
