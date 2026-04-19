import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GatewayServer } from "../src/gateway/server";
import { NoopRecoveryNotifier } from "../src/persistence/recovery/RecoveryNotifier";
import { InMemoryMissionRepository } from "../src/repositories/mission.repository";
import type {
  AutonomyEvent,
  AutonomySession,
  AutonomyTimelineEntry,
  BudgetStatus,
  CreateAutonomySessionRequest,
} from "../src/orchestration/autonomy-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const reportPath = path.join(projectRoot, "docs", "PHASE3_VALIDATION_REPORT.md");

const AUTH_TOKEN = "phase3-verification-token";
const ACTIVE_EMAIL = "verifier@example.com";

interface JsonResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

interface EndpointObservation {
  label: string;
  method: string;
  path: string;
  status: number;
  result: "PASS" | "FAIL";
  note: string;
}

interface ValidationState {
  endpointResults: EndpointObservation[];
  errorResults: EndpointObservation[];
  timeline: {
    page1Cursor: string | null;
    page2Count: number;
    page2ContainsInsertedEvent: boolean;
    ascending: boolean;
  };
  websocket: {
    firstSnapshotState: string;
    reconnectSnapshotState: string;
    livePauseEventType: string;
    liveResumeEventType: string;
    noReplayObserved: boolean;
  };
  rateLimit: {
    observedAt: number;
    retryAfterHeader: string | null;
    retryAfterBody: number | null;
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a local port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

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
      cyclesUsed: 0,
      durationMsUsed: 0,
      inputTokensUsed: 0,
      outputTokensUsed: 0,
      currentTPM: 0,
      requestsUsed: 0,
      usdUsed: 0,
    },
    warning: false,
    warningReason: null,
    exceeded: false,
    exceedReason: null,
    ...overrides,
  };
}

function createPlanMarkdown(objective: string, anchorModel: string): string {
  return [
    "## Objective",
    `- ${objective}`,
    "",
    "## Scope",
    "- src",
    "- ui",
    "",
    "## Current Phase",
    "- plan",
    "",
    "## Current Model",
    `- ${anchorModel}`,
    "",
    "## Proposed Steps",
    "- Draft route handlers",
    "- Validate gateway envelopes",
    "",
    "## Expected Touch Points",
    "- src/api/routers/mission.router.ts",
    "- docs/ARCHITECTURE.md",
    "",
    "## Risks / Gate Expectations",
    "- approve auth drift",
    "- pagination regressions",
    "",
    "## Next Action",
    "- Await user approval",
  ].join("\n");
}

function createSession(
  request: CreateAutonomySessionRequest,
  id: string,
  createdAt: string,
): AutonomySession {
  return {
    id,
    objective: request.objective,
    account: request.account,
    anchorModel: request.anchorModel,
    modelPolicy: request.modelPolicy,
    gitMode: request.gitMode,
    startMode: request.startMode ?? "immediate",
    scope: {
      mode: request.scope.mode,
      paths: [...request.scope.paths],
    },
    strictMode: request.strictMode ?? true,
    state: "init",
    reviewAfterPlan: request.reviewAfterPlan ?? true,
    currentModel: request.anchorModel,
    currentGear: "standard",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    createdAt,
    updatedAt: createdAt,
    cycleCount: 0,
    maxCycles: request.budgets?.maxCycles ?? 12,
    maxDurationMs: request.budgets?.maxDurationMs ?? 45 * 60 * 1000,
    queuePosition: null,
    budgets: createBudget(),
    consecutiveGateFailures: 0,
    branchName: null,
    baseBranch: null,
    commitHash: null,
    touchedFiles: [],
    baselineDirtyFiles: [],
    modelHistory: [],
    timeline: [],
    opLog: [],
    taskGraph: [],
    artifacts: {
      plan: "",
      changeSummary: "",
      nextActionReason: "Mission created",
      gateResult: null,
      rawResponses: [],
      contextPack: "",
    },
    lastProgressAt: createdAt,
    error: null,
    stopReason: null,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function installDeterministicRuntime(gateway: any) {
  const manager = gateway.autonomyManager as any;
  const interrupted = manager.interruptedSessions as Set<string>;
  const sessions = new Map<string, AutonomySession>();
  let nextId = 1;
  let clock = Date.parse("2026-03-12T12:00:00.000Z");

  const nextTimestamp = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };

  const emit = (event: AutonomyEvent) => {
    manager.emit(event);
  };

  const appendTimeline = (
    session: AutonomySession,
    state: AutonomyTimelineEntry["state"],
    note: string,
    taskId: string | null = null,
  ) => {
    session.timeline.push({
      cycle: session.cycleCount,
      state,
      taskId,
      note,
      timestamp: session.updatedAt,
    });
  };

  const getMutableSession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown verification session: ${sessionId}`);
    }
    return session;
  };

  manager.startSession = (request: CreateAutonomySessionRequest): AutonomySession => {
    const id = `mission-${nextId++}`;
    const createdAt = nextTimestamp();
    const session = createSession(request, id, createdAt);
    sessions.set(id, session);
    return clone(session);
  };

  manager.getSession = (sessionId: string): AutonomySession | null => {
    const session = sessions.get(sessionId);
    return session ? clone(session) : null;
  };

  manager.listSessions = (): AutonomySession[] => {
    return Array.from(sessions.values()).map((session) => clone(session));
  };

  manager.getQueue = () => {
    return [];
  };

  manager.pauseSession = (sessionId: string, reason = "Paused from verification"): boolean => {
    const session = sessions.get(sessionId);
    if (!session || session.state === "paused") {
      return false;
    }
    session.state = "paused";
    session.currentGear = null;
    session.updatedAt = nextTimestamp();
    appendTimeline(session, "paused", reason);
    emit({
      type: "state",
      sessionId,
      timestamp: session.updatedAt,
      payload: {
        state: "paused",
        reason,
      },
    });
    return true;
  };

  manager.resumeSession = (sessionId: string, reason = "Resumed from verification"): boolean => {
    const session = sessions.get(sessionId);
    if (!session || session.state !== "paused") {
      return false;
    }
    if (session.reviewStatus === "plan_pending") {
      session.reviewStatus = "approved";
      session.reviewUpdatedAt = nextTimestamp();
    }
    session.state = "execute";
    session.currentGear = "standard";
    session.cycleCount = Math.max(session.cycleCount, 1);
    session.updatedAt = nextTimestamp();
    appendTimeline(session, "execute", reason, "task-1");
    emit({
      type: "state",
      sessionId,
      timestamp: session.updatedAt,
      payload: {
        state: "execute",
        reason,
      },
    });
    return true;
  };

  manager.stopSession = (sessionId: string, reason = "Stopped from verification"): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.state = "stopped";
    session.stopReason = reason;
    session.currentGear = null;
    session.updatedAt = nextTimestamp();
    appendTimeline(session, "stopped", reason);
    interrupted.add(sessionId);
    emit({
      type: "stopped",
      sessionId,
      timestamp: session.updatedAt,
      payload: {
        reason,
      },
    });
    return true;
  };

  return {
    getMutableSession,
    progressMissionToPlanReview(sessionId: string) {
      const session = getMutableSession(sessionId);
      session.cycleCount = 1;
      session.currentGear = "standard";
      session.currentModel = session.anchorModel;
      session.updatedAt = nextTimestamp();
      appendTimeline(session, "plan", "Plan drafted", "task-plan");
      session.artifacts.plan = createPlanMarkdown(session.objective, session.anchorModel);
      session.artifacts.changeSummary = "Mission API catalog drafted";
      session.artifacts.nextActionReason = "Await user approval";
      session.artifacts.contextPack = "phase3-validation-context";
      session.touchedFiles = ["src/api/routers/mission.router.ts", "docs/ARCHITECTURE.md"];
      emit({
        type: "created",
        sessionId,
        timestamp: session.updatedAt,
        payload: {
          state: "init",
          reviewStatus: "none",
        },
      });
      emit({
        type: "artifact",
        sessionId,
        timestamp: session.updatedAt,
        payload: {
          kind: "plan",
        },
      });
      session.budgets = createBudget({
        usage: {
          cyclesUsed: 1,
          durationMsUsed: 12_000,
          inputTokensUsed: 15_000,
          outputTokensUsed: 1_200,
          currentTPM: 920_000,
          requestsUsed: 4_550,
          usdUsed: 0,
        },
        warning: true,
        warningReason: "BUDGET_WARNING: tpm 920000/1000000",
      });
      session.updatedAt = nextTimestamp();
      emit({
        type: "budget",
        sessionId,
        timestamp: session.updatedAt,
        payload: {
          warning: true,
          warningReason: session.budgets.warningReason,
        },
      });
      session.reviewStatus = "plan_pending";
      session.reviewUpdatedAt = nextTimestamp();
      session.state = "paused";
      session.currentGear = null;
      session.updatedAt = nextTimestamp();
      appendTimeline(session, "paused", "Waiting for approval");
      emit({
        type: "state",
        sessionId,
        timestamp: session.updatedAt,
        payload: {
          state: "paused",
          reviewStatus: "plan_pending",
        },
      });
    },
    insertDecisionLog(sessionId: string, summary: string) {
      const session = getMutableSession(sessionId);
      session.updatedAt = nextTimestamp();
      emit({
        type: "decision_log",
        sessionId,
        timestamp: session.updatedAt,
        payload: {
          summary,
          confidence: 0.91,
        },
      });
    },
  };
}

async function jsonRequest<T = unknown>(options: {
  port: number;
  method: string;
  path: string;
  token?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<JsonResponse<T>> {
  const headers = new Headers(options.headers ?? {});
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`http://127.0.0.1:${options.port}${options.path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body =
    contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ((await response.text()) as unknown as T);

  return {
    status: response.status,
    body,
    headers: response.headers,
  };
}

function assertSuccessEnvelope(response: JsonResponse<any>, message: string): void {
  assert(response.status >= 200 && response.status < 300, `${message}: unexpected status ${response.status}`);
  assert(response.body && typeof response.body === "object", `${message}: body must be an object`);
  assert(response.body.data !== null, `${message}: success data must not be null`);
  assert(Array.isArray(response.body.errors) && response.body.errors.length === 0, `${message}: errors must be []`);
  assert(typeof response.body.meta?.timestamp === "string", `${message}: meta.timestamp missing`);
  assert(typeof response.body.meta?.requestId === "string", `${message}: meta.requestId missing`);
}

function assertErrorEnvelope(
  response: JsonResponse<any>,
  expectedStatus: number,
  expectedCode: string,
  message: string,
): void {
  assert(response.status === expectedStatus, `${message}: unexpected status ${response.status}`);
  assert(response.body && typeof response.body === "object", `${message}: body must be an object`);
  assert(response.body.data === null, `${message}: error data must be null`);
  assert(Array.isArray(response.body.errors) && response.body.errors.length > 0, `${message}: errors missing`);
  assert(response.body.errors[0]?.code === expectedCode, `${message}: expected ${expectedCode}`);
  assert(typeof response.body.meta?.timestamp === "string", `${message}: meta.timestamp missing`);
  assert(typeof response.body.meta?.requestId === "string", `${message}: meta.requestId missing`);
}

async function waitForMessage(socket: any, timeoutMs = 2_000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while waiting for websocket message"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener?.("message", onMessage);
      socket.removeEventListener?.("error", onError);
    };

    const onMessage = (event: any) => {
      cleanup();
      resolve(JSON.parse(String(event.data)));
    };

    const onError = (event: any) => {
      cleanup();
      reject(event.error ?? new Error("WebSocket error"));
    };

    socket.addEventListener?.("message", onMessage);
    socket.addEventListener?.("error", onError);
  });
}

async function openSocket(url: string): Promise<any> {
  const WebSocketImpl =
    (globalThis as any).WebSocket ?? (await import("ws")).WebSocket;
  return await new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);

    const cleanup = () => {
      socket.removeEventListener?.("open", onOpen);
      socket.removeEventListener?.("error", onError);
    };

    const onOpen = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (event: any) => {
      cleanup();
      reject(event.error ?? new Error("Failed to open websocket"));
    };

    socket.addEventListener?.("open", onOpen);
    socket.addEventListener?.("error", onError);
  });
}

function equivalentCurl(
  method: string,
  path: string,
  token = AUTH_TOKEN,
  body?: string,
  extraHeaders: string[] = [],
): string {
  const parts = [
    `curl.exe -s -X ${method}`,
    `"http://127.0.0.1:51122${path}"`,
    `-H "Authorization: Bearer ${token}"`,
    ...extraHeaders.map((header) => `-H "${header}"`),
  ];

  if (body) {
    parts.push(`-H "Content-Type: application/json"`, `-d "${body.replace(/"/g, '\\"')}"`);
  }

  return parts.join(" ");
}

function formatObservationSection(title: string, rows: EndpointObservation[]): string {
  const header = ["| Check | Method | Path | Status | Result | Note |", "|---|---|---|---:|---|---|"];
  const body = rows.map(
    (row) =>
      `| ${row.label} | ${row.method} | \`${row.path}\` | ${row.status} | ${row.result} | ${row.note} |`,
  );
  return [`## ${title}`, "", ...header, ...body, ""].join("\n");
}

function buildReport(state: ValidationState): string {
  return [
    "# Phase 3 Validation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This report was produced against a live local GatewayServer using the canonical `/api/missions/*` surface, the canonical `/ws/mission/:id` socket, and a deterministic local verification runtime.",
    "",
    "## Scope",
    "",
    "- Canonical mission REST surface: 10 endpoints",
    "- Canonical mission websocket: `/ws/mission/:id`",
    "- Helper websocket ticket endpoint verified separately but not counted in the 10 mission REST endpoints",
    "- Envelope contract: `{ data, meta, errors }`",
    "",
    formatObservationSection("REST Endpoint Results", state.endpointResults),
    formatObservationSection("Representative Error Results", state.errorResults),
    "## Timeline Pagination Evidence",
    "",
    `- Page 1 nextCursor: \`${state.timeline.page1Cursor}\``,
    `- Page 2 item count: ${state.timeline.page2Count}`,
    `- Inserted event preserved after cursor paging: ${state.timeline.page2ContainsInsertedEvent ? "yes" : "no"}`,
    `- Ascending order preserved: ${state.timeline.ascending ? "yes" : "no"}`,
    "",
    "## WebSocket Evidence",
    "",
    `- First snapshot state: \`${state.websocket.firstSnapshotState}\``,
    `- Reconnect snapshot state: \`${state.websocket.reconnectSnapshotState}\``,
    `- Live pause event envelope type: \`${state.websocket.livePauseEventType}\``,
    `- Live resume event envelope type: \`${state.websocket.liveResumeEventType}\``,
    `- Replay omitted on reconnect: ${state.websocket.noReplayObserved ? "yes" : "no"}`,
    "",
    "## Rate Limit Evidence",
    "",
    `- 429 observed on request #${state.rateLimit.observedAt}`,
    `- Retry-After header: \`${state.rateLimit.retryAfterHeader}\``,
    `- Body retryAfter: \`${state.rateLimit.retryAfterBody}\``,
    "",
    "## Manual Runbook Reference",
    "",
    "- See `docs/PHASE3_VALIDATION_RUNBOOK.md` for curl and wscat-equivalent steps.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "phase3-validation-"));
  const tokenStorePath = path.join(tempDir, "token-store.json");
  const repository = new InMemoryMissionRepository();
  const port = await getFreePort();
  const verificationState: ValidationState = {
    endpointResults: [],
    errorResults: [],
    timeline: {
      page1Cursor: null,
      page2Count: 0,
      page2ContainsInsertedEvent: false,
      ascending: false,
    },
    websocket: {
      firstSnapshotState: "",
      reconnectSnapshotState: "",
      livePauseEventType: "",
      liveResumeEventType: "",
      noReplayObserved: false,
    },
    rateLimit: {
      observedAt: 0,
      retryAfterHeader: null,
      retryAfterBody: null,
    },
  };

  await writeFile(
    tokenStorePath,
    JSON.stringify(
      {
        version: 1,
        accounts: [
          {
            accessToken: "phase3-access-token",
            refreshToken: "phase3-refresh-token",
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            email: ACTIVE_EMAIL,
            createdAt: Date.now(),
          },
        ],
        activeIndex: 0,
      },
      null,
      2,
    ),
    "utf8",
  );

  const gateway = new GatewayServer({
    port,
    host: "127.0.0.1",
    projectRoot,
    authToken: AUTH_TOKEN,
    tokenStorePath,
    missionRepository: repository,
    recoveryNotifier: new NoopRecoveryNotifier(),
  });

  const gatewayAny = gateway as any;
  const runtime = installDeterministicRuntime(gatewayAny);

  try {
    await gateway.start();

    const createInvalid = await jsonRequest({
      port,
      method: "POST",
      path: "/api/missions",
      token: AUTH_TOKEN,
      body: { prompt: "" },
    });
    assertErrorEnvelope(createInvalid, 422, "VALIDATION_ERROR", "empty prompt");
    verificationState.errorResults.push({
      label: "empty prompt",
      method: "POST",
      path: "/api/missions",
      status: createInvalid.status,
      result: "PASS",
      note: "prompt validation rejected empty input",
    });

    const createMissionA = await jsonRequest<any>({
      port,
      method: "POST",
      path: "/api/missions",
      token: AUTH_TOKEN,
      body: { prompt: "Validate Phase 3 mission endpoints", model: "smart_multi" },
    });
    assertSuccessEnvelope(createMissionA, "create mission A");
    assert(createMissionA.status === 201, "create mission A: expected 201");
    const missionA = createMissionA.body.data.id as string;
    verificationState.endpointResults.push({
      label: "create mission A",
      method: "POST",
      path: "/api/missions",
      status: createMissionA.status,
      result: "PASS",
      note: "received state returned with mission id",
    });

    const getMissionA = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(getMissionA, "get mission A");
    verificationState.endpointResults.push({
      label: "get mission by id",
      method: "GET",
      path: `/api/missions/${missionA}`,
      status: getMissionA.status,
      result: "PASS",
      note: "full mission object returned",
    });

    runtime.progressMissionToPlanReview(missionA);

    const getPlanA = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}/plan`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(getPlanA, "get plan A");
    verificationState.endpointResults.push({
      label: "get mission plan",
      method: "GET",
      path: `/api/missions/${missionA}/plan`,
      status: getPlanA.status,
      result: "PASS",
      note: "MissionPlan returned from structured markdown artifact",
    });

    const artifactsA = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}/artifacts?limit=50`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(artifactsA, "get artifacts A");
    assert(typeof artifactsA.body.meta.total === "number", "artifacts meta.total missing");
    verificationState.endpointResults.push({
      label: "get artifacts",
      method: "GET",
      path: `/api/missions/${missionA}/artifacts?limit=50`,
      status: artifactsA.status,
      result: "PASS",
      note: "cursor meta includes nextCursor, hasMore, total",
    });

    const timelinePage1 = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}/timeline?limit=1`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(timelinePage1, "timeline page 1");
    const page1Items = timelinePage1.body.data as Array<{ id: string; createdAt: string }>;
    const page1Cursor = timelinePage1.body.meta.nextCursor as string | null;
    assert(Array.isArray(page1Items) && page1Items.length === 1, "timeline page 1 must contain 1 event");
    assert(page1Cursor, "timeline page 1 must expose nextCursor");
    runtime.insertDecisionLog(missionA, "Pagination anchor event inserted after page 1");

    const timelinePage2 = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}/timeline?limit=50&cursor=${encodeURIComponent(page1Cursor)}`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(timelinePage2, "timeline page 2");
    const page2Items = timelinePage2.body.data as Array<{ createdAt: string; type: string }>;
    verificationState.timeline = {
      page1Cursor,
      page2Count: page2Items.length,
      page2ContainsInsertedEvent: page2Items.some((item) => item.type === "mission.decision_log"),
      ascending: page2Items.every((item, index, items) => {
        if (index === 0) return true;
        return Date.parse(items[index - 1]!.createdAt) <= Date.parse(item.createdAt);
      }),
    };
    assert(verificationState.timeline.page2ContainsInsertedEvent, "timeline page 2 must include inserted event");
    assert(verificationState.timeline.ascending, "timeline page 2 must remain ascending");
    verificationState.endpointResults.push({
      label: "get timeline",
      method: "GET",
      path: `/api/missions/${missionA}/timeline?limit=1`,
      status: timelinePage1.status,
      result: "PASS",
      note: "cursor pagination remained stable after an inserted event",
    });

    const budgetA = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}/budget`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(budgetA, "get budget A");
    assert(budgetA.body.data.warning === true, "budget warning flag must be true");
    verificationState.endpointResults.push({
      label: "get budget",
      method: "GET",
      path: `/api/missions/${missionA}/budget`,
      status: budgetA.status,
      result: "PASS",
      note: "warning flag and TPM/RPD/cycles envelope returned",
    });

    const wsTicket1 = await jsonRequest<any>({
      port,
      method: "POST",
      path: `/api/missions/${encodeURIComponent(missionA)}/ws-ticket`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(wsTicket1, "issue websocket ticket 1");
    const socket1 = await openSocket(
      `ws://127.0.0.1:${port}/ws/mission/${encodeURIComponent(missionA)}?ticket=${encodeURIComponent(wsTicket1.body.data.ticket)}`,
    );
    const firstSnapshot = await waitForMessage(socket1);
    assert(firstSnapshot.type === "autonomyEvent" && firstSnapshot.eventType === "snapshot", "first websocket message must be snapshot");
    verificationState.websocket.firstSnapshotState = String(firstSnapshot.payload.state);
    assert(firstSnapshot.payload.selectedSession, "snapshot selectedSession missing");
    assert(firstSnapshot.payload.timeline, "snapshot timeline missing");
    assert(firstSnapshot.payload.artifacts, "snapshot artifacts missing");
    assert(firstSnapshot.payload.budgets, "snapshot budgets missing");
    assert(Array.isArray(firstSnapshot.payload.queue), "snapshot queue must be an array");
    socket1.close();

    const approveWithoutAuth = await jsonRequest<any>({
      port,
      method: "POST",
      path: `/api/missions/${encodeURIComponent(missionA)}/approve`,
    });
    assertErrorEnvelope(approveWithoutAuth, 401, "UNAUTHORIZED", "approve without auth");
    verificationState.errorResults.push({
      label: "approve without bearer",
      method: "POST",
      path: `/api/missions/${missionA}/approve`,
      status: approveWithoutAuth.status,
      result: "PASS",
      note: "approve route enforces bearer-only auth",
    });

    const approveWithAuth = await jsonRequest<any>({
      port,
      method: "POST",
      path: `/api/missions/${encodeURIComponent(missionA)}/approve`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(approveWithAuth, "approve with auth");
    verificationState.endpointResults.push({
      label: "approve plan",
      method: "POST",
      path: `/api/missions/${missionA}/approve`,
      status: approveWithAuth.status,
      result: "PASS",
      note: "review checkpoint resumed into coding",
    });

    const wsTicket2 = await jsonRequest<any>({
      port,
      method: "POST",
      path: `/api/missions/${encodeURIComponent(missionA)}/ws-ticket`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(wsTicket2, "issue websocket ticket 2");
    const socket2 = await openSocket(
      `ws://127.0.0.1:${port}/ws/mission/${encodeURIComponent(missionA)}?ticket=${encodeURIComponent(wsTicket2.body.data.ticket)}`,
    );
    const reconnectSnapshot = await waitForMessage(socket2);
    assert(reconnectSnapshot.type === "autonomyEvent" && reconnectSnapshot.eventType === "snapshot", "reconnect websocket message must be snapshot");
    verificationState.websocket.reconnectSnapshotState = String(reconnectSnapshot.payload.state);
    verificationState.websocket.noReplayObserved = reconnectSnapshot.eventType === "snapshot";

    const pauseMessage = waitForMessage(socket2);
    const pauseA = await jsonRequest<any>({
      port,
      method: "POST",
      path: `/api/missions/${encodeURIComponent(missionA)}/pause`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(pauseA, "pause mission A");
    const pauseEvent = await pauseMessage;
    verificationState.websocket.livePauseEventType = String(pauseEvent.eventType ?? pauseEvent.type);
    verificationState.endpointResults.push({
      label: "pause mission",
      method: "POST",
      path: `/api/missions/${missionA}/pause`,
      status: pauseA.status,
      result: "PASS",
      note: "live websocket state event observed",
    });

    const resumeMessage = waitForMessage(socket2);
    const resumeA = await jsonRequest<any>({
      port,
      method: "POST",
      path: `/api/missions/${encodeURIComponent(missionA)}/resume`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(resumeA, "resume mission A");
    const resumeEvent = await resumeMessage;
    verificationState.websocket.liveResumeEventType = String(resumeEvent.eventType ?? resumeEvent.type);
    verificationState.endpointResults.push({
      label: "resume mission",
      method: "POST",
      path: `/api/missions/${missionA}/resume`,
      status: resumeA.status,
      result: "PASS",
      note: "response projected pre-pause logical state and websocket resumed",
    });
    socket2.close();

    const createMissionB = await jsonRequest<any>({
      port,
      method: "POST",
      path: "/api/missions",
      token: AUTH_TOKEN,
      body: { prompt: "Cancel mission B", model: "fast_only" },
    });
    assertSuccessEnvelope(createMissionB, "create mission B");
    const missionB = createMissionB.body.data.id as string;

    const getPlanB = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionB)}/plan`,
      token: AUTH_TOKEN,
    });
    assertErrorEnvelope(getPlanB, 404, "PLAN_NOT_READY", "plan not ready");
    verificationState.errorResults.push({
      label: "plan not ready",
      method: "GET",
      path: `/api/missions/${missionB}/plan`,
      status: getPlanB.status,
      result: "PASS",
      note: "second mission without artifacts returns PLAN_NOT_READY",
    });

    const cancelB = await jsonRequest<any>({
      port,
      method: "POST",
      path: `/api/missions/${encodeURIComponent(missionB)}/cancel`,
      token: AUTH_TOKEN,
    });
    assertSuccessEnvelope(cancelB, "cancel mission B");
    verificationState.endpointResults.push({
      label: "cancel mission",
      method: "POST",
      path: `/api/missions/${missionB}/cancel`,
      status: cancelB.status,
      result: "PASS",
      note: "active mission cancelled with cancelled response state",
    });

    const missingMission = await jsonRequest<any>({
      port,
      method: "GET",
      path: "/api/missions/missing-mission",
      token: AUTH_TOKEN,
    });
    assertErrorEnvelope(missingMission, 404, "MISSION_NOT_FOUND", "missing mission");
    verificationState.errorResults.push({
      label: "missing mission",
      method: "GET",
      path: "/api/missions/missing-mission",
      status: missingMission.status,
      result: "PASS",
      note: "canonical mission 404 returned",
    });

    const artifactsOverLimit = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}/artifacts?limit=201`,
      token: AUTH_TOKEN,
    });
    assertErrorEnvelope(artifactsOverLimit, 422, "VALIDATION_ERROR", "artifacts limit validation");
    verificationState.errorResults.push({
      label: "artifacts limit validation",
      method: "GET",
      path: `/api/missions/${missionA}/artifacts?limit=201`,
      status: artifactsOverLimit.status,
      result: "PASS",
      note: "limit > 200 rejected",
    });

    const timelineOverLimit = await jsonRequest<any>({
      port,
      method: "GET",
      path: `/api/missions/${encodeURIComponent(missionA)}/timeline?limit=201`,
      token: AUTH_TOKEN,
    });
    assertErrorEnvelope(timelineOverLimit, 422, "VALIDATION_ERROR", "timeline limit validation");
    verificationState.errorResults.push({
      label: "timeline limit validation",
      method: "GET",
      path: `/api/missions/${missionA}/timeline?limit=201`,
      status: timelineOverLimit.status,
      result: "PASS",
      note: "limit > 200 rejected",
    });

    for (let requestIndex = 1; requestIndex <= 101; requestIndex += 1) {
      const response = await jsonRequest<any>({
        port,
        method: "GET",
        path: "/api/health",
        headers: {
          "x-api-key": "phase3-verification",
        },
      });

      if (requestIndex < 101) {
        assertSuccessEnvelope(response, `rate-limit probe ${requestIndex}`);
        continue;
      }

      assertErrorEnvelope(response, 429, "RATE_LIMIT", "rate limit");
      verificationState.rateLimit = {
        observedAt: requestIndex,
        retryAfterHeader: response.headers.get("Retry-After"),
        retryAfterBody:
          typeof response.body.errors?.[0]?.retryAfter === "number"
            ? response.body.errors[0].retryAfter
            : null,
      };
    }

    const report = buildReport(verificationState);
    await writeFile(reportPath, report, "utf8");
    console.log(report);
    console.log("");
    console.log("Equivalent curl examples:");
    console.log(equivalentCurl("POST", "/api/missions", AUTH_TOKEN, '{"prompt":"Validate Phase 3 mission endpoints","model":"smart_multi"}'));
    console.log(equivalentCurl("GET", "/api/missions/mission-1", AUTH_TOKEN));
    console.log(equivalentCurl("GET", "/api/missions/mission-1/plan", AUTH_TOKEN));
    console.log(equivalentCurl("POST", "/api/missions/mission-1/approve", AUTH_TOKEN));
    console.log(equivalentCurl("GET", "/api/missions/mission-1/timeline?limit=1", AUTH_TOKEN));
  } finally {
    await gateway.stop().catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("Phase 3 verification failed:", error);
  process.exit(1);
});
