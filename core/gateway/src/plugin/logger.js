"use strict";
/**
 * Structured Logger for Alloy Plugin
 *
 * Provides TUI-integrated logging that is silent by default.
 * Logs are only visible when:
 * 1. TUI client is available (logs to app log panel)
 * 2. Alloy_ALLOY_CONSOLE_LOG=1 is set (logs to console)
 *
 * Ported from Alloy-google-Alloy-auth/src/plugin/logger.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initLogger = initLogger;
exports.getLoggerClient = getLoggerClient;
exports.createLogger = createLogger;
exports.printAlloyConsole = printAlloyConsole;
/**
 * Redacts sensitive info (emails, potential TCKN/Phones) from strings.
 */
function maskPII(text) {
    // Mask email: a***@b***.com
    let masked = text.replace(/([a-zA-Z0-9_\-.]+)@([a-zA-Z0-9_\-.]+)\.([a-zA-Z]{2,5})/g, (match, user, domain, tld) => {
        const maskedUser = user.length > 1 ? user[0] + '***' : '*';
        const maskedDomain = domain.length > 1 ? domain[0] + '***' : '*';
        return `${maskedUser}@${maskedDomain}.${tld}`;
    });
    // Mask potential IDs or Phones (simple regex for 10-11 digits)
    masked = masked.replace(/\b\d{10,11}\b/g, '[MASKED]');
    return masked;
}
const ENV_CONSOLE_LOG = "Alloy_ALLOY_CONSOLE_LOG";
const ALLOY_CONSOLE_PREFIX = "[Alloy]";
let _client = null;
/**
 * Check if console logging is enabled via environment variable.
 */
function isConsoleLogEnabled() {
    const val = process.env[ENV_CONSOLE_LOG];
    return val === "1" || val?.toLowerCase() === "true";
}
/**
 * Initialize the logger with the plugin client.
 * Must be called during plugin initialization to enable TUI logging.
 */
function initLogger(client) {
    _client = client;
}
/**
 * Get the current client (for testing or advanced usage).
 */
function getLoggerClient() {
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
function createLogger(module) {
    const service = `Alloy.${module}`;
    const log = (level, message, extra) => {
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
        }
        else if (isConsoleLogEnabled()) {
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
 * Print a message to the console with Alloy prefix.
 * Only outputs when Alloy_ALLOY_CONSOLE_LOG=1 is set.
 *
 * Use this for standalone messages that don't belong to a specific module.
 *
 * @param level - Log level
 * @param message - Message to print
 * @param extra - Optional extra data
 */
function printAlloyConsole(level, message, extra) {
    if (!isConsoleLogEnabled()) {
        return;
    }
    const maskedMessage = maskPII(message);
    const prefixedMessage = `${ALLOY_CONSOLE_PREFIX} ${maskedMessage}`;
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
//# sourceMappingURL=logger.js.map