"use strict";
/**
 * Configuration loader for alloy-ai plugin.
 *
 * Loads config from files with environment variable overrides.
 * Priority (lowest to highest):
 * 1. Schema defaults
 * 2. User config file
 * 3. Project config file
 * 4. Environment variables
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserConfigPath = getUserConfigPath;
exports.getProjectConfigPath = getProjectConfigPath;
exports.loadConfig = loadConfig;
exports.configExists = configExists;
exports.getDefaultLogsDir = getDefaultLogsDir;
exports.initRuntimeConfig = initRuntimeConfig;
exports.getKeepThinking = getKeepThinking;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const schema_1 = require("./schema");
const logger_1 = require("../logger");
const log = (0, logger_1.createLogger)("config");
// =============================================================================
// Path Utilities
// =============================================================================
/**
 * Get the config directory path, with the following precedence:
 * 1. Alloy_CONFIG_DIR env var (if set)
 * 2. ~/.config/Alloy (all platforms, including Windows)
 */
function getConfigDir() {
    // 1. Check for explicit override via env var
    if (process.env.ALLOY_CONFIG_DIR) {
        return process.env.ALLOY_CONFIG_DIR;
    }
    // 2. Use ~/.config/Alloy on all platforms (including Windows)
    const xdgConfig = process.env.XDG_CONFIG_HOME || (0, node_path_1.join)((0, node_os_1.homedir)(), ".config");
    return (0, node_path_1.join)(xdgConfig, "Alloy");
}
/**
 * Get the user-level config file path.
 */
function getUserConfigPath() {
    return (0, node_path_1.join)(getConfigDir(), "Alloy.json");
}
/**
 * Get the project-level config file path.
 */
function getProjectConfigPath(directory) {
    return (0, node_path_1.join)(directory, ".Alloy", "Alloy.json");
}
// =============================================================================
// Config Loading
// =============================================================================
/**
 * Load and parse a config file, returning null if not found or invalid.
 */
function loadConfigFile(path) {
    try {
        if (!(0, node_fs_1.existsSync)(path)) {
            return null;
        }
        const content = (0, node_fs_1.readFileSync)(path, "utf-8");
        const rawConfig = JSON.parse(content);
        // Validate with Zod (partial - we'll merge with defaults later)
        const result = schema_1.AlloyGatewayConfigSchema.partial().safeParse(rawConfig);
        if (!result.success) {
            log.warn("Config validation error", {
                path,
                issues: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "),
            });
            return null;
        }
        return result.data;
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            log.warn("Invalid JSON in config file", { path, error: error.message });
        }
        else {
            log.warn("Failed to load config file", { path, error: String(error) });
        }
        return null;
    }
}
/**
 * Deep merge two config objects, with override taking precedence.
 */
function mergeConfigs(base, override) {
    return {
        ...base,
        ...override,
        // Deep merge signature_cache if both exist
        signature_cache: override.signature_cache
            ? {
                ...base.signature_cache,
                ...override.signature_cache,
            }
            : base.signature_cache,
    };
}
/**
 * Apply environment variable overrides to config.
 * Env vars always take precedence over config file values.
 */
function applyEnvOverrides(config) {
    const env = process.env;
    return {
        ...config,
        // ALLOY_QUIET=1
        quiet_mode: env.ALLOY_QUIET === "1" || env.ALLOY_QUIET === "true"
            ? true
            : config.quiet_mode,
        // ALLOY_DEBUG=1 or any truthy value
        debug: env.ALLOY_DEBUG
            ? env.ALLOY_DEBUG !== "0" && env.ALLOY_DEBUG !== "false"
            : config.debug,
        // ALLOY_LOG_DIR=/path/to/logs
        log_dir: env.ALLOY_LOG_DIR || config.log_dir,
        // ALLOY_SESSION_RECOVERY=0 to disable
        session_recovery: env.ALLOY_SESSION_RECOVERY === "0" ||
            env.ALLOY_SESSION_RECOVERY === "false"
            ? false
            : config.session_recovery,
        // ALLOY_AUTO_RESUME=0 to disable auto-continue after recovery
        auto_resume: env.ALLOY_AUTO_RESUME === "0" ||
            env.ALLOY_AUTO_RESUME === "false"
            ? false
            : env.ALLOY_AUTO_RESUME === "1" ||
                env.ALLOY_AUTO_RESUME === "true"
                ? true
                : config.auto_resume,
        // ALLOY_RESUME_TEXT to customize resume text
        resume_text: env.ALLOY_RESUME_TEXT || config.resume_text,
        // ALLOY_AUTO_UPDATE=0 to disable
        auto_update: env.ALLOY_AUTO_UPDATE === "0" ||
            env.ALLOY_AUTO_UPDATE === "false"
            ? false
            : config.auto_update,
        // ALLOY_ACCOUNT_SELECTION_STRATEGY=sticky|round-robin|hybrid
        account_selection_strategy: env.ALLOY_ACCOUNT_SELECTION_STRATEGY
            ? schema_1.AccountSelectionStrategySchema.catch('sticky').parse(env.ALLOY_ACCOUNT_SELECTION_STRATEGY)
            : config.account_selection_strategy,
        // ALLOY_PID_OFFSET_ENABLED=1
        pid_offset_enabled: env.ALLOY_PID_OFFSET_ENABLED === "1" ||
            env.ALLOY_PID_OFFSET_ENABLED === "true"
            ? true
            : config.pid_offset_enabled,
    };
}
// =============================================================================
// Main Loader
// =============================================================================
/**
 * Load the complete configuration.
 *
 * @param directory - The project directory (for project-level config)
 * @returns Fully resolved configuration
 */
function loadConfig(directory) {
    // Start with defaults
    let config = { ...schema_1.DEFAULT_CONFIG };
    // Load user config file (if exists)
    const userConfigPath = getUserConfigPath();
    const userConfig = loadConfigFile(userConfigPath);
    if (userConfig) {
        config = mergeConfigs(config, userConfig);
    }
    // Load project config file (if exists) - overrides user config
    const projectConfigPath = getProjectConfigPath(directory);
    const projectConfig = loadConfigFile(projectConfigPath);
    if (projectConfig) {
        config = mergeConfigs(config, projectConfig);
    }
    // Apply environment variable overrides (always win)
    config = applyEnvOverrides(config);
    return config;
}
/**
 * Check if a config file exists at the given path.
 */
function configExists(path) {
    return (0, node_fs_1.existsSync)(path);
}
/**
 * Get the default logs directory.
 */
function getDefaultLogsDir() {
    return (0, node_path_1.join)(getConfigDir(), "Alloy-logs");
}
let runtimeConfig = null;
function initRuntimeConfig(config) {
    runtimeConfig = config;
}
function getKeepThinking() {
    return runtimeConfig?.keep_thinking ?? false;
}
//# sourceMappingURL=loader.js.map