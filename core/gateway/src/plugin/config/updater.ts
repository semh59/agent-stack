/**
 * Alloy configuration file updater.
 *
 * Updates ~/.config/Alloy/Alloy.json with plugin models.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { Alloy_MODEL_DEFINITIONS } from "./models";

// =============================================================================
// Types
// =============================================================================

export interface UpdateConfigResult {
  success: boolean;
  configPath: string;
  error?: string;
}

export interface AlloyConfig {
  $schema?: string;
  plugin?: string[];
  provider?: {
    google?: {
      models?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UpdateConfigOptions {
  /** Override the config file path (for testing) */
  configPath?: string;
}

// =============================================================================
// Constants
// =============================================================================

const PLUGIN_NAME = "alloy-ai@latest";
const SCHEMA_URL = "https://Alloy.ai/config.json";

/**
 * Get the Alloy config directory path.
 */
export function getAlloyConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "Alloy");
}

/**
 * Get the Alloy.json config file path.
 */
export function getAlloyConfigPath(): string {
  return join(getAlloyConfigDir(), "Alloy.json");
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Updates the Alloy.json configuration file with plugin models.
 *
 * This function:
 * 1. Reads existing Alloy.json (or creates default structure)
 * 2. Replaces `provider.google.models` with plugin models
 * 3. Writes back to disk with proper formatting
 *
 * Preserves:
 * - $schema and other top-level config keys
 * - Non-google provider sections
 * - Other settings within google provider (except models)
 *
 * @param options - Optional configuration (e.g., custom configPath for testing)
 * @returns UpdateConfigResult with success status and path
 */
export async function updateAlloyConfig(
  options: UpdateConfigOptions = {}
): Promise<UpdateConfigResult> {
  const configPath = options.configPath ?? getAlloyConfigPath();

  try {
    let config: AlloyConfig;

    // Read existing config or create default
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      config = JSON.parse(content) as AlloyConfig;
    } else {
      // Create default config structure
      config = {
        $schema: SCHEMA_URL,
        plugin: [],
        provider: {},
      };
    }

    // Ensure $schema is set
    if (!config.$schema) {
      config.$schema = SCHEMA_URL;
    }

    // Ensure plugin array exists and contains our plugin
    if (!Array.isArray(config.plugin)) {
      config.plugin = [];
    }

    // Check if plugin is already in the list (any version)
    const hasPlugin = config.plugin.some((p) =>
      p.includes("alloy-ai")
    );
    if (!hasPlugin) {
      config.plugin.push(PLUGIN_NAME);
    }

    // Ensure provider.google structure exists
    if (!config.provider) {
      config.provider = {};
    }
    if (!config.provider.google) {
      config.provider.google = {};
    }

    // Replace google models with plugin models
    config.provider.google.models = { ...Alloy_MODEL_DEFINITIONS };

    // Ensure config directory exists
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Write config with proper formatting (2-space indent)
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    return {
      success: true,
      configPath,
    };
  } catch (error) {
    return {
      success: false,
      configPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
