import { describe, expect, it } from "vitest";

import {
  isOAuthAuth,
  parseRefreshParts,
  formatRefreshParts,
  accessTokenExpired,
  calculateTokenExpiry,
} from "./auth";
import type { OAuthAuthDetails, ApiKeyAuthDetails, RefreshParts } from "./types";

describe("isOAuthAuth", () => {
  it("returns true for OAuth auth details", () => {
    const oauth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "1//test-refresh|test-project",
      access: "ya29.test-token",
      expires: Date.now() + 3600_000,
    };
    expect(isOAuthAuth(oauth)).toBe(true);
  });

  it("returns false for API key auth details", () => {
    const apiKey: ApiKeyAuthDetails = {
      type: "api_key",
      key: "AIzaSy...",
    };
    expect(isOAuthAuth(apiKey)).toBe(false);
  });

  it("returns false for non-oauth auth details", () => {
    expect(isOAuthAuth({ type: "other" })).toBe(false);
  });
});

describe("parseRefreshParts / formatRefreshParts", () => {
  it("round-trips a refresh token with project and managed project", () => {
    const parts: RefreshParts = {
      refreshToken: "1//abc123",
      projectId: "my-project-123",
      managedProjectId: "managed-456",
    };

    const packed = formatRefreshParts(parts);
    const parsed = parseRefreshParts(packed);

    expect(parsed.refreshToken).toBe(parts.refreshToken);
    expect(parsed.projectId).toBe(parts.projectId);
    expect(parsed.managedProjectId).toBe(parts.managedProjectId);
  });

  it("round-trips a refresh token with project but no managed project", () => {
    const parts: RefreshParts = {
      refreshToken: "1//def456",
      projectId: "solo-project",
    };

    const packed = formatRefreshParts(parts);
    const parsed = parseRefreshParts(packed);

    expect(parsed.refreshToken).toBe(parts.refreshToken);
    expect(parsed.projectId).toBe(parts.projectId);
    expect(parsed.managedProjectId).toBeUndefined();
  });

  it("round-trips a bare refresh token without project IDs", () => {
    const parts: RefreshParts = {
      refreshToken: "1//bare-token",
    };

    const packed = formatRefreshParts(parts);
    const parsed = parseRefreshParts(packed);

    expect(parsed.refreshToken).toBe(parts.refreshToken);
    expect(parsed.projectId).toBeUndefined();
    expect(parsed.managedProjectId).toBeUndefined();
  });

  it("handles empty string refresh", () => {
    const parsed = parseRefreshParts("");
    expect(parsed.refreshToken).toBe("");
    expect(parsed.projectId).toBeUndefined();
    expect(parsed.managedProjectId).toBeUndefined();
  });

  it("handles special characters in project IDs", () => {
    const parts: RefreshParts = {
      refreshToken: "1//token",
      projectId: "my-project-123",
      managedProjectId: "managed-456",
    };

    const packed = formatRefreshParts(parts);
    const parsed = parseRefreshParts(packed);

    expect(parsed.refreshToken).toBe("1//token");
    expect(parsed.projectId).toBe("my-project-123");
    expect(parsed.managedProjectId).toBe("managed-456");
  });
});

describe("accessTokenExpired", () => {
  it("returns true when expires is in the past", () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "token|project",
      access: "ya29.test",
      expires: Date.now() - 1000,
    };
    expect(accessTokenExpired(auth)).toBe(true);
  });

  it("returns true when expires is within 60s buffer", () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "token|project",
      access: "ya29.test",
      expires: Date.now() + 30_000, // 30 seconds from now — inside 60s buffer
    };
    expect(accessTokenExpired(auth)).toBe(true);
  });

  it("returns false when expires is well in the future", () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "token|project",
      access: "ya29.test",
      expires: Date.now() + 3600_000, // 1 hour
    };
    expect(accessTokenExpired(auth)).toBe(false);
  });

  it("returns true when access is missing", () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "token|project",
    };
    expect(accessTokenExpired(auth)).toBe(true);
  });

  it("returns true when expires is undefined", () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "token|project",
      access: "ya29.test",
    };
    expect(accessTokenExpired(auth)).toBe(true);
  });

  it("returns false when expires is 61 seconds from now", () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "token|project",
      access: "ya29.test",
      expires: Date.now() + 61_000,
    };
    expect(accessTokenExpired(auth)).toBe(false);
  });
});

describe("calculateTokenExpiry", () => {
  it("converts expires_in seconds to absolute timestamp from start time", () => {
    const startTime = Date.now();
    const result = calculateTokenExpiry(startTime, 3600);
    expect(result).toBe(startTime + 3600 * 1000);
  });

  it("handles 0 expires_in (returns start time)", () => {
    const startTime = Date.now();
    const result = calculateTokenExpiry(startTime, 0);
    expect(result).toBe(startTime);
  });

  it("handles negative expires_in as invalid (returns start time)", () => {
    const startTime = Date.now();
    const result = calculateTokenExpiry(startTime, -100);
    expect(result).toBe(startTime);
  });

  it("handles non-number expires_in by defaulting to 3600", () => {
    const startTime = Date.now();
    const result = calculateTokenExpiry(startTime, "bad" as unknown);
    expect(result).toBe(startTime + 3600 * 1000);
  });

  it("handles very large expires_in values", () => {
    const startTime = Date.now();
    const result = calculateTokenExpiry(startTime, 86400);
    expect(result).toBe(startTime + 86400 * 1000);
    expect(result).toBeGreaterThan(Date.now());
  });
});