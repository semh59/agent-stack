/**
 * Metro Health API — Production-grade REST/SSE endpoints for the Metro Watchdog system.
 *
 * Provides real-time health status for all communication lines,
 * alert management with acknowledgement, line history queries,
 * and Server-Sent Events (SSE) streaming for live dashboard updates.
 *
 * ## Endpoints
 * - `GET  /api/metro/health`              — Current health snapshot
 * - `GET  /api/metro/health/stream`        — SSE live health stream
 * - `GET  /api/metro/alerts`               — Active alerts with filtering
 * - `POST /api/metro/alerts/:id/acknowledge` — Acknowledge an alert
 * - `GET  /api/metro/lines/:lineId/history`  — Per-line health history
 * - `GET  /api/metro/metrics`              — Watchdog operational metrics
 *
 * @module metro-router
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { apiResponse, apiError } from "../../gateway/rest-response";
import type { MetroWatchdog, MetroLineId } from "../../gateway/metro-watchdog";
import { GlobalEventBus } from "../../gateway/event-bus";

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

/** Valid metro line identifiers for parameter validation. */
const VALID_LINE_IDS: readonly string[] = [
  "event_bus",
  "rest_api",
  "ws_sse",
  "vscode",
  "mcp",
];

/** Maximum number of concurrent SSE connections. */
const MAX_SSE_CONNECTIONS = 20;

/** Interval for SSE snapshot push (ms). */
const SSE_PUSH_INTERVAL_MS = 5_000;

/** Maximum history limit per request. */
const MAX_HISTORY_LIMIT = 200;

/** Default history limit per request. */
const DEFAULT_HISTORY_LIMIT = 20;

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/** Dependency injection container for the metro router. */
export interface MetroRouterDeps {
  /** Factory function that returns the current MetroWatchdog instance (or null). */
  getWatchdog: () => MetroWatchdog | null;
}

/** Tracked SSE connection for cleanup. */
interface SseConnection {
  /** Interval handle for periodic snapshot push. */
  intervalHandle: ReturnType<typeof setInterval>;
  /** Timestamp when the connection was established. */
  connectedAt: number;
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

/**
 * Resolves the watchdog instance or sends a 503 error if unavailable.
 *
 * @returns The watchdog instance, or null if an error response was sent.
 */
function resolveWatchdog(
  getWatchdog: MetroRouterDeps["getWatchdog"],
  reply: FastifyReply,
): MetroWatchdog | null {
  const watchdog = getWatchdog();
  if (!watchdog) {
    reply.status(503).send(
      apiError("Metro Watchdog not initialized", { code: "WATCHDOG_NOT_READY" }),
    );
    return null;
  }
  return watchdog;
}

/**
 * Validates and sanitizes a lineId path parameter.
 *
 * @returns The validated MetroLineId, or null if an error response was sent.
 */
function validateLineId(
  rawLineId: string,
  reply: FastifyReply,
): MetroLineId | null {
  if (!VALID_LINE_IDS.includes(rawLineId)) {
    reply.status(400).send(
      apiError(
        `Invalid line ID: '${rawLineId}'. Valid values: ${VALID_LINE_IDS.join(", ")}`,
        { code: "INVALID_LINE_ID", validValues: VALID_LINE_IDS },
      ),
    );
    return null;
  }
  return rawLineId as MetroLineId;
}

/**
 * Parses and clamps a numeric query parameter.
 *
 * @param rawValue - The raw query string value.
 * @param defaultValue - Default value if the parameter is missing.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns The clamped integer value.
 */
function parseClampedInt(
  rawValue: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (!rawValue) return defaultValue;
  const parsed = parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(min, Math.min(parsed, max));
}

/**
 * Parses a boolean query parameter.
 * Returns true only if the value is exactly "true".
 */
function parseBooleanParam(rawValue: string | undefined): boolean {
  return rawValue === "true";
}

// ════════════════════════════════════════════════════════════════════════
// Active SSE Connection Tracker
// ════════════════════════════════════════════════════════════════════════

/** Tracks active SSE connections to enforce concurrency limits. */
const activeSseConnections = new Map<number, SseConnection>();

/**
 * Returns the current number of active SSE connections.
 * Exported so the MetroWatchdog can use it for direct WS/SSE health measurement.
 */
export function getSseConnectionCount(): number {
  return activeSseConnections.size;
}

// ════════════════════════════════════════════════════════════════════════
// Route Registration
// ════════════════════════════════════════════════════════════════════════

/**
 * Registers all Metro Watchdog REST and SSE routes on the Fastify instance.
 *
 * @param app - The Fastify application instance.
 * @param deps - Dependency injection container.
 */
export function registerMetroRoutes(app: FastifyInstance, deps: MetroRouterDeps): void {
  const { getWatchdog } = deps;

  // ─── GET /api/metro/health — Full network snapshot ─────────────
  app.get("/api/metro/health", async (_request, reply) => {
    const watchdog = resolveWatchdog(getWatchdog, reply);
    if (!watchdog) return;

    const snapshot = watchdog.getSnapshot();
    if (!snapshot) {
      return reply.status(503).send(
        apiError("Health snapshot not yet available — first check cycle pending", {
          code: "SNAPSHOT_PENDING",
        }),
      );
    }

    return reply.send(apiResponse(snapshot));
  });

  // ─── GET /api/metro/metrics — Operational metrics ──────────────
  app.get("/api/metro/metrics", async (_request, reply) => {
    const watchdog = resolveWatchdog(getWatchdog, reply);
    if (!watchdog) return;

    return reply.send(apiResponse({
      metrics: watchdog.getMetrics(),
      isRunning: watchdog.isRunning,
      sseConnections: getSseConnectionCount(),
    }));
  });

  // ─── GET /api/metro/alerts — Alert listing ─────────────────────
  app.get("/api/metro/alerts", async (request, reply) => {
    const watchdog = resolveWatchdog(getWatchdog, reply);
    if (!watchdog) return;

    const query = request.query as Record<string, string> | undefined;
    const includeAcknowledged = parseBooleanParam(query?.includeAcknowledged);
    const severity = query?.severity as string | undefined;

    let alerts = watchdog.getAlerts(includeAcknowledged);

    // Optional severity filter
    if (severity && ["critical", "warning", "info"].includes(severity)) {
      alerts = alerts.filter((a) => a.severity === severity);
    }

    // Separate counts for quick overview
    const counts = {
      critical: alerts.filter((a) => a.severity === "critical" && !a.acknowledged).length,
      warning: alerts.filter((a) => a.severity === "warning" && !a.acknowledged).length,
      info: alerts.filter((a) => a.severity === "info" && !a.acknowledged).length,
    };

    return reply.send(apiResponse({
      alerts,
      total: alerts.length,
      counts,
    }));
  });

  // ─── POST /api/metro/alerts/:id/acknowledge ────────────────────
  app.post<{ Params: { id: string } }>(
    "/api/metro/alerts/:id/acknowledge",
    async (request, reply) => {
      const watchdog = resolveWatchdog(getWatchdog, reply);
      if (!watchdog) return;

      const alertId = request.params.id;

      if (!alertId || !alertId.startsWith("alert-")) {
        return reply.status(400).send(
          apiError(`Invalid alert ID format: '${alertId}'`, {
            code: "INVALID_ALERT_ID",
          }),
        );
      }

      const acknowledged = watchdog.acknowledgeAlert(alertId);

      if (!acknowledged) {
        return reply.status(404).send(
          apiError(`Alert '${alertId}' not found or already acknowledged`, {
            code: "ALERT_NOT_FOUND",
          }),
        );
      }

      return reply.send(apiResponse({
        acknowledged: true,
        alertId,
        timestamp: new Date().toISOString(),
      }));
    },
  );

  // ─── GET /api/metro/lines/:lineId/history ──────────────────────
  app.get<{ Params: { lineId: string } }>(
    "/api/metro/lines/:lineId/history",
    async (request, reply) => {
      const watchdog = resolveWatchdog(getWatchdog, reply);
      if (!watchdog) return;

      const lineId = validateLineId(request.params.lineId, reply);
      if (!lineId) return;

      const query = request.query as Record<string, string> | undefined;
      const limit = parseClampedInt(query?.limit, DEFAULT_HISTORY_LIMIT, 1, MAX_HISTORY_LIMIT);

      const history = watchdog.getLineHistory(lineId, limit);

      return reply.send(apiResponse({
        lineId,
        limit,
        count: history.length,
        history,
      }));
    },
  );

  // ─── POST /api/metro/ui-event — Extension UI event forwarding ──
  app.post<{ Body: { type?: string; source?: string; action?: string; [key: string]: unknown } }>(
    "/api/metro/ui-event",
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body.type !== "string") {
        return reply.status(400).send(
          apiError("Missing required field: type", { code: "INVALID_UI_EVENT" }),
        );
      }

      const event = {
        type: body.type,
        id: Date.now(),
        time: new Date().toISOString(),
        source: body.source ?? "vscode-extension",
        action: body.action,
        ...body,
      };

      // Emit to GlobalEventBus so MetroWatchdog's VS Code line can detect it via replayBuffer
      GlobalEventBus.emit(event as any);

      return reply.send(apiResponse({ received: true, eventType: body.type }));
    },
  );

  // ─── GET /api/metro/health/stream — SSE live stream ────────────
  app.get("/api/metro/health/stream", async (request, reply) => {
    const watchdog = resolveWatchdog(getWatchdog, reply);
    if (!watchdog) return;

    // Enforce maximum concurrent SSE connections
    if (getSseConnectionCount() >= MAX_SSE_CONNECTIONS) {
      return reply.status(429).send(
        apiError(`Maximum SSE connections (${MAX_SSE_CONNECTIONS}) reached`, {
          code: "SSE_CAPACITY_EXCEEDED",
        }),
      );
    }

    // Set SSE response headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    // Send an initial comment to establish the connection
    reply.raw.write(": connected\n\n");

    /**
     * Sends the current health snapshot as an SSE data frame.
     * Only sends if the snapshot exists to avoid empty frames.
     */
    const pushSnapshot = (): void => {
      const snapshot = watchdog.getSnapshot();
      if (snapshot) {
        const payload = JSON.stringify(snapshot);
        reply.raw.write(`data: ${payload}\n\n`);
      }
    };

    // Push the current snapshot immediately
    pushSnapshot();

    // Set up periodic push interval
    const connectionId = Date.now();
    const intervalHandle = setInterval(pushSnapshot, SSE_PUSH_INTERVAL_MS);

    // Track the connection
    activeSseConnections.set(connectionId, {
      intervalHandle,
      connectedAt: connectionId,
    });

    // Clean up on client disconnect
    const cleanup = (): void => {
      clearInterval(intervalHandle);
      activeSseConnections.delete(connectionId);
    };

    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);

    // Keep the connection open indefinitely
    await new Promise<void>((resolve) => {
      request.raw.on("close", () => resolve());
    });
  });
}