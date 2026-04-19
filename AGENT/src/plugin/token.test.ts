import { afterEach, describe, expect, it, vi } from "vitest";

import { AntigravityTokenRefreshError, refreshAccessToken } from "./token";
import type { OAuthAuthDetails, PluginClient } from "./types";

vi.mock("./cache", () => ({
  storeCachedAuth: vi.fn(),
  clearCachedAuth: vi.fn(),
  getCachedAuth: vi.fn(),
}));

vi.mock("./project", () => ({
  invalidateProjectContextCache: vi.fn(),
}));

// Suppress logger output during tests
vi.mock("./logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockClient = {} as PluginClient;
const providerId = "google";

function makeOAuthAuth(refresh: string, access = "ya29.old", expires?: number): OAuthAuthDetails {
  return {
    type: "oauth",
    refresh,
    access,
    expires: expires ?? Date.now() - 1000,
  };
}

describe("refreshAccessToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when refresh parts contain no refresh token", async () => {
    const auth = makeOAuthAuth(""); // empty refresh string → no refreshToken
    const result = await refreshAccessToken(auth, mockClient, providerId);
    expect(result).toBeUndefined();
  });

  it("refreshes token successfully and returns updated auth", async () => {
    const auth = makeOAuthAuth("1//refresh-token|my-project");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "ya29.new-access-token",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const result = await refreshAccessToken(auth, mockClient, providerId);

    expect(result).toBeDefined();
    expect(result!.access).toBe("ya29.new-access-token");
    expect(result!.expires).toBeGreaterThan(Date.now());
    expect(result!.refresh).toContain("1//refresh-token");
    expect(result!.refresh).toContain("my-project");
  });

  it("preserves new refresh_token if server returns one", async () => {
    const auth = makeOAuthAuth("1//old-refresh|project");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "ya29.new",
          expires_in: 3600,
          refresh_token: "1//new-refresh",
        }),
        { status: 200 },
      ),
    );

    const result = await refreshAccessToken(auth, mockClient, providerId);

    expect(result).toBeDefined();
    expect(result!.refresh).toContain("1//new-refresh");
  });

  it("throws AntigravityTokenRefreshError on non-ok response", async () => {
    const auth = makeOAuthAuth("1//refresh|project");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
        { status: 400, statusText: "Bad Request" },
      ),
    );

    await expect(refreshAccessToken(auth, mockClient, providerId)).rejects.toThrow(
      AntigravityTokenRefreshError,
    );
  });

  it("clears cached auth on invalid_grant error", async () => {
    const { clearCachedAuth } = await import("./cache");
    const auth = makeOAuthAuth("1//revoked-token|project");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
        { status: 400, statusText: "Bad Request" },
      ),
    );

    await expect(refreshAccessToken(auth, mockClient, providerId)).rejects.toThrow();
    expect(clearCachedAuth).toHaveBeenCalledWith(auth.refresh);
  });

  it("returns undefined on network error (not AntigravityTokenRefreshError)", async () => {
    const auth = makeOAuthAuth("1//refresh|project");

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"));

    const result = await refreshAccessToken(auth, mockClient, providerId);
    expect(result).toBeUndefined();
  });

  it("deduplicates concurrent refresh requests (double-fetch protection)", async () => {
    const auth = makeOAuthAuth("1//dedup-refresh|project");
    let resolveResponse: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(pendingResponse);

    // Start two concurrent refreshes
    const promise1 = refreshAccessToken(auth, mockClient, providerId);
    const promise2 = refreshAccessToken(auth, mockClient, providerId);

    // Only one fetch call should have been made
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Resolve the response
    resolveResponse!(
      new Response(
        JSON.stringify({
          access_token: "ya29.deduped",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // Both should get the same result
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(result1!.access).toBe(result2!.access);
  });
});

describe("AntigravityTokenRefreshError", () => {
  it("has correct properties", () => {
    const error = new AntigravityTokenRefreshError({
      message: "Refresh failed",
      code: "invalid_grant",
      description: "Token revoked",
      status: 400,
      statusText: "Bad Request",
    });

    expect(error.name).toBe("AntigravityTokenRefreshError");
    expect(error.message).toBe("Refresh failed");
    expect(error.code).toBe("invalid_grant");
    expect(error.description).toBe("Token revoked");
    expect(error.status).toBe(400);
    expect(error.statusText).toBe("Bad Request");
    expect(error).toBeInstanceOf(Error);
  });

  it("works with minimal options", () => {
    const error = new AntigravityTokenRefreshError({
      message: "Failed",
      status: 500,
      statusText: "Internal Server Error",
    });

    expect(error.code).toBeUndefined();
    expect(error.description).toBeUndefined();
    expect(error.status).toBe(500);
  });
});