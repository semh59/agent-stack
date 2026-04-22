import type { FastifyInstance } from "fastify";
import { apiResponse } from "../../gateway/rest-response";
import type { ForensicPrivacyLedger } from "../../orchestration/privacy/ForensicPrivacyLedger";

export interface PrivacyRouteDependencies {
  ledger: ForensicPrivacyLedger;
}

/**
 * Privacy Router: Provides live telemetry streams of privacy events.
 */
export function registerPrivacyRoutes(app: FastifyInstance, dependencies: PrivacyRouteDependencies): void {
  const { ledger } = dependencies;

  // 1. Get Audit Trail
  app.get("/api/privacy/audit", async () => {
    return apiResponse(ledger.getFullAuditTrail());
  });

  // 2. Privacy SSE Stream
  app.get("/api/privacy/stream", async (request, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");

    // Push initial audit trail
    const history = ledger.getFullAuditTrail();
    reply.raw.write(`data: ${JSON.stringify({ type: 'INIT', history })}\n\n`);

    // In a real production scenario, we'd use an EventEmitter here.
    // For Phase 13 Hardening, we'll simulate a heartbeat that checks for new logs.
    let lastLength = history.length;
    const interval = setInterval(() => {
      const current = ledger.getFullAuditTrail();
      if (current.length > lastLength) {
        const newLogs = current.slice(lastLength);
        reply.raw.write(`data: ${JSON.stringify({ type: 'UPDATE', logs: newLogs })}\n\n`);
        lastLength = current.length;
      } else {
        reply.raw.write(`data: ${JSON.stringify({ type: 'HEARTBEAT', timestamp: new Date().toISOString() })}\n\n`);
      }
    }, 2000);

    request.raw.on("close", () => {
      clearInterval(interval);
    });
  });
}
