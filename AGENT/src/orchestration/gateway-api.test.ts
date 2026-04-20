import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../plugin/token", () => ({
  refreshAccessToken: vi.fn(),
}));

import { refreshAccessToken } from "../plugin/token";
import { SovereignAPI } from "./gateway-api";

const MODEL_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-high:generateContent";

function createOAuthAuth() {
  return {
    type: "oauth" as const,
    access: "token-1",
    expires: Date.now() + 60_000,
    refresh: "refresh-token|project-id",
  };
}

function createManager() {
  return {
    getCurrentAccountForFamily: vi.fn((): any => ({
      index: 0,
      email: "user@example.com",
      access: "token-1",
      accessToken: "token-1",
      parts: { refreshToken: "refresh-token" },
    })),
    getCurrentOrNextForFamily: vi.fn((): any => null),
    markRateLimited: vi.fn(),
    markAccountUsed: vi.fn(),
  };
}

function createApi(nativeFetch: typeof fetch, getAuth = async () => createOAuthAuth()) {
  return new SovereignAPI(
    createManager(),
    {} as any,
    "Sovereign",
    getAuth,
    nativeFetch,
  );
}

function createJsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

describe("SovereignAPI", () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("simulates a 10-second latency window before dispatching the request", async () => {
    vi.useFakeTimers();

    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse(200, { ok: true }),
    );
    const api = createApi(nativeFetch);

    const responsePromise = api.fetch(MODEL_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "x-Sovereign-mock-latency-ms": "10000",
      },
      body: JSON.stringify({ prompt: "test" }),
    });

    expect(nativeFetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(nativeFetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(
      new Headers(nativeFetch.mock.calls[0]?.[1]?.headers).has("x-Sovereign-mock-latency-ms"),
    ).toBe(false);

    const response = await responsePromise;
    expect(response.ok).toBe(true);
  });

  it("aborts cleanly during simulated latency and never reaches the network", async () => {
    vi.useFakeTimers();

    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse(200, { ok: true }),
    );
    const api = createApi(nativeFetch);
    const controller = new AbortController();

    const responsePromise = api.fetch(MODEL_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "x-Sovereign-mock-latency-ms": "10000",
      },
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(250);
    controller.abort(new Error("STOP requested"));

    await expect(responsePromise).rejects.toThrow("STOP requested");
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it("honors retry-after delay before retrying a rate-limited request", async () => {
    vi.useFakeTimers();

    const nativeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse(
          429,
          {
            error: {
              message: "Quota exceeded, retry later.",
            },
          },
          { "retry-after": "7" },
        ),
      )
      .mockResolvedValueOnce(createJsonResponse(200, { ok: true }));
    const api = createApi(nativeFetch);

    const responsePromise = api.fetch(MODEL_URL, {
      method: "POST",
      headers: { Authorization: "Bearer token-1" },
    });

    await Promise.resolve();
    expect(nativeFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6_999);
    expect(nativeFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(nativeFetch).toHaveBeenCalledTimes(2);

    const response = await responsePromise;
    expect(response.ok).toBe(true);
  });

  it("returns a graceful 401 response when token refresh fails mid-mission", async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse(401, {
        error: {
          message: "Access token expired",
        },
      }),
    );
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("refresh exploded"));

    const api = createApi(nativeFetch, async () => ({
      type: "oauth" as const,
      access: "expired-token",
      expires: Date.now() - 1_000,
      refresh: "refresh-token|project-id",
    }));

    const response = await api.fetch(MODEL_URL, {
      method: "POST",
      headers: { Authorization: "Bearer expired-token" },
    });

    expect(vi.mocked(refreshAccessToken)).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Sovereign-Graceful-Error")).toBe("true");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("refresh exploded"),
      },
    });
  });

  it("retries once with a refreshed access token when token refresh succeeds", async () => {
    const nativeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse(401, {
          error: {
            message: "expired",
          },
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, { ok: true }));
    vi.mocked(refreshAccessToken).mockResolvedValue({
      type: "oauth",
      access: "token-2",
      expires: Date.now() + 60_000,
      refresh: "refresh-token|project-id",
    } as any);

    const api = createApi(nativeFetch, async () => ({
      type: "oauth" as const,
      access: "expired-token",
      expires: Date.now() - 1_000,
      refresh: "refresh-token|project-id",
    }));

    const response = await api.fetch(MODEL_URL, {
      method: "POST",
      headers: { Authorization: "Bearer expired-token" },
    });

    expect(response.ok).toBe(true);
    expect(vi.mocked(refreshAccessToken)).toHaveBeenCalledTimes(1);
    expect(new Headers(nativeFetch.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer token-2");
  });

  it("rotates accounts immediately on 429 before sleeping on the same account", async () => {
    const manager = createManager();
    manager.getCurrentOrNextForFamily = vi.fn(() => ({
      index: 1,
      email: "next@example.com",
      access: "token-2",
      accessToken: "token-2",
    }));

    const nativeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse(
          429,
          { error: { message: "rate limited", status: "RESOURCE_EXHAUSTED" } },
          { "retry-after": "7" },
        ),
      )
      .mockResolvedValueOnce(createJsonResponse(200, { ok: true }));

    const api = new SovereignAPI(manager, {} as any, "Sovereign", async () => createOAuthAuth(), nativeFetch);
    const response = await api.fetch(MODEL_URL, {
      method: "POST",
      headers: { Authorization: "Bearer token-1" },
    });

    expect(response.ok).toBe(true);
    expect(manager.markRateLimited).toHaveBeenCalledTimes(1);
    expect(new Headers(nativeFetch.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer token-2");
  });

  it("aborts while waiting in retry backoff after a 429 response", async () => {
    vi.useFakeTimers();

    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse(
        429,
        {
          error: {
            message: "Quota exhausted",
          },
        },
        { "retry-after": "30" },
      ),
    );
    const api = createApi(nativeFetch);
    const controller = new AbortController();

    const responsePromise = api.fetch(MODEL_URL, {
      method: "POST",
      headers: { Authorization: "Bearer token-1" },
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort(new Error("aborted during backoff"));

    await expect(responsePromise).rejects.toThrow("aborted during backoff");
  });
});
