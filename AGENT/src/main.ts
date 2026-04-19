/**
 * Production entry point for the Sovereign AI Gateway.
 *
 * Differences from scripts/start-gateway.ts:
 *   - No dev-time token auto-generation. Required env vars must be set.
 *   - Structured boot logging (stdout JSON-ish via pino).
 *   - SIGTERM / SIGINT graceful shutdown.
 *   - Env-driven: all config via process.env, never via .env files (containers
 *     inject env; local dev uses scripts/start-gateway.ts which reads .env).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GatewayServer } from "./gateway/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    process.stderr.write(
      `[FATAL] Missing required env var: ${name}\n` +
      `        This is the production entry point; all config must be injected via environment.\n`,
    );
    process.exit(2);
  }
  return v;
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

async function main(): Promise<void> {
  const port = Number(optionalEnv("LOJINEXT_GATEWAY_PORT", "3000"));
  const host = optionalEnv("LOJINEXT_GATEWAY_HOST", "0.0.0.0");
  const authToken = requireEnv("LOJINEXT_GATEWAY_TOKEN");

  const server = new GatewayServer({
    port,
    host,
    projectRoot,
    authToken,
  });

  // Graceful shutdown: drain in-flight requests before exit.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[gateway] received ${signal}, shutting down...\n`);
    try {
      await Promise.race([
        server.stop(),
        new Promise<void>((resolve) => setTimeout(resolve, 10000)),
      ]);
    } catch (err) {
      process.stderr.write(`[gateway] stop() raised: ${String(err)}\n`);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Unhandled rejections / exceptions are fatal — log and exit so the
  // orchestrator (ECS, k8s) restarts us rather than letting us limp along.
  process.on("unhandledRejection", (err) => {
    process.stderr.write(`[gateway] unhandledRejection: ${String(err)}\n`);
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[gateway] uncaughtException: ${String(err)}\n`);
    process.exit(1);
  });

  await server.start();
  process.stdout.write(
    `[gateway] listening on http://${host}:${port} (projectRoot=${projectRoot})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[gateway] fatal boot error: ${String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  process.exit(1);
});
