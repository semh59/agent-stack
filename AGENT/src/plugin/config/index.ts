/**
 * Configuration module for sovereign-ai plugin.
 * 
 * @example
 * ```typescript
 * import { loadConfig, type SovereignGatewayConfig } from "./config";
 * 
 * const config = loadConfig(directory);
 * if (config.session_recovery) {
 *   // Enable session recovery
 * }
 * ```
 */

export {
  SovereignGatewayConfigSchema,
  SignatureCacheConfigSchema,
  DEFAULT_CONFIG,
  type SovereignGatewayConfig,
  type SignatureCacheConfig,
} from "./schema";

export {
  loadConfig,
  getUserConfigPath,
  getProjectConfigPath,
  getDefaultLogsDir,
  configExists,
  initRuntimeConfig,
  getKeepThinking,
} from "./loader";
