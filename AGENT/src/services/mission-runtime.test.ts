import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutonomyMissionRuntime } from "./mission-runtime";
import { AutonomySessionManager } from "../gateway/autonomy-session-manager";
import { TokenStore } from "../gateway/token-store";
import { AccountManager } from "../plugin/accounts";
import { BudgetTracker } from "../orchestration/BudgetTracker";
import { SovereignGatewayClient } from "../orchestration/gateway-client";
import type { CreateAutonomySessionRequest } from "../orchestration/autonomy-types";

vi.mock("../orchestration/gateway-client", () => ({
  SovereignGatewayClient: {
    fromToken: vi.fn(),
  },
}));

describe("Mission Runtime Integration (Golden Path)", () => {
  let runtime: AutonomyMissionRuntime;
  let sessionManager: AutonomySessionManager;
  let mockTokenStore: any;
  let mockAccountManager: any;
  let mockBudgetTracker: any;

  beforeEach(() => {
    // 1. Mock dependencies
    mockTokenStore = {
      getValidAccessToken: vi.fn().mockResolvedValue("test-token"),
      getActiveToken: vi.fn().mockReturnValue({ email: "test@example.com" }),
    };

    mockAccountManager = {
      switchToAccountByEmail: vi.fn(),
      loadFromDisk: vi.fn().mockResolvedValue({}),
      getAccountCount: vi.fn().mockReturnValue(1),
    };

    mockBudgetTracker = {
      reserve: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: { reservationId: "res-123" },
      }),
      commit: vi.fn().mockResolvedValue({
        usage: { promptTokenCount: 10, candidatesTokenCount: 20 },
        cachedInputTokens: 0,
      }),
      release: vi.fn().mockResolvedValue(true),
      releaseAllForSession: vi.fn().mockResolvedValue(true),
      attachSession: vi.fn(),
      detachSession: vi.fn(),
    };

    // Mock SovereignGatewayClient instance
    const mockClient = {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"summary": "Done", "touchedFiles": []}' }],
              },
            },
          ],
          response: {
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
          },
        }),
      }),
    };
    (SovereignGatewayClient.fromToken as any).mockReturnValue(mockClient);

    // 2. Initialize manager
    sessionManager = new AutonomySessionManager({
      projectRoot: "/tmp/project",
      tokenStore: mockTokenStore,
      getAccountManager: () => mockAccountManager,
      budgetTracker: mockBudgetTracker,
    });

    // 3. Initialize runtime
    runtime = new AutonomyMissionRuntime(sessionManager);
  });

  const createValidRequest = (): CreateAutonomySessionRequest => ({
    objective: "Test objective",
    scope: { mode: "selected_only", paths: ["src/"] },
    startMode: "immediate",
    account: "test@example.com",
    anchorModel: "gemini-2.0-pro",
    modelPolicy: "smart_multi",
    gitMode: "auto_branch_commit",
  });

  it("successfully starts and retrieves a mission", async () => {
    const request = createValidRequest();

    const session = runtime.startMission(request);
    expect(session.id).toBeDefined();
    expect(session.objective).toBe("Test objective");
    expect(session.state).toBe("init");

    const retrieved = runtime.getSession(session.id);
    expect(retrieved?.id).toBe(session.id);
  });

  it("pauses and resumes a mission", async () => {
    const request = createValidRequest();
    const session = runtime.startMission(request);
    
    const paused = await runtime.pauseMission(session.id, "reason");
    expect(paused).toBe(true);
    
    const resumed = await runtime.resumeMission(session.id, "reason");
    expect(resumed).toBe(true);
  });
  
  it("cancels a mission", async () => {
    const request = createValidRequest();
    const session = runtime.startMission(request);
    
    const cancelled = await runtime.cancelMission(session.id, "reason");
    expect(cancelled).toBe(true);
  });
});
