import * as net from "node:net";
import { URL } from "node:url";
import { ANTIGRAVITY_REDIRECT_URI } from "../constants";

export const DEFAULT_OAUTH_CALLBACK_PORT = (() => {
  try {
    const parsed = new URL(ANTIGRAVITY_REDIRECT_URI);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isFinite(port) && port > 0 ? port : 51121;
  } catch {
    return 51121;
  }
})();

export interface OAuthPortCheckResult {
  available: boolean;
  code?: "EADDRINUSE" | "EACCES" | "UNKNOWN";
  message?: string;
}

export async function checkOAuthCallbackPortAvailability(
  port: number,
  host = "127.0.0.1",
): Promise<OAuthPortCheckResult> {
  return await new Promise<OAuthPortCheckResult>((resolve) => {
    const server = net.createServer();
    let settled = false;

    const finish = (result: OAuthPortCheckResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    server.once("error", (err: NodeJS.ErrnoException) => {
      const code =
        err.code === "EADDRINUSE" || err.code === "EACCES" ? err.code : "UNKNOWN";
      finish({
        available: false,
        code,
        message: err.message,
      });
    });

    server.once("listening", () => {
      server.close(() => {
        finish({ available: true });
      });
    });

    server.listen(port, host);
  });
}

