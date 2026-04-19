import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * System and Browser Utilities
 */

/**
 * Check if the current environment is WSL (Windows Subsystem for Linux).
 */
export function isWSL(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const release = readFileSync("/proc/version", "utf8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

/**
 * Check if the current environment is WSL2.
 */
export function isWSL2(): boolean {
  if (!isWSL()) return false;
  try {
    const version = readFileSync("/proc/version", "utf8").toLowerCase();
    return version.includes("wsl2") || version.includes("microsoft-standard");
  } catch {
    return false;
  }
}

/**
 * Check if the current environment is a remote one (SSH, Codespaces, etc.).
 */
export function isRemoteEnvironment(): boolean {
  if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) {
    return true;
  }
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) {
    return true;
  }
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !isWSL()) {
    return true;
  }
  return false;
}

/**
 * Check if the local server should be skipped based on the environment.
 */
export function shouldSkipLocalServer(): boolean {
  return isWSL2() || isRemoteEnvironment();
}

/**
 * Open a URL in the default browser.
 */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
      return true;
    }
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
      return true;
    }
    if (isWSL()) {
      try {
        spawn("wslview", [url], { stdio: "ignore", detached: true }).unref();
        return true;
      } catch {}
    }
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      return false;
    }
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}
