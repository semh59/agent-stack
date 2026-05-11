"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKeepThinking = exports.initRuntimeConfig = exports.configExists = exports.getDefaultLogsDir = exports.getProjectConfigPath = exports.getUserConfigPath = exports.loadConfig = exports.DEFAULT_CONFIG = exports.SignatureCacheConfigSchema = exports.AlloyGatewayConfigSchema = void 0;
var schema_1 = require("./schema");
Object.defineProperty(exports, "AlloyGatewayConfigSchema", { enumerable: true, get: function () { return schema_1.AlloyGatewayConfigSchema; } });
Object.defineProperty(exports, "SignatureCacheConfigSchema", { enumerable: true, get: function () { return schema_1.SignatureCacheConfigSchema; } });
Object.defineProperty(exports, "DEFAULT_CONFIG", { enumerable: true, get: function () { return schema_1.DEFAULT_CONFIG; } });
var loader_1 = require("./loader");
Object.defineProperty(exports, "loadConfig", { enumerable: true, get: function () { return loader_1.loadConfig; } });
Object.defineProperty(exports, "getUserConfigPath", { enumerable: true, get: function () { return loader_1.getUserConfigPath; } });
Object.defineProperty(exports, "getProjectConfigPath", { enumerable: true, get: function () { return loader_1.getProjectConfigPath; } });
Object.defineProperty(exports, "getDefaultLogsDir", { enumerable: true, get: function () { return loader_1.getDefaultLogsDir; } });
Object.defineProperty(exports, "configExists", { enumerable: true, get: function () { return loader_1.configExists; } });
Object.defineProperty(exports, "initRuntimeConfig", { enumerable: true, get: function () { return loader_1.initRuntimeConfig; } });
Object.defineProperty(exports, "getKeepThinking", { enumerable: true, get: function () { return loader_1.getKeepThinking; } });
//# sourceMappingURL=index.js.map