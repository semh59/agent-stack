import { ALLOY_CLIENT_ID, ALLOY_CLIENT_SECRET } from "../constants";
import { formatRefreshParts, parseRefreshParts, calculateTokenExpiry } from "./auth";
import { clearCachedAuth, storeCachedAuth } from "./cache";
import { createLogger } from "./logger";
import { invalidateProjectContextCache } from "./project";
import type { OAuthAuthDetails, PluginClient, RefreshParts } from "./types";

const log = createLogger("token");

interface OAuthErrorPayload {
  error?:
    | string
    | {
        code?: string;
        status?: string;
        message?: string;
      };
  error_description?: string;
}

/**
 * Parses OAuth error payloads returned by Google token endpoints, tolerating varied shapes.
 */
function parseOAuthErrorPayload(text: string | undefined): { code?: string; description?: string } {
  if (!text) {
    return {};
  }

  try {
    const payload = JSON.parse(text) as OAuthErrorPayload;
    if (!payload || typeof payload !== "object") {
      return { description: text };
    }

    let code: string | undefined;
    if (typeof payload.error === "string") {
      code = payload.error;
    } else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status ?? payload.error.code;
      if (!payload.error_description && payload.error.message) {
        return { code, description: payload.error.message };
      }
    }

    const description = payload.error_description;
    if (description) {
      return { code, description };
    }

    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return { code, description: payload.error.message };
    }

    return { code };
  } catch {
    return { description: text };
  }
}

export class AlloyTokenRefreshError extends Error {
  code?: string;
  description?: string;
  status: number;
  statusText: string;

  constructor(options: {
    message: string;
    code?: string;
    description?: string;
    status: number;
    statusText: string;
  }) {
    super(options.message);
    this.name = "AlloyTokenRefreshError";
    this.code = options.code;
    this.description = options.description;
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

const refreshPromises = new Map<string, Promise<OAuthAuthDetails | undefined>>();

/**
 * Refreshes an Alloy OAuth access token, updates persisted credentials, and handles revocation.
 * Implements Double-Fetch Protection to prevent multiple simultaneous refreshes for the same token.
 */
export async function refreshAccessToken(
  auth: OAuthAuthDetails,
  client: PluginClient,
  providerId: string,
): Promise<OAuthAuthDetails | undefined> {
  const parts = parseRefreshParts(auth.refresh);
  if (!parts.refreshToken) {
    return undefined;
  }

  // Double-Fetch Protection: If a refresh is already in progress for this token, wait for it
  const existingPromise = refreshPromises.get(parts.refreshToken);
  if (existingPromise) {
    log.debug("Waiting for existing refresh promise", { token: parts.refreshToken.slice(0, 8) });
    return existingPromise;
  }

  const refreshPromise = (async () => {
    try {
      const startTime = Date.now();
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: parts.refreshToken!,
          client_id: ALLOY_CLIENT_ID,
          client_secret: ALLOY_CLIENT_SECRET,
        }),
      });

      if (!response.ok) {
        let errorText: string | undefined;
        try {
          errorText = await response.text();
        } catch {
          errorText = undefined;
        }

        const { code, description } = parseOAuthErrorPayload(errorText);
        const details = [code, description ?? errorText].filter(Boolean).join(": ");
        const baseMessage = `Alloy token refresh failed (${response.status} ${response.statusText})`;
        const message = details ? `${baseMessage} - ${details}` : baseMessage;
        log.warn("Token refresh failed", { status: response.status, code, details });

        if (code === "invalid_grant") {
          log.warn("Google revoked the stored refresh token - reauthentication required");
          invalidateProjectContextCache(auth.refresh);
          clearCachedAuth(auth.refresh);
        }

        throw new AlloyTokenRefreshError({
          message,
          code,
          description: description ?? errorText,
          status: response.status,
          statusText: response.statusText,
        });
      }

      const payload = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
      };

      const refreshedParts: RefreshParts = {
        refreshToken: payload.refresh_token ?? parts.refreshToken!,
        projectId: parts.projectId,
        managedProjectId: parts.managedProjectId,
      };

      const updatedAuth: OAuthAuthDetails = {
        ...auth,
        access: payload.access_token,
        expires: calculateTokenExpiry(startTime, payload.expires_in),
        refresh: formatRefreshParts(refreshedParts),
      };

      storeCachedAuth(updatedAuth);
      invalidateProjectContextCache(auth.refresh);

      return updatedAuth;
    } catch (error) {
      if (error instanceof AlloyTokenRefreshError) {
        throw error;
      }
      log.error("Unexpected token refresh error", { error: String(error) });
      return undefined;
    } finally {
      // Always clear the promise from the map when finished
      refreshPromises.delete(parts.refreshToken!);
    }
  })();

  refreshPromises.set(parts.refreshToken, refreshPromise);
  return refreshPromise;
}

