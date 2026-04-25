import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissionArtifactPage, MissionModel, MissionTimelinePage } from "../../models/mission.model";
import type { BudgetStatus } from "../../orchestration/autonomy-types";
import { GatewayAuthManager } from "../../gateway/gateway-auth-manager";
import {
  createApproveAuthMiddleware,
  registerFormatWrapperMiddleware,
} from "../../gateway/rest-middleware";
import { MissionServiceError } from "../../services/mission.service";
import { registerMissionRoutes } from "./mission.router";

function createBudget(overrides: Partial<BudgetStatus> = {}): BudgetStatus {
  return {
    limits: {
      maxCycles: 12,
      maxDurationMs: 45 * 60 * 1000,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 400_000,
      maxTPM: 1_000_000,
      maxRPD: 5_000,
      maxUsd: 0,
    },
    usage: {
      cyclesUsed: 3,
      durationMsUsed: 10_000,
      inputTokensUsed: 25_000,
      outputTokensUsed: 2_500,
      currentTPM: 900_000,
      requestsUsed: 4_500,
      usdUsed: 0,
    },
    warning: true,
    warningReason: "BUDGET_WARNING: tpm 900000/1000000",
    exceeded: false,
    exceedReason: null,
    ...overrides,
  };
}

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Ship mission routes",
    account: "engineer@example.com",
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:05:00.000Z",
    state: "paused",
    currentPhase: "paused",
    currentGear: "standard",
    currentModel: "gemini-3-pro-high",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    scopePaths: ["src", "ui"],
    strictMode: true,
    anchorModel: "gemini-3-pro-high",
    gateResults: [],
    plan: {
      raw: "## Objective\n- Ship mission routes",
      objective: "Ship mission routes",
      scope: ["src"],
      currentPhase: "plan",
      currentModel: "gemini-3-pro-high",
      proposedSteps: ["Implement routes"],
      expectedTouchPoints: ["src/api/routers/mission.router.ts"],
      risks: ["auth drift"],
      nextAction: "Approve plan",
    },
    timeline: [
      {
        id: "timeline-1",
        timestamp: "2026-03-12T10:01:00.000Z",
        cycle: 1,
        state: "plan",
        taskId: null,
        note: "Planned",
      },
      {
        id: "timeline-2",
        timestamp: "2026-03-12T10:02:00.000Z",
        cycle: 1,
        state: "paused",
        taskId: null,
        note: "Paused",
      },
    ],
    artifacts: [
      {
        id: "artifact-1",
        kind: "plan",
        createdAt: "2026-03-12T10:01:00.000Z",
        value: "plan",
      },
    ],
    budget: createBudget(),
    touchedFiles: ["src/api/routers/mission.router.ts"],
    completedAt: null,
    error: null,
    stopReason: null,
    ...overrides,
    lastProgressAt: overrides.lastProgressAt ?? "2026-03-12T10:05:00.000Z",
  };
}

function createServiceMock() {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    getPlan: vi.fn(),
    approve: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    getArtifacts: vi.fn(),
    getTimeline: vi.fn(),
    getBudget: vi.fn(),
  };
}

async function createApp(options: {
  resolveActiveMissionAccount?: () => Promise<string | null>;
  service?: ReturnType<typeof createServiceMock>;
} = {}) {
  const app = fastify();
  const service = options.service ?? createServiceMock();
  const resolveActiveMissionAccount =
    options.resolveActiveMissionAccount ?? vi.fn().mockResolvedValue("engineer@example.com");
  const authManager = new GatewayAuthManager("approve-token");

  registerFormatWrapperMiddleware(app);
  registerMissionRoutes(app, {
    missionService: service as never,
    resolveActiveMissionAccount,
    approveAuth: createApproveAuthMiddleware(authManager),
    isQuotaStateReady: () => true,
  });
  await app.ready();

  return {
    app,
    service,
    resolveActiveMissionAccount,
  };
}

let appToClose: FastifyInstance | null = null;

afterEach(async () => {
  if (appToClose) {
    await appToClose.close();
    appToClose = null;
  }
});

describe("registerMissionRoutes", () => {
  it("creates missions with hidden defaults and returns received state", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.create).mockResolvedValue(createMission({ state: "received", currentPhase: "init" }));

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { prompt: "Ship mission routes", model: "fast_only" },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "engineer@example.com",
        anchorModel: "gemini-3-flash",
        objective: "Ship mission routes",
        gitMode: "patch_only",
        modelPolicy: "smart_multi",
        startMode: "immediate",
        reviewAfterPlan: true,
        strictMode: true,
        scope: { mode: "selected_only", paths: ["src", "ui", "docs", "vscode-extension"] },
      }),
    );

    const body = response.json();
    expect(body.data).toEqual({
      id: "mission-1",
      state: "received",
      createdAt: "2026-03-12T10:00:00.000Z",
    });
    expect(body.errors).toEqual([]);
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("maps each public model preference to the expected anchor model", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.create).mockResolvedValue(createMission({ state: "received", currentPhase: "init" }));

    const cases = [
      { model: undefined, anchorModel: "gemini-3-pro-high" },
      { model: "smart_multi", anchorModel: "gemini-3-pro-high" },
      { model: "fast_only", anchorModel: "gemini-3-flash" },
      { model: "pro_only", anchorModel: "claude-opus-4-5-thinking" },
    ] as const;

    for (const testCase of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/missions",
        payload:
          testCase.model === undefined
            ? { prompt: "Ship mission routes" }
            : { prompt: "Ship mission routes", model: testCase.model },
      });

      expect(response.statusCode).toBe(201);
    }

    expect(service.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ anchorModel: "gemini-3-pro-high" }),
    );
    expect(service.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ anchorModel: "gemini-3-pro-high" }),
    );
    expect(service.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ anchorModel: "gemini-3-flash" }),
    );
    expect(service.create).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ anchorModel: "claude-opus-4-5-thinking" }),
    );
  });

  it("returns 422 for empty or oversized prompt", async () => {
    const { app } = await createApp();
    appToClose = app;

    const emptyResponse = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { prompt: "   " },
    });
    expect(emptyResponse.statusCode).toBe(422);
    expect(emptyResponse.json().errors[0].code).toBe("VALIDATION_ERROR");

    const longResponse = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { prompt: "x".repeat(2001) },
    });
    expect(longResponse.statusCode).toBe(422);
    expect(longResponse.json().errors[0].code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 when no active or refreshable mission account is available", async () => {
    const { app } = await createApp({
      resolveActiveMissionAccount: vi.fn().mockResolvedValue(null),
    });
    appToClose = app;

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { prompt: "Ship mission routes" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().errors[0].code).toBe("UNAUTHORIZED");
  });

  it("returns mission details and missing mission 404", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.getById).mockResolvedValueOnce(createMission({ state: "coding", currentPhase: "execute" }));
    vi.mocked(service.getById).mockRejectedValueOnce(
      new MissionServiceError("MISSION_NOT_FOUND", "Mission missing"),
    );

    const success = await app.inject({
      method: "GET",
      url: "/api/missions/mission-1",
    });
    expect(success.statusCode).toBe(200);
    expect(success.json().data.state).toBe("coding");
    expect(success.json().data.currentPhase).toBe("execute");

    const missing = await app.inject({
      method: "GET",
      url: "/api/missions/missing",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errors[0].code).toBe("MISSION_NOT_FOUND");
  });

  it("maps PLAN_NOT_AVAILABLE to PLAN_NOT_READY", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.getPlan).mockRejectedValue(
      new MissionServiceError("PLAN_NOT_AVAILABLE", "Plan missing"),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/mission-1/plan",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().errors[0].code).toBe("PLAN_NOT_READY");
  });

  it("returns ready plans directly", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.getPlan).mockResolvedValue(createMission().plan!);

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/mission-1/plan",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      objective: "Ship mission routes",
      nextAction: "Approve plan",
    });
  });

  it("approves plans with bearer auth and rejects missing auth or invalid state", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.approve).mockResolvedValueOnce(undefined).mockRejectedValueOnce(
      new MissionServiceError("INVALID_STATE_TRANSITION", "Not in plan review"),
    );

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().errors[0].code).toBe("UNAUTHORIZED");

    const queryToken = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve?token=approve-token",
    });
    expect(queryToken.statusCode).toBe(401);
    expect(queryToken.json().errors[0].code).toBe("UNAUTHORIZED");

    const apiKeyOnly = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
      headers: { "x-api-key": "approve-token" },
    });
    expect(apiKeyOnly.statusCode).toBe(401);
    expect(apiKeyOnly.json().errors[0].code).toBe("UNAUTHORIZED");

    const approved = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
      headers: { authorization: "Bearer approve-token" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toEqual({ id: "mission-1", state: "coding" });

    const invalidState = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/approve",
      headers: { authorization: "Bearer approve-token" },
    });
    expect(invalidState.statusCode).toBe(422);
    expect(invalidState.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
  });

  it("pauses and cancels missions with deterministic response states", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.pause).mockResolvedValueOnce(undefined).mockRejectedValueOnce(
      new MissionServiceError("INVALID_STATE_TRANSITION", "Already paused"),
    );
    vi.mocked(service.cancel).mockResolvedValueOnce(undefined).mockRejectedValueOnce(
      new MissionServiceError("INVALID_STATE_TRANSITION", "Terminal"),
    );

    const pauseOk = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/pause",
    });
    expect(pauseOk.statusCode).toBe(200);
    expect(pauseOk.json().data).toEqual({ id: "mission-1", state: "paused" });

    const pauseInvalid = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/pause",
    });
    expect(pauseInvalid.statusCode).toBe(422);

    const cancelOk = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/cancel",
    });
    expect(cancelOk.statusCode).toBe(200);
    expect(cancelOk.json().data).toEqual({ id: "mission-1", state: "cancelled" });

    const cancelInvalid = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/cancel",
    });
    expect(cancelInvalid.statusCode).toBe(422);
  });

  it("projects resume state from the last non-paused timeline entry and falls back to received", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.getById)
      .mockResolvedValueOnce(createMission())
      .mockResolvedValueOnce(createMission({ timeline: [] }));
    vi.mocked(service.resume).mockResolvedValue(undefined);

    const projected = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/resume",
    });
    expect(projected.statusCode).toBe(200);
    expect(projected.json().data).toEqual({ id: "mission-1", state: "planning" });

    const fallback = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/resume",
    });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json().data).toEqual({ id: "mission-1", state: "received" });
  });

  it("rejects invalid resume transitions", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.getById).mockResolvedValue(createMission({ timeline: [] }));
    vi.mocked(service.resume).mockRejectedValue(
      new MissionServiceError("INVALID_STATE_TRANSITION", "Not paused"),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/missions/mission-1/resume",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().errors[0].code).toBe("INVALID_STATE_TRANSITION");
  });

  it("serves cursor-paginated artifacts and validates limit", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    const page: MissionArtifactPage = {
      items: [
        {
          id: "artifact-1",
          kind: "plan",
          createdAt: "2026-03-12T10:01:00.000Z",
          value: "plan",
        },
      ],
      nextCursor: "artifact-1",
      hasMore: true,
      total: 3,
    };
    vi.mocked(service.getArtifacts).mockResolvedValue(page);

    const success = await app.inject({
      method: "GET",
      url: "/api/missions/mission-1/artifacts?cursor=artifact-0&limit=50",
    });
    expect(success.statusCode).toBe(200);
    expect(service.getArtifacts).toHaveBeenCalledWith("mission-1", "artifact-0", 50);
    expect(success.json().meta).toMatchObject({
      nextCursor: "artifact-1",
      hasMore: true,
      total: 3,
    });

    const invalid = await app.inject({
      method: "GET",
      url: "/api/missions/mission-1/artifacts?limit=201",
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().errors[0].code).toBe("VALIDATION_ERROR");
  });

  it("serves ascending timeline pages with cursor semantics", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    const page: MissionTimelinePage = {
      items: [
        {
          id: "event-3",
          missionId: "mission-1",
          type: "mission.state",
          payload: { state: "execute" },
          createdAt: "2026-03-12T10:03:00.000Z",
        },
      ],
      nextCursor: null,
      hasMore: false,
    };
    vi.mocked(service.getTimeline).mockResolvedValue(page);

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/mission-1/timeline?cursor=event-2&limit=50",
    });

    expect(response.statusCode).toBe(200);
    expect(service.getTimeline).toHaveBeenCalledWith("mission-1", "event-2", 50);
    expect(response.json().data[0].id).toBe("event-3");
    expect(response.json().meta).toMatchObject({
      nextCursor: null,
      hasMore: false,
    });
  });

  it("returns mapped budget payload with warning flags", async () => {
    const { app, service } = await createApp();
    appToClose = app;
    vi.mocked(service.getBudget).mockResolvedValue(
      createBudget({
        usage: {
          cyclesUsed: 6,
          durationMsUsed: 10_000,
          inputTokensUsed: 25_000,
          outputTokensUsed: 2_500,
          currentTPM: 1_100_000,
          requestsUsed: 5_100,
          usdUsed: 0,
        },
        warning: true,
        warningReason: "BUDGET_WARNING: tpm 1100000/1000000",
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/mission-1/budget",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      tpm: { used: 1_100_000, limit: 1_000_000, percentage: 110 },
      rpd: { used: 5_100, limit: 5_000, percentage: 102 },
      cycles: { used: 6, limit: 12, percentage: 50 },
      warning: true,
      warningReason: "BUDGET_WARNING: tpm 1100000/1000000",
      exceeded: false,
    });
  });
});
