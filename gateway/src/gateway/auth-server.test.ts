import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AuthServer } from "./auth-server";

// Test helpers for server readiness synchronization
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(
  server: AuthServer,
  maxWaitMs: number = 5000
): Promise<void> {
  const startTime = Date.now();

  while (!server.isListening()) {
    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(
        `AuthServer failed to start listening after ${maxWaitMs}ms`
      );
    }
    await sleep(50);
  }
}

vi.mock("../google-gemini/oauth", () => ({
  exchangeGoogleGemini: vi.fn(),
}));

import { exchangeGoogleGemini } from "../google-gemini/oauth";

describe("AuthServer Security", () => {
  let authServer: AuthServer;
  let mockPort: number = 51122;

  beforeEach(() => {
    // Use different ports for each test to avoid TIME_WAIT conflicts
    mockPort = 51122 + Math.floor(Math.random() * 100);

    const mockAdapter = {
      provider: "google_gemini",
      exchangeCode: vi.fn(),
      getAvailableModels: vi.fn(),
      getAuthUrl: vi.fn(),
      refreshToken: vi.fn(),
      isTokenValid: vi.fn(),
      getQuota: vi.fn(),
    } as any;

    authServer = new AuthServer({
      port: mockPort,
      expectedState: "secret-state-123",
      adapter: mockAdapter,
    });
  });

  afterEach(async () => {
    authServer.stop();
    // Ensure port is fully released before next test
    await sleep(500);
  });

  it("rejects callback with incorrect state using stable errorCode", async () => {
    const authPromise = authServer.start();

    // âœ… Wait for server to be listening before sending request
    await waitForServerReady(authServer);

    const response = await fetch(`http://localhost:${mockPort}/oauth-callback?code=mock-code&state=wrong-state`);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("OAuth state");

    const result = await authPromise;
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("OAUTH_STATE_MISMATCH");
    expect(result.error).toContain("OAuth state");
  });

  it("accepts callback with correct state and calls exchange", async () => {
    const mockState = Buffer.from(JSON.stringify({ verifier: "v", projectId: "p" })).toString("base64url");

    const mockAdapter = {
      provider: "google_gemini",
      exchangeCode: vi.fn(),
      getAvailableModels: vi.fn(),
      getAuthUrl: vi.fn(),
      refreshToken: vi.fn(),
      isTokenValid: vi.fn(),
      getQuota: vi.fn(),
    } as any;

    authServer = new AuthServer({
      port: mockPort,
      expectedState: mockState,
      adapter: mockAdapter,
    });

    const mockToken = {
      provider: "google_gemini",
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: Date.now() + 3600,
      email: "test@gmail.com",
      createdAt: Date.now(),
      availableModels: [],
    };

    vi.spyOn(authServer["adapter"], "exchangeCode").mockResolvedValue(mockToken as any);

    const authPromise = authServer.start();

    // âœ… Wait for server to be listening before sending request
    await waitForServerReady(authServer);

    const response = await fetch(`http://localhost:${mockPort}/oauth-callback?code=mock-code&state=${mockState}`);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Giris Basarili");

    const result = await authPromise;
    expect(result.success).toBe(true);
    expect(result.errorCode).toBe("NONE");
    expect(result.error).toBeNull();
    expect(exchangeGoogleGemini).toHaveBeenCalledWith("mock-code", mockState);
  });
});

