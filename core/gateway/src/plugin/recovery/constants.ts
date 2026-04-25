/**
 * Constants for session recovery storage paths.
 * 
 * Based on oh-my-Alloy/src/hooks/session-recovery/constants.ts
 */

import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Get the XDG data directory for Alloy storage.
 * Falls back to ~/.local/share on Linux/Mac, or APPDATA on Windows.
 */
function getXdgData(): string {
  const platform = process.platform;
  
  if (platform === "win32") {
    return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  }
  
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

/**
 * Get the XDG config directory for Alloy config.
 * Falls back to ~/.config on Linux/Mac, or APPDATA on Windows.
 */
export function getXdgConfig(): string {
  const platform = process.platform;
  
  if (platform === "win32") {
    return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  }
  
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

/**
 * Get the Alloy config directory.
 * Default: ~/.config/Alloy/Alloy.json
 */
export function getAlloyGatewayConfigDir(): string {
  return join(getXdgConfig(), "Alloy");
}

export const Alloy_STORAGE = join(getXdgData(), "Alloy", "storage");
export const MESSAGE_STORAGE = join(Alloy_STORAGE, "message");
export const PART_STORAGE = join(Alloy_STORAGE, "part");

export const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"]);
export const META_TYPES = new Set(["step-start", "step-finish"]);
export const CONTENT_TYPES = new Set(["text", "tool", "tool_use", "tool_result"]);
