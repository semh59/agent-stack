/**
 * Optimize Route â€” Gateway â†’ Optimization Bridge
 *
 * Proxies optimization requests from the TypeScript Gateway
 * to the Python optimization engine via the HTTP bridge.
 *
 * Route: POST /api/optimize
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { apiResponse, apiError } from "../rest-response";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface OptimizeRequestBody {
  message: string;
  context_messages?: string[];
  force_layers?: string[];
}

interface OptimizeResponse {
  optimized: string;
  savings_percent: number;
  cache_hit: boolean;
  layers: string[];
  model: string;
  tokens: {
    original: number;
    sent: number;
  };
  metadata: Record<string, unknown>;
}

interface BridgeConfig {
  host: string;
  port: number;
  secret: string;
}

// â”€â”€â”€ Default Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  host: process.env.ALLOY_BRIDGE_HOST ?? "127.0.0.1",
  port: parseInt(process.env.ALLOY_BRIDGE_PORT ?? "9100", 10),
  secret: process.env.ALLOY_BRIDGE_SECRET ?? "",
};

// â”€â”€â”€ Bridge Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class OptimizationBridge {
  private readonly baseUrl: string;
  private readonly secret: string;
  private healthy = false;
  private lastHealthCheck = 0;
  private readonly healthCheckIntervalMs = 30_000; // 30s

  constructor(config: BridgeConfig = DEFAULT_BRIDGE_CONFIG) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.secret = config.secret;
  }

  /** Check bridge health (cached for 30s) */
  async isHealthy(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckIntervalMs) {
      return this.healthy;
    }

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      this.healthy = response.ok;
    } catch {
      this.healthy = false;
    }
    this.lastHealthCheck = now;
    return this.healthy;
  }

  /** Call a bridge endpoint */
  async call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    opts?: { requestId?: string; timeoutMs?: number },
  ): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.secret) {
      headers["X-Bridge-Secret"] = this.secret;
    }
    if (opts?.requestId) {
      // Propagate correlation ID so bridge logs can be joined with gateway logs.
      headers["X-Request-ID"] = opts.requestId;
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts?.timeoutMs ?? 30_000),
      });

      const data = (await response.json()) as T;

      if (!response.ok) {
        return {
          ok: false,
          error: (typeof (data as Record<string, unknown>)?.error === "string" ? (data as Record<string, unknown>).error : undefined) as string | undefined ?? `Bridge returned ${response.status}`,
          status: response.status,
        };
      }

      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as { name?: string })?.name === "TimeoutError" ? 504 : 503;
      return { ok: false, error: `Bridge unreachable: ${message}`, status };
    }
  }
}

// â”€â”€â”€ Singleton Bridge Instance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const bridge = new OptimizationBridge();

// â”€â”€â”€ Route Registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Extract (or mint) a correlation ID for a request. Gateway echoes the same ID
 * back via the Fastify response so clients, gateway logs, and bridge logs can
 * all be joined on a single field.
 */
function getRequestId(request: FastifyRequest, reply: FastifyReply): string {
  const existing =
    (request.headers["x-request-id"] as string | undefined) ||
    (request.id as unknown as string | undefined);
  const rid = existing ?? `req_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  reply.header("x-request-id", rid);
  return rid;
}

export function registerOptimizeRoutes(app: FastifyInstance): void {
  // â”€â”€ POST /api/optimize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.post<{ Body: OptimizeRequestBody }>(
    "/api/optimize",
    async (request, reply) => {
      const { message, context_messages, force_layers } = request.body ?? {};
      const rid = getRequestId(request, reply);

      if (!message || typeof message !== "string") {
        return reply.status(400).send(apiError("message is required"));
      }

      const result = await bridge.call<OptimizeResponse>(
        "POST",
        "/optimize",
        {
          message,
          context_messages: context_messages ?? [],
          force_layers: force_layers ?? null,
        },
        { requestId: rid },
      );

      if (!result.ok) {
        return reply.status(result.status).send(
          apiError(result.error, { code: "OPTIMIZATION_FAILED" }),
        );
      }

      return apiResponse(result.data);
    },
  );

  // â”€â”€ GET /api/optimize/status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get("/api/optimize/status", async (request, reply) => {
    const rid = getRequestId(request as FastifyRequest, reply);
    const result = await bridge.call<Record<string, string>>(
      "GET",
      "/status",
      undefined,
      { requestId: rid },
    );

    if (!result.ok) {
      return reply.status(result.status).send(
        apiError(result.error, { code: "BRIDGE_UNAVAILABLE" }),
      );
    }

    return apiResponse({
      bridge: "connected",
      ...result.data,
    });
  });

  // â”€â”€ GET /api/optimize/cache-stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get("/api/optimize/cache-stats", async (_request, reply) => {
    const result = await bridge.call<Record<string, unknown>>("GET", "/cache-stats");

    if (!result.ok) {
      return reply.status(result.status).send(
        apiError(result.error, { code: "BRIDGE_UNAVAILABLE" }),
      );
    }

    return apiResponse(result.data);
  });

  // â”€â”€ POST /api/optimize/cache-clear â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.post<{ Body: { tier?: string } }>(
    "/api/optimize/cache-clear",
    async (request, reply) => {
      const tier = request.body?.tier ?? "all";

      const result = await bridge.call<{ cleared: string[] }>("POST", "/cache-clear", {
        tier,
      });

      if (!result.ok) {
        return reply.status(result.status).send(
          apiError(result.error, { code: "BRIDGE_UNAVAILABLE" }),
        );
      }

      return apiResponse(result.data);
    },
  );

  // â”€â”€ GET /api/optimize/cost-report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get<{ Querystring: { period?: string } }>(
    "/api/optimize/cost-report",
    async (request, reply) => {
      const period = (request.query as Record<string, string>).period ?? "today";
      const result = await bridge.call<Record<string, unknown>>(
        "GET",
        `/cost-report?period=${encodeURIComponent(period)}`,
      );

      if (!result.ok) {
        return reply.status(result.status).send(
          apiError(result.error, { code: "BRIDGE_UNAVAILABLE" }),
        );
      }

      return apiResponse(result.data);
    },
  );

  // â”€â”€ GET /api/optimize/health â€” Bridge health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get("/api/optimize/health", async (_request, reply) => {
    const healthy = await bridge.isHealthy();
    const status = healthy ? 200 : 503;
    return reply.status(status).send(
      apiResponse({
        bridge: healthy ? "ok" : "unavailable",
        bridgeUrl: `${DEFAULT_BRIDGE_CONFIG.host}:${DEFAULT_BRIDGE_CONFIG.port}`,
      }),
    );
  });
}
