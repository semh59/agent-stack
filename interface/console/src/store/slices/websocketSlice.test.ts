/* eslint-disable @typescript-eslint/no-explicit-any */
import { createWebSocketSlice, maskPII, __resetWebSocketSliceForTests } from "./websocketSlice";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

class MockWebSocket {
  public static instances: MockWebSocket[] = [];

  public readyState = 1;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((error: Error) => void) | null = null;
  public readonly url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  public close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  public emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  public emitRawMessage(payload: string): void {
    this.onmessage?.({ data: payload });
  }

  public static reset(): void {
    MockWebSocket.instances = [];
  }
}

function createHarness(overrides: Record<string, unknown> = {}) {
  const state: any = {
    gatewayToken: "gateway-token",
    activeSessionId: "session-1",
    autonomySessionId: "session-1",
    autonomySession: null,
    autonomyTimeline: [],
    activeDiff: [],
    gateStatus: null,
    budgetStatus: null,
    pipelineStatus: { status: "running", state: { pipelineStatus: "running" } },
    analyticsBySession: {},
    sessionsById: {
      "session-1": {
        id: "session-1",
        state: "execute",
        objective: "Initial mission",
        account: "agent@test.dev",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
        queuePosition: 1,
        branchName: null,
        baseBranch: null,
        commitHash: null,
        currentModel: "gemini-3-pro-high",
        currentGear: "elite",
        reviewStatus: "none",
        reviewUpdatedAt: null,
      },
    },
    sessionOrder: ["session-1"],
    timelineBySession: {},
    gateBySession: {},
    budgetBySession: {},
    diffBySession: {},
    planArtifactsBySession: {},
    queue: [],
    lastError: null,
    runPostBootInitialization: vi.fn(),
    fetchAutonomySessions: vi.fn(),
    fetchAutonomyQueue: vi.fn(),
    addLog: vi.fn(),
    setGatewayToken: vi.fn(),
    ...overrides,
  };

  const set = vi.fn((updater: unknown) => {
    const next = typeof updater === "function" ? (updater as (current: any) => any)(state) : updater;
    if (next && typeof next === "object") {
      Object.assign(state, next);
    }
  });
  const get = vi.fn(() => state);
  const slice = createWebSocketSlice(set as any, get as any, {} as any);
  Object.assign(state, slice);

  return { state, set, get, slice };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForSocketCount(expectedCount: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (MockWebSocket.instances.length === expectedCount) {
      return;
    }
    await flushAsyncWork();
  }
  expect(MockWebSocket.instances).toHaveLength(expectedCount);
}

beforeEach(() => {
  __resetWebSocketSliceForTests();
  MockWebSocket.reset();
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", MockWebSocket as any);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ticket: `ticket-${Date.now()}` } }),
    } as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  __resetWebSocketSliceForTests();
  MockWebSocket.reset();
});

describe("websocketSlice", () => {
  it("rehydrates snapshot state on reconnect and avoids duplicate sockets for the same mission", async () => {
    const { state, slice } = createHarness({
      sessionsById: {
        "session-1": {
          id: "session-1",
          state: "verify",
          objective: "Reconnect mission",
          account: "agent@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:30:00.000Z",
          queuePosition: 1,
          branchName: "feat/reconnect",
          baseBranch: "main",
          commitHash: "abc123",
          currentModel: "gemini-3-pro-high",
          currentGear: "elite",
          reviewStatus: "none",
          reviewUpdatedAt: null,
        },
      },
      timelineBySession: {
        "session-1": [
          {
            id: "stale-entry",
            type: "step",
            timestamp: "2026-03-11T00:00:00.000Z",
            message: "stale timeline",
          },
        ],
      },
    });

    slice.subscribeAutonomyEvents("session-1");
    await waitForSocketCount(1);

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/api/missions/session-1/ws-ticket");

    const firstSocket = MockWebSocket.instances[0]!;
    expect(firstSocket.url).toContain("/ws/mission/session-1");
    const stateAtDisconnect = state.sessionsById["session-1"].state;
    firstSocket.close();

    await vi.advanceTimersByTimeAsync(3000);
    await flushAsyncWork();

    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.emitMessage({
      type: "autonomyEvent",
      sessionId: "session-1",
      eventType: "snapshot",
      timestamp: "2026-03-11T01:00:00.000Z",
      payload: {
        selectedSession: {
          id: "session-1",
          state: "verify",
          objective: "Reconnect mission",
          account: "agent@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T01:00:00.000Z",
          queuePosition: 1,
          branchName: "feat/reconnect",
          baseBranch: "main",
          commitHash: "abc123",
          currentModel: "claude-opus-4-5-thinking",
          currentGear: "elite",
          reviewStatus: "plan_pending",
          reviewUpdatedAt: "2026-03-11T01:00:00.000Z",
        },
        queue: [
          {
            sessionId: "session-1",
            state: "verify",
            objective: "Reconnect mission",
            account: "agent@test.dev",
            createdAt: "2026-03-11T00:00:00.000Z",
            queuePosition: 1,
          },
        ],
        touchedFiles: ["src/store/websocketSlice.ts"],
        budgets: {
          limits: {
            maxCycles: 10,
            maxDurationMs: 60000,
            maxInputTokens: 1000,
            maxOutputTokens: 500,
            maxTPM: 1200,
            maxRPD: 20,
            maxUsd: 1,
          },
          usage: {
            cyclesUsed: 4,
            durationMsUsed: 12000,
            inputTokensUsed: 420,
            outputTokensUsed: 90,
            currentTPM: 510,
            requestsUsed: 4,
            usdUsed: 0.14,
          },
          warning: true,
          warningReason: "BUDGET_WARNING: tpm 510/1200",
          exceeded: false,
          exceedReason: null,
        },
        artifacts: {
          plan: "# Plan Review\n\n## Objective\nReconnect mission",
          changeSummary: "summary",
          nextActionReason: "review",
          gateResult: {
            passed: false,
            blockingIssues: ["Reconnect review required"],
            impactedScopes: ["ui"],
            audit: { critical: 0, high: 1, moderate: 0, low: 0, total: 1 },
          },
          rawResponses: [],
          contextPack: "ctx",
        },
        timeline: [
          {
            cycle: 1,
            state: "plan",
            taskId: "task-1",
            note: "plan prepared",
            timestamp: "2026-03-11T00:10:00.000Z",
          },
          {
            cycle: 2,
            state: "verify",
            taskId: "task-2",
            note: "verification resumed",
            timestamp: "2026-03-11T00:20:00.000Z",
          },
        ],
      },
    });

    expect(state.sessionsById["session-1"].state).toBe("verify");
    expect(state.sessionsById["session-1"].state).toBe(stateAtDisconnect);
    expect(state.autonomySession?.state).toBe("verify");
    expect(state.autonomySession?.currentModel).toBe("claude-opus-4-5-thinking");
    expect(state.autonomySession?.currentGear).toBe("elite");
    expect(state.autonomySession?.reviewStatus).toBe("plan_pending");
    expect(state.timelineBySession["session-1"]).toHaveLength(2);
    expect(state.timelineBySession["session-1"][0].message).toBe("plan prepared");
    expect(state.timelineBySession["session-1"][0].id).not.toBe("stale-entry");
    expect(state.gateBySession["session-1"]?.passed).toBe(false);
    expect(state.budgetBySession["session-1"]?.usage.inputTokensUsed).toBe(420);
    expect(state.budgetBySession["session-1"]?.usage.currentTPM).toBe(510);
    expect(state.budgetBySession["session-1"]?.limits.maxRPD).toBe(20);
    expect(state.budgetBySession["session-1"]?.warning).toBe(true);
    expect(state.diffBySession["session-1"]).toEqual(["src/store/websocketSlice.ts"]);
    expect(state.planArtifactsBySession["session-1"]?.plan).toContain("Reconnect mission");
    expect(state.pipelineStatus.state.pipelineStatus).toBe("running");

    slice.subscribeAutonomyEvents("session-1");
    await flushAsyncWork();

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("cleans up the previous mission socket on session switch and reconnects only the active session", async () => {
    const { slice } = createHarness({
      activeSessionId: "session-1",
      autonomySessionId: "session-1",
      sessionsById: {
        "session-1": {
          id: "session-1",
          state: "execute",
          objective: "Mission one",
          account: "agent@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:00:00.000Z",
          queuePosition: 1,
          branchName: null,
          baseBranch: null,
          commitHash: null,
          currentModel: "gemini-3-pro-high",
          currentGear: "elite",
          reviewStatus: "none",
          reviewUpdatedAt: null,
        },
        "session-2": {
          id: "session-2",
          state: "verify",
          objective: "Mission two",
          account: "agent@test.dev",
          createdAt: "2026-03-11T00:01:00.000Z",
          updatedAt: "2026-03-11T00:01:00.000Z",
          queuePosition: 2,
          branchName: null,
          baseBranch: null,
          commitHash: null,
          currentModel: "claude-opus-4-5-thinking",
          currentGear: "elite",
          reviewStatus: "plan_pending",
          reviewUpdatedAt: "2026-03-11T00:01:00.000Z",
        },
      },
      sessionOrder: ["session-1", "session-2"],
    });

    slice.subscribeAutonomyEvents("session-1");
    await waitForSocketCount(1);

    const firstSocket = MockWebSocket.instances[0]!;
    slice.subscribeAutonomyEvents("session-2");
    await waitForSocketCount(2);

    expect(firstSocket.readyState).toBe(3);

    await vi.advanceTimersByTimeAsync(3000);
    await flushAsyncWork();
    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.close();
    await vi.advanceTimersByTimeAsync(3000);
    await flushAsyncWork();

    expect(MockWebSocket.instances).toHaveLength(3);
    expect(MockWebSocket.instances[2]?.url).toContain("session-2");
  });

  it("marks the autonomy transport as fatal on malformed websocket payloads", async () => {
    const { state, slice } = createHarness();

    slice.subscribeAutonomyEvents("session-1");
    await waitForSocketCount(1);

    MockWebSocket.instances[0]!.emitRawMessage("{\"type\":");

    expect(state.wsTransportState).toBe("fatal");
    expect(state.wsFatalError?.code).toBe("AUTONOMY_WS_PARSE_ERROR");
  });

  it("shows fatal transport fallback on snapshot_error envelopes", () => {
    const { state, slice } = createHarness();

    slice.handleMessageData({
      type: "snapshot_error",
      sessionId: "session-1",
      payload: {
        message: "Mission snapshot was truncated beyond the transport limit.",
      },
    });

    expect(state.wsTransportState).toBe("fatal");
    expect(state.wsFatalError?.code).toBe("SNAPSHOT_ERROR");
  });

  it("handles gate_bypass event correctly", () => {
    const set = vi.fn();
    const get = vi.fn(() => ({
      selectedSessionId: "session-1",
      sessionsById: {
        "session-1": { id: "session-1", timeline: [], state: "execute" }
      },
      sessionOrder: ["session-1"],
      timelineBySession: {},
      gateBySession: {},
      budgetBySession: {},
      diffBySession: {},
      planArtifactsBySession: {},
      queue: []
    }));

    const slice = createWebSocketSlice(set, get as any, {} as any);
    
    const event = {
      type: "autonomyEvent",
      sessionId: "session-1",
      eventType: "gate_bypass",
      timestamp: new Date().toISOString(),
      payload: {
        taskId: "task-123",
        reasonCode: "BYPASS",
        passed: true,
        blockingIssues: [],
        auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 }
      }
    };

    slice.handleMessageData(event);

    // Expect set to be called inside handleAutonomyEvent
    expect(set).toHaveBeenCalled();
    
    // The set call in handleAutonomyEvent wraps the whole update
    const updater = set.mock.calls[0]![0];
    const mockState = get();
    const newState = typeof updater === "function" ? updater(mockState as any) : updater;
    
    // Check if timeline entry was added
    expect(newState.timelineBySession["session-1"]).toBeDefined();
    expect(newState.timelineBySession["session-1"].length).toBe(1);
    expect(newState.gateBySession["session-1"]).toBeDefined();
    expect(newState.gateBySession["session-1"].passed).toBe(true);
  });

  it("handles interrupted event correctly", () => {
    const set = vi.fn();
    const get = vi.fn(() => ({
      selectedSessionId: "session-1",
      sessionsById: {
        "session-1": { id: "session-1", timeline: [], state: "execute" }
      },
      sessionOrder: ["session-1"],
      timelineBySession: {},
      gateBySession: {},
      budgetBySession: {},
      diffBySession: {},
      planArtifactsBySession: {},
      queue: []
    }));

    const slice = createWebSocketSlice(set, get as any, {} as any);
    
    const event = {
      type: "autonomyEvent",
      sessionId: "session-1",
      eventType: "interrupted",
      timestamp: new Date().toISOString(),
      payload: {
        reason: "User request"
      }
    };

    slice.handleMessageData(event);

    expect(set).toHaveBeenCalled();
    const updater = set.mock.calls[0]![0];
    const newState = typeof updater === "function" ? updater(get() as any) : updater;
    
    expect(newState.sessionsById["session-1"].state).toBe("stopped");
  });

  describe("PII Masking Layer", () => {
    const handleAutonomyWithPayload = (payload: any) => {
      const set = vi.fn();
      const get = vi.fn(() => ({
        selectedSessionId: "session-1",
        sessionsById: { "session-1": { id: "session-1", timeline: [], state: "execute" } },
        sessionOrder: ["session-1"],
        timelineBySession: {},
        gateBySession: {},
        budgetBySession: {},
        diffBySession: {},
        planArtifactsBySession: {},
        queue: []
      }));
      const slice = createWebSocketSlice(set, get as any, {} as any);
      slice.handleMessageData({
        type: "autonomyEvent",
        sessionId: "session-1",
        eventType: "step",
        timestamp: new Date().toISOString(),
        payload
      });
      const updater = set.mock.calls[0]![0];
      return typeof updater === "function" ? updater(get() as any) : updater;
    };

    it("masks email addresses even inside URLs", () => {
      const state = handleAutonomyWithPayload({ 
        message: "Contact support at help@lojinxt.com or go to https://app.lojinxt.com/user/semih@alloy.com/settings" 
      });
      const entry = state.timelineBySession["session-1"][0];
      expect(entry.message).toContain("[EMAIL_MASKED]");
      expect(entry.message).not.toContain("semih@alloy.com");
      expect(entry.message).not.toContain("help@lojinxt.com");
    });

    it("masks Turkish TCKN (11 digits) in the middle of a string", () => {
      const state = handleAutonomyWithPayload({ 
        message: "User with ID 12345678901 is attempting access." 
      });
      const entry = state.timelineBySession["session-1"][0];
      expect(entry.message).toContain("[TCKN_MASKED]");
      expect(entry.message).not.toContain("12345678901");
    });

    it("masks international and local phone numbers", () => {
      const state = handleAutonomyWithPayload({ 
        message: "Call +905321234567 or 05419876543 for more info" 
      });
      const entry = state.timelineBySession["session-1"][0];
      expect(entry.message.match(/\[PHONE_MASKED\]/g)?.length).toBe(2);
      expect(entry.message).not.toContain("905321234567");
      expect(entry.message).not.toContain("05419876543");
    });

    it("handles multiple different PII types in a single complex payload object", () => {
      const state = handleAutonomyWithPayload({ 
        user: { 
          email: "admin@alloy.com", 
          phone: "05321112233",
          meta: "Internal ID: 11122233344"
        } 
      });
      const entry = state.timelineBySession["session-1"][0];
      const p = entry.payload as any;
      expect(p.user.email).toBe("[EMAIL_MASKED]");
      expect(p.user.phone).toBe("[PHONE_MASKED]");
      expect(p.user.meta).toContain("[TCKN_MASKED]");
    });

    it("does not produce false positives for regular numbers and codes", () => {
      const state = handleAutonomyWithPayload({ 
        message: "Status code 200, version 1.9.4, count: 42, orderID: #ABC-123" 
      });
      const entry = state.timelineBySession["session-1"][0];
      expect(entry.message).toContain("200");
      expect(entry.message).toContain("1.9.4");
      expect(entry.message).not.toContain("MASKED");
    });

    it("masks emails inside complex URL structures", () => {
      const urlPayload = { text: "Visit https://lojunext.ai/user/test.user@gmail.com/profile for details." };
      const maskedUrl = maskPII(urlPayload) as any;
      expect(maskedUrl.text).toContain("[EMAIL_MASKED]");
      expect(maskedUrl.text).not.toContain("test.user@gmail.com");
    });

    it("does not mask numeric strings that are not exactly 11 digits (TCKN guard)", () => {
      const versionPayload = { text: "Build version v1.123456789012.patch" }; // 12 digits
      const maskedVersion = maskPII(versionPayload);
      expect(maskedVersion.text).toBe(versionPayload.text);
    });

    it("masks multiple PII types in nested objects", () => {
      const nestedPayload = { 
        user: {
          id: "TCKN: 12345678901",
          contact: "Call me at +905321234567 or mail to info@lojunext.ai"
        }
      };
      const maskedNested = maskPII(nestedPayload);
      expect(maskedNested.user.id).toBe("TCKN: [TCKN_MASKED]");
      expect(maskedNested.user.contact).toContain("[PHONE_MASKED]");
      expect(maskedNested.user.contact).toContain("[EMAIL_MASKED]");
    });

    it("does not mask IP addresses as phone numbers", () => {
      const ipPayload = { text: "Server IP: 192.168.1.1" };
      const maskedIp = maskPII(ipPayload);
      expect(maskedIp.text).toBe(ipPayload.text);
    });
  });
});
