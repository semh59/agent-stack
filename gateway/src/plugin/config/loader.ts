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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AccountSelectionStrategySchema, AlloyGatewayConfigSchema, DEFAULT_CONFIG, type AlloyGatewayConfig } from "./schema";
import { createLogger } from "../logger";

const log = createLogger("config");

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Get the config directory path, with the following precedence:
 * 1. OPENCODE_CONFIG_DIR env var (if set)
 * 2. ~/.config/opencode (all platforms, including Windows)
 */
function getConfigDir(): string {
  // 1. Check for explicit override via env var
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  // 2. Use ~/.config/opencode on all platforms (including Windows)
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

/**
 * Get the user-level config file path.
 */
export function getUserConfigPath(): string {
  return join(getConfigDir(), "Alloy.json");
}

/**
 * Get the project-level config file path.
 */
export function getProjectConfigPath(directory: string): string {
  return join(directory, ".opencode", "Alloy.json");
}

// =============================================================================
// Config Loading
// =============================================================================

/**
 * Load and parse a config file, returning null if not found or invalid.
 */
function loadConfigFile(path: string): Partial<AlloyGatewayConfig> | null {
  try {
    if (!existsSync(path)) {
      return null;
    }

    const content = readFileSync(path, "utf-8");
    const rawConfig = JSON.parse(content);

    // Validate with Zod (partial - we'll merge with defaults later)
    const result = AlloyGatewayConfigSchema.partial().safeParse(rawConfig);

    if (!result.success) {
      log.warn("Config validation error", {
        path,
        issues: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "),
      });
      return null;
    }

    return result.data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      log.warn("Invalid JSON in config file", { path, error: error.message });
    } else {
      log.warn("Failed to load config file", { path, error: String(error) });
    }
    return null;
  }
}

/**
 * Deep merge two config objects, with override taking precedence.
 */
function mergeConfigs(
  base: AlloyGatewayConfig,
  override: Partial<AlloyGatewayConfig>
): AlloyGatewayConfig {
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
function applyEnvOverrides(config: AlloyGatewayConfig): AlloyGatewayConfig {
  const env = process.env;

  return {
    ...config,

    // OPENCODE_ALLOY_QUIET=1
    quiet_mode: env.OPENCODE_ALLOY_QUIET === "1" || env.OPENCODE_ALLOY_QUIET === "true"
      ? true
      : config.quiet_mode,

    // OPENCODE_ALLOY_DEBUG=1 or any truthy value
    debug: env.OPENCODE_ALLOY_DEBUG
      ? env.OPENCODE_ALLOY_DEBUG !== "0" && env.OPENCODE_ALLOY_DEBUG !== "false"
      : config.debug,

    // OPENCODE_ALLOY_LOG_DIR=/path/to/logs
    log_dir: env.OPENCODE_ALLOY_LOG_DIR || config.log_dir,

    // OPENCODE_ALLOY_SESSION_RECOVERY=0 to disable
    session_recovery:
      env.OPENCODE_ALLOY_SESSION_RECOVERY === "0" ||
      env.OPENCODE_ALLOY_SESSION_RECOVERY === "false"
        ? false
        : config.session_recovery,

    // OPENCODE_ALLOY_AUTO_RESUME=0 to disable auto-continue after recovery
    auto_resume:
      env.OPENCODE_ALLOY_AUTO_RESUME === "0" ||
      env.OPENCODE_ALLOY_AUTO_RESUME === "false"
        ? false
        : env.OPENCODE_ALLOY_AUTO_RESUME === "1" ||
          env.OPENCODE_ALLOY_AUTO_RESUME === "true"
          ? true
          : config.auto_resume,

    // OPENCODE_ALLOY_RESUME_TEXT to customize resume text
    resume_text: env.OPENCODE_ALLOY_RESUME_TEXT || config.resume_text,

    // OPENCODE_ALLOY_AUTO_UPDATE=0 to disable
    auto_update:
      env.OPENCODE_ALLOY_AUTO_UPDATE === "0" ||
      env.OPENCODE_ALLOY_AUTO_UPDATE === "false"
        ? false
        : config.auto_update,

    // OPENCODE_ALLOY_ACCOUNT_SELECTION_STRATEGY=sticky|round-robin|hybrid
    account_selection_strategy: env.OPENCODE_ALLOY_ACCOUNT_SELECTION_STRATEGY
      ? AccountSelectionStrategySchema.catch('sticky').parse(env.OPENCODE_ALLOY_ACCOUNT_SELECTION_STRATEGY)
      : config.account_selection_strategy,

    // OPENCODE_ALLOY_PID_OFFSET_ENABLED=1
    pid_offset_enabled:
      env.OPENCODE_ALLOY_PID_OFFSET_ENABLED === "1" ||
      env.OPENCODE_ALLOY_PID_OFFSET_ENABLED === "true"
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
export function loadConfig(directory: string): AlloyGatewayConfig {
  // Start with defaults
  let config: AlloyGatewayConfig = { ...DEFAULT_CONFIG };

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
export function configExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Get the default logs directory.
 */
export function getDefaultLogsDir(): string {
  return join(getConfigDir(), "Alloy-logs");
}

let runtimeConfig: AlloyGatewayConfig | null = null;

export function initRuntimeConfig(config: AlloyGatewayConfig): void {
  runtimeConfig = config;
}

export function getKeepThinking(): boolean {
  return runtimeConfig?.keep_thinking ?? false;
}
