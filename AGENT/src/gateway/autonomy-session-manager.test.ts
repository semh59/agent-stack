import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutonomySessionManager } from "./autonomy-session-manager";

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForState(
  manager: AutonomySessionManager,
  sessionId: string,
  targetState: "stopped" | "failed" | "done",
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const session = manager.getSession(sessionId);
    if (session?.state === targetState) {
      return session;
    }
    await sleep(50);
  }

  throw new Error(`Timed out waiting for session ${sessionId} to reach ${targetState}`);
}

async function waitForFetchCall(fetchSpy: ReturnType<typeof vi.fn>) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (fetchSpy.mock.calls.length > 0) {
      return;
    }
    await sleep(50);
  }

  throw new Error("Timed out waiting for model fetch to start");
}

function createTokenStore() {
  return {
    getValidAccessToken: vi.fn().mockResolvedValue("test-access-token"),
    getActiveToken: vi.fn().mockReturnValue({
      accessToken: "test-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
      email: "user@example.com",
      createdAt: Date.now(),
    }),
  };
}

describe("AutonomySessionManager", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autonomy-session-manager-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rm(projectRoot, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 4) {
          throw error;
        }
        await sleep(50);
      }
    }
  });

  it("aborts an in-flight model request when STOP is issued during latency", async () => {
    let aborted = false;

    const fetchSpy = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(
            new Response(
              JSON.stringify({
                candidates: [
                  {
                    content: {
                      parts: [{ text: "{\"summary\":\"ok\",\"touchedFiles\":[]}" }],
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            ),
          );
        }, 10_000);

        const onAbort = () => {
          aborted = true;
          clearTimeout(timeout);
          reject(
            init?.signal?.reason instanceof Error
              ? init.signal.reason
              : new Error("Aborted"),
          );
        };

        if (init?.signal?.aborted) {
          onAbort();
          return;
        }

        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
    });

    vi.stubGlobal("fetch", fetchSpy);

    const tokenStore = createTokenStore();

    const manager = new AutonomySessionManager({
      projectRoot,
      tokenStore: tokenStore as any,
      getAccountManager: () => null,
    });

    const session = manager.startSession({
      account: "user@example.com",
      anchorModel: "gemini-3-pro-high",
      objective: "Abort delayed mission cleanly",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      startMode: "immediate",
      budgets: {
        maxCycles: 5,
        maxDurationMs: 60_000,
        maxInputTokens: 100_000,
        maxOutputTokens: 50_000,
        maxTPM: 10_000,
        maxRPD: 100,
      },
    });

    await waitForFetchCall(fetchSpy);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(manager.stopSession(session.id, "User stop")).toBe(true);

    const finalSession = await waitForState(manager, session.id, "stopped");
    expect(aborted).toBe(true);
    expect(finalSession.state).toBe("stopped");
    expect(finalSession.stopReason).toBe("User stop");
  });

  it("recovery chain 2a: strict parse fails and fenced recovery succeeds", async () => {
    const manager = new AutonomySessionManager({
      projectRoot,
      tokenStore: createTokenStore() as any,
      getAccountManager: () => null,
    });

    const parsed = (manager as any).parseModelPayload([
      "Model output below:",
      "```json",
      "{\"summary\":\"Recovered fenced payload\",\"touchedFiles\":[\"src/recovered.ts\"]}",
      "```",
    ].join("\n"));

    expect(parsed.summary).toBe("Recovered fenced payload");
    expect(parsed.touchedFiles).toEqual(["src/recovered.ts"]);
  });

  it("recovery chain 2b: strict + fenced fail and summary-only fallback succeeds", async () => {
    const manager = new AutonomySessionManager({
      projectRoot,
      tokenStore: createTokenStore() as any,
      getAccountManager: () => null,
    });

    const parsed = (manager as any).parseModelPayload(
      "Execution completed with no structured payload. Changes applied safely.",
    );

    expect(parsed.summary).toContain("Execution completed");
    expect(parsed.touchedFiles).toEqual([]);
  });

  it("recovery chain 2c: JSON-like payload fails strict/fenced and hard-fails without summary fallback", async () => {
    const manager = new AutonomySessionManager({
      projectRoot,
      tokenStore: createTokenStore() as any,
      getAccountManager: () => null,
    });

    expect(() => (manager as any).parseModelPayload("{\"summary\":\"broken\",\"touchedFiles\":[\"src/a.ts\"]"))
      .toThrow("MODEL_PAYLOAD_PARSE_ERROR");
  });

  it("mission fails when JSON-like payload cannot be recovered", async () => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "{\"summary\":\"broken\",\"touchedFiles\":[\"src/a.ts\"]" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    vi.stubGlobal("fetch", fetchSpy);

    const manager = new AutonomySessionManager({
      projectRoot,
      tokenStore: createTokenStore() as any,
      getAccountManager: () => null,
    });

    const session = manager.startSession({
      account: "user@example.com",
      anchorModel: "gemini-3-pro-high",
      objective: "Parse failure should hard-fail mission",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      startMode: "immediate",
      taskGraph: [
        {
          id: "impl-parse-fail",
          type: "implementation",
          status: "pending",
          attempts: 0,
          maxAttempts: 1,
          updatedAt: new Date().toISOString(),
        },
      ],
      budgets: {
        maxCycles: 3,
        maxDurationMs: 60_000,
        maxInputTokens: 100_000,
        maxOutputTokens: 50_000,
        maxTPM: 10_000,
        maxRPD: 100,
      },
    });

    const finalSession = await waitForState(manager, session.id, "failed");
    expect(finalSession.error).toContain("MODEL_PAYLOAD_PARSE_ERROR");
  });

  it("applies custom model request timeout and fails hung requests", async () => {
    const fetchSpy = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          reject(
            init?.signal?.reason instanceof Error
              ? init.signal.reason
              : new Error(String(init?.signal?.reason ?? "Aborted")),
          );
        };

        if (init?.signal?.aborted) {
          onAbort();
          return;
        }
        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
    });

    vi.stubGlobal("fetch", fetchSpy);

    const manager = new AutonomySessionManager({
      projectRoot,
      tokenStore: createTokenStore() as any,
      getAccountManager: () => null,
      modelRequestTimeoutMs: 50,
    });

    const session = manager.startSession({
      account: "user@example.com",
      anchorModel: "gemini-3-pro-high",
      objective: "Timeout hard fail test",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      startMode: "immediate",
      taskGraph: [
        {
          id: "impl-timeout",
          type: "implementation",
          status: "pending",
          attempts: 0,
          maxAttempts: 1,
          updatedAt: new Date().toISOString(),
        },
      ],
      budgets: {
        maxCycles: 3,
        maxDurationMs: 60_000,
        maxInputTokens: 100_000,
        maxOutputTokens: 50_000,
        maxTPM: 10_000,
        maxRPD: 100,
      },
    });

    const finalSession = await waitForState(manager, session.id, "failed");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(finalSession.state).toBe("failed");
    expect(finalSession.error?.toLowerCase()).toContain("timeout");
  });

  it("uses 90_000ms as default local fail-fast timeout source", () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const manager = new AutonomySessionManager({
      projectRoot,
      tokenStore: createTokenStore() as any,
      getAccountManager: () => null,
    });

    (manager as any).createModelRequestSignal();

    expect(timeoutSpy).toHaveBeenCalledWith(90_000);
  });
});
