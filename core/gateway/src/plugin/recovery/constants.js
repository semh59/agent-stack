"use strict";
/**
 * Constants for session recovery storage paths.
 *
 * Based on oh-my-Alloy/src/hooks/session-recovery/constants.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTENT_TYPES = exports.META_TYPES = exports.THINKING_TYPES = exports.PART_STORAGE = exports.MESSAGE_STORAGE = exports.Alloy_STORAGE = void 0;
exports.getXdgConfig = getXdgConfig;
exports.getAlloyGatewayConfigDir = getAlloyGatewayConfigDir;
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
/**
 * Get the XDG data directory for Alloy storage.
 * Falls back to ~/.local/share on Linux/Mac, or APPDATA on Windows.
 */
function getXdgData() {
    const platform = process.platform;
    if (platform === "win32") {
        return process.env.APPDATA || (0, node_path_1.join)((0, node_os_1.homedir)(), "AppData", "Roaming");
    }
    return process.env.XDG_DATA_HOME || (0, node_path_1.join)((0, node_os_1.homedir)(), ".local", "share");
}
/**
 * Get the XDG config directory for Alloy config.
 * Falls back to ~/.config on Linux/Mac, or APPDATA on Windows.
 */
function getXdgConfig() {
    const platform = process.platform;
    if (platform === "win32") {
        return process.env.APPDATA || (0, node_path_1.join)((0, node_os_1.homedir)(), "AppData", "Roaming");
    }
    return process.env.XDG_CONFIG_HOME || (0, node_path_1.join)((0, node_os_1.homedir)(), ".config");
}
/**
 * Get the Alloy config directory.
 * Default: ~/.config/Alloy/Alloy.json
 */
function getAlloyGatewayConfigDir() {
    return (0, node_path_1.join)(getXdgConfig(), "Alloy");
}
exports.Alloy_STORAGE = (0, node_path_1.join)(getXdgData(), "Alloy", "storage");
exports.MESSAGE_STORAGE = (0, node_path_1.join)(exports.Alloy_STORAGE, "message");
exports.PART_STORAGE = (0, node_path_1.join)(exports.Alloy_STORAGE, "part");
exports.THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"]);
exports.META_TYPES = new Set(["step-start", "step-finish"]);
exports.CONTENT_TYPES = new Set(["text", "tool", "tool_use", "tool_result"]);
//# sourceMappingURL=constants.js.map