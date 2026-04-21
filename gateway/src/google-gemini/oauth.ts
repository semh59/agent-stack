import { generatePKCE } from "@openauthjs/openauth/pkce";
import { randomBytes, createHash } from "node:crypto";

import {
  ALLOY_CLIENT_ID,
  ALLOY_CLIENT_SECRET,
  ALLOY_REDIRECT_URI,
  ALLOY_SCOPES,
  ALLOY_ENDPOINT_FALLBACKS,
  ALLOY_LOAD_ENDPOINTS,
  ALLOY_HEADERS,
  GEMINI_CLI_HEADERS,
} from "../constants";
import { createLogger } from "../plugin/logger";
import { calculateTokenExpiry } from "../plugin/auth";

const log = createLogger("oauth");

interface PkcePair {
  challenge: string;
  verifier: string;
}

interface PKCESession {
  state: string;
  verifier: string;
  challenge: string;
  projectId?: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

interface AlloyAuthState {
  verifier: string;
  projectId: string;
}

/**
 * PKCEStateManager - Server-side PKCE state storage
 *
 * Stores PKCE verifiers server-side to prevent exposure in URLs.
 * States are one-time use and expire after 10 minutes.
 */
class PKCEStateManager {
  private sessions = new Map<string, PKCESession>();
  private readonly STATE_TTL_MS = 10 * 60 * 1000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup of expired states
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.cleanupExpiredStates(), 60 * 1000);
    // Allow process to exit even if cleanup interval is running
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Generate a new PKCE state/verifier pair and store server-side
   */
  generateState(projectId?: string): { state: string; verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('hex').slice(0, 64); // PKCE verifier (43-128 chars)
    const state = randomBytes(16).toString('hex'); // Random state (not containing verifier)

    // Calculate S256 code challenge
    const challenge = createHash('sha256')
      .update(verifier)
      .digest('base64url');

    const now = Date.now();
    this.sessions.set(state, {
      state,
      verifier,
      challenge,
      projectId,
      createdAt: now,
      expiresAt: now + this.STATE_TTL_MS,
      consumed: false,
    });

    return { state, verifier, challenge };
  }

  /**
   * Validate state and return verifier/projectId (one-time use)
   * Returns null if state is invalid, expired, or already consumed
   */
  validateAndConsumeState(state: string): { verifier: string; projectId?: string } | null {
    const session = this.sessions.get(state);

    if (!session) {
      log.warn('OAuth state not found', { state: state.slice(0, 8) + '...' });
      return null;
    }

    if (session.consumed) {
      log.warn('OAuth state already consumed (replay attack?)', { state: state.slice(0, 8) + '...' });
      this.sessions.delete(state);
      return null;
    }

    if (Date.now() > session.expiresAt) {
      log.warn('OAuth state expired', { state: state.slice(0, 8) + '...' });
      this.sessions.delete(state);
      return null;
    }

    // Mark as consumed (one-time use)
    session.consumed = true;
    this.sessions.delete(state);

    return {
      verifier: session.verifier,
      projectId: session.projectId,
    };
  }

  /**
   * Cleanup expired states periodically
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug('Cleaned up expired OAuth states', { count: cleaned });
    }
  }

  /**
   * Get current number of stored states (for monitoring)
   */
  getStateCount(): number {
    return this.sessions.size;
  }

  /**
   * Shutdown and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
  }
}

// Global PKCE state manager instance
export const pkceStateManager = new PKCEStateManager();

/**
 * Result returned to the caller after constructing an OAuth authorization URL.
 */
export interface AlloyAuthorization {
  url: string;
  verifier: string;
  state: string;
  projectId: string;
}

interface AlloyTokenExchangeSuccess {
  type: "success";
  refresh: string;
  access: string;
  expires: number;
  email?: string;
  projectId: string;
}

interface AlloyTokenExchangeFailure {
  type: "failed";
  error: string;
}

export type AlloyTokenExchangeResult =
  | AlloyTokenExchangeSuccess
  | AlloyTokenExchangeFailure;

interface AlloyTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

interface AlloyUserInfo {
  email?: string;
}

/**
 * Encode an object into a URL-safe base64 string.
 */
function encodeState(payload: AlloyAuthState): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decode an OAuth state parameter back into its structured representation.
 */
function decodeState(state: string): AlloyAuthState {
  const normalized = state.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf8");
  const parsed = JSON.parse(json);
  if (typeof parsed.verifier !== "string") {
    throw new Error("Missing PKCE verifier in state");
  }
  return {
    verifier: parsed.verifier,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
  };
}

/**
 * Build the Alloy OAuth authorization URL using server-side PKCE state.
 * The PKCE verifier is stored server-side and NOT exposed in the URL.
 */
export async function authorizeGoogleGemini(projectId = ""): Promise<AlloyAuthorization> {
  // Generate state/verifier on server (verifier NOT in URL)
  const { state, challenge } = pkceStateManager.generateState(projectId || "");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", ALLOY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ALLOY_REDIRECT_URI);
  url.searchParams.set("scope", ALLOY_SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge); // S256 hash from server
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state); // Random state, verifier is server-side
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return {
    url: url.toString(),
    verifier: "", // Not needed by caller anymore (verifier is server-side)
    state,
    projectId: projectId || "",
  };
}

const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProjectID(accessToken: string): Promise<string> {
  const errors: string[] = [];
  const loadHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": GEMINI_CLI_HEADERS["User-Agent"],
    "X-Goog-Api-Client": GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
    "Client-Metadata": ALLOY_HEADERS["Client-Metadata"],
  };

  const loadEndpoints = Array.from(
    new Set<string>([...ALLOY_LOAD_ENDPOINTS, ...ALLOY_ENDPOINT_FALLBACKS]),
  );

  for (const baseEndpoint of loadEndpoints) {
    try {
      const url = `${baseEndpoint}/v1internal:loadCodeAssist`;
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: loadHeaders,
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (!response.ok) {
        const message = await response.text().catch(() => "");
        errors.push(
          `loadCodeAssist ${response.status} at ${baseEndpoint}${
            message ? `: ${message}` : ""
          }`,
        );
        continue;
      }

      const data = await response.json();
      if (typeof data.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
        return data.cloudaicompanionProject;
      }
      if (
        data.cloudaicompanionProject &&
        typeof data.cloudaicompanionProject.id === "string" &&
        data.cloudaicompanionProject.id
      ) {
        return data.cloudaicompanionProject.id;
      }

      errors.push(`loadCodeAssist missing project id at ${baseEndpoint}`);
    } catch (e) {
      errors.push(
        `loadCodeAssist error at ${baseEndpoint}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  if (errors.length) {
    log.warn("Failed to resolve Alloy project via loadCodeAssist", { errors: errors.join("; ") });
  }
  return "";
}

/**
 * Exchange an authorization code for Alloy CLI access and refresh tokens.
 */
export async function exchangeGoogleGemini(
  code: string,
  state: string,
): Promise<AlloyTokenExchangeResult> {
  try {
    // Get verifier from server-side state storage (not from URL-encoded state)
    const stateData = pkceStateManager.validateAndConsumeState(state);
    if (!stateData) {
      console.error(`[OAuth] Invalid or expired state: ${state.slice(0, 8)}...`);
      return {
        type: "failed",
        error: "Invalid or expired OAuth state",
      };
    }

    const { verifier, projectId } = stateData;

    const startTime = Date.now();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": GEMINI_CLI_HEADERS["User-Agent"],
        "X-Goog-Api-Client": GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
      },
      body: new URLSearchParams({
        client_id: ALLOY_CLIENT_ID,
        client_secret: ALLOY_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: ALLOY_REDIRECT_URI,
        code_verifier: verifier, // From server-side storage, not URL-encoded state
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return { type: "failed", error: errorText };
    }

    const tokenPayload = (await tokenResponse.json()) as AlloyTokenResponse;

    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
          "User-Agent": GEMINI_CLI_HEADERS["User-Agent"],
          "X-Goog-Api-Client": GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
        },
      },
    );

    const userInfo = userInfoResponse.ok
      ? ((await userInfoResponse.json()) as AlloyUserInfo)
      : {};

    const refreshToken = tokenPayload.refresh_token;
    if (!refreshToken) {
      return { type: "failed", error: "Missing refresh token in response" };
    }

    let effectiveProjectId = projectId;
    if (!effectiveProjectId) {
      effectiveProjectId = await fetchProjectID(tokenPayload.access_token);
    }

    const storedRefresh = `${refreshToken}|${effectiveProjectId || ""}`;

    return {
      type: "success",
      refresh: storedRefresh,
      access: tokenPayload.access_token,
      expires: calculateTokenExpiry(startTime, tokenPayload.expires_in),
      email: userInfo.email,
      projectId: effectiveProjectId || "",
    };
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
