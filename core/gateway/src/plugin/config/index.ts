/**
 * Configuration module for alloy-ai plugin.
 * 
 * @example
 * ```typescript
 * import { loadConfig, type AlloyGatewayConfig } from "./config";
 * 
 * const config = loadConfig(directory);
 * if (config.session_recovery) {
 *   // Enable session recovery
 * }
 * ```
 */

export {
  AlloyGatewayConfigSchema,
  SignatureCacheConfigSchema,
  DEFAULT_CONFIG,
  type AlloyGatewayConfig,
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
