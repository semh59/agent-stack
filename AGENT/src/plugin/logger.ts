/**
 * Structured Logger for Sovereign Plugin
 *
 * Provides TUI-integrated logging that is silent by default.
 * Logs are only visible when:
 * 1. TUI client is available (logs to app log panel)
 * 2. OPENCODE_SOVEREIGN_CONSOLE_LOG=1 is set (logs to console)
 *
 * Ported from opencode-google-Sovereign-auth/src/plugin/logger.ts
 */

import type { PluginClient } from "./types";

type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Redacts sensitive info (emails, potential TCKN/Phones) from strings.
 */
function maskPII(text: string): string {
  // Mask email: a***@b***.com
  let masked = text.replace(/([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})/g, (match, user, domain, tld) => {
    const maskedUser = user.length > 1 ? user[0] + '***' : '*';
    const maskedDomain = domain.length > 1 ? domain[0] + '***' : '*';
    return `${maskedUser}@${maskedDomain}.${tld}`;
  });

  // Mask potential IDs or Phones (simple regex for 10-11 digits)
  masked = masked.replace(/\b\d{10,11}\b/g, '[MASKED]');
  
  return masked;
}

const ENV_CONSOLE_LOG = "OPENCODE_SOVEREIGN_CONSOLE_LOG";
const SOVEREIGN_CONSOLE_PREFIX = "[Sovereign]";

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

let _client: PluginClient | null = null;

/**
 * Check if console logging is enabled via environment variable.
 */
function isConsoleLogEnabled(): boolean {
  const val = process.env[ENV_CONSOLE_LOG];
  return val === "1" || val?.toLowerCase() === "true";
}

/**
 * Initialize the logger with the plugin client.
 * Must be called during plugin initialization to enable TUI logging.
 */
export function initLogger(client: PluginClient): void {
  _client = client;
}

/**
 * Get the current client (for testing or advanced usage).
 */
export function getLoggerClient(): PluginClient | null {
  return _client;
}

/**
 * Create a logger instance for a specific module.
 *
 * @param module - The module name (e.g., "refresh-queue", "transform.claude")
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * ```typescript
 * const log = createLogger("refresh-queue");
 * log.debug("Checking tokens", { count: 5 });
 * log.warn("Token expired", { accountIndex: 0 });
 * ```
 */
export function createLogger(module: string): Logger {
  const service = `Sovereign.${module}`;

  const log = (level: LogLevel, message: string, extra?: Record<string, unknown>): void => {
    // Try TUI logging first
    const app = _client?.app;
    if (app && typeof app.log === "function") {
      const maskedMessage = maskPII(message);
      // Extra contains arbitrary data, we should attempt to mask it too if it contains strings
      const maskedExtra = extra ? JSON.parse(maskPII(JSON.stringify(extra))) : extra;
      
      app
        .log({
          body: { service, level, message: maskedMessage, extra: maskedExtra },
        })
        .catch(() => {
          // Silently ignore logging errors
        });
    } else if (isConsoleLogEnabled()) {
      // Fallback to console if env var is set
      const maskedMessage = maskPII(message);
      const maskedExtra = extra ? JSON.parse(maskPII(JSON.stringify(extra))) : extra;
      
      const prefix = `[${service}]`;
      const args = maskedExtra ? [prefix, maskedMessage, maskedExtra] : [prefix, maskedMessage];
      switch (level) {
        case "debug":
          console.debug(...args);
          break;
        case "info":
          console.info(...args);
          break;
        case "warn":
          console.warn(...args);
          break;
        case "error":
          console.error(...args);
          break;
      }
    }
    // If neither TUI nor console logging is enabled, log is silently discarded
  };

  return {
    debug: (message, extra) => log("debug", message, extra),
    info: (message, extra) => log("info", message, extra),
    warn: (message, extra) => log("warn", message, extra),
    error: (message, extra) => log("error", message, extra),
  };
}

/**
 * Print a message to the console with Sovereign prefix.
 * Only outputs when OPENCODE_SOVEREIGN_CONSOLE_LOG=1 is set.
 *
 * Use this for standalone messages that don't belong to a specific module.
 *
 * @param level - Log level
 * @param message - Message to print
 * @param extra - Optional extra data
 */
export function printSovereignConsole(
  level: LogLevel,
  message: string,
  extra?: unknown,
): void {
  if (!isConsoleLogEnabled()) {
    return;
  }

  const maskedMessage = maskPII(message);
  const prefixedMessage = `${SOVEREIGN_CONSOLE_PREFIX} ${maskedMessage}`;
  // Extra could be an error or object
  const maskedExtra = extra !== undefined ? (typeof extra === 'string' ? maskPII(extra) : JSON.parse(maskPII(JSON.stringify(extra)))) : undefined;
  
  const args = maskedExtra === undefined ? [prefixedMessage] : [prefixedMessage, maskedExtra];

  switch (level) {
    case "debug":
      console.debug(...args);
      break;
    case "info":
      console.info(...args);
      break;
    case "warn":
      console.warn(...args);
      break;
    case "error":
      console.error(...args);
      break;
  }
}
