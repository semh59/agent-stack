import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayServer } from "./server";
import { InMemoryMissionRepository } from "../repositories/mission.repository";
import { NoopRecoveryNotifier } from "../persistence/recovery/RecoveryNotifier";
import type { MissionModel } from "../models/mission.model";
import type { AutonomyEvent, AutonomySession } from "../orchestration/autonomy-types";

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function createMission(overrides: Partial<MissionModel> = {}): MissionModel {
  return {
    id: "mission-1",
    prompt: "Mission websocket recovery",
    account: "dev@example.com",
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:05:00.000Z",
    state: "received",
    currentPhase: null,
    currentGear: null,
    currentModel: "gemini-3-pro-high",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    scopePaths: ["src"],
    strictMode: true,
    anchorModel: "gemini-3-pro-high",
    gateResults: [],
    plan: null,
    timeline: [],
    artifacts: [],
    budget: {
      limits: {
        maxCycles: 12,
        maxDurationMs: 60_000,
        maxInputTokens: 50_000,
        maxOutputTokens: 10_000,
        maxTPM: 2_000,
        maxRPD: 20,
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
    },
    touchedFiles: [],
    completedAt: null,
    error: null,
    lastProgressAt: new Date().toISOString(),
    stopReason: null,
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<AutonomySession> = {}): AutonomySession {
  return {
    id: "mission-1",
    objective: "Mission websocket recovery",
    account: "dev@example.com",
    anchorModel: "gemini-3-pro-high",
    modelPolicy: "smart_multi",
    gitMode: "patch_only",
    startMode: "immediate",
    scope: { mode: "selected_only", paths: ["src"] },
    strictMode: true,
    state: "execute",
    reviewAfterPlan: false,
    currentModel: "gemini-3-pro-high",
    currentGear: "elite",
    reviewStatus: "none",
    reviewUpdatedAt: null,
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:05:00.000Z",
    cycleCount: 1,
    maxCycles: 12,
    maxDurationMs: 60_000,
    queuePosition: null,
    budgets: createMission().budget,
    consecutiveGateFailures: 0,
    branchName: null,
    baseBranch: null,
    commitHash: null,
    touchedFiles: ["src/example.ts"],
    baselineDirtyFiles: [],
    modelHistory: [],
    timeline: [
      {
        cycle: 1,
        state: "execute",
        taskId: "task-1",
        note: "Executing implementation",
        timestamp: "2026-03-12T10:05:00.000Z",
      },
    ],
    opLog: [],
    taskGraph: [],
    artifacts: {
      plan: "# Plan Review\n\n## Objective\nMission websocket recovery",
      changeSummary: "Applied change",
      nextActionReason: "Continue verification",
      gateResult: null,
      rawResponses: [],
      contextPack: "ctx",
    },
    error: null,
    lastProgressAt: new Date().toISOString(),
    stopReason: null,
    ...overrides,
  };
}

async function issueTicket(
  port: number,
  authToken: string,
  sessionId: string,
  kind: "mission" | "autonomy" = "mission",
  body?: Record<string, unknown>,
): Promise<string> {
  const route =
    kind === "mission"
      ? `/api/missions/${encodeURIComponent(sessionId)}/ws-ticket`
      : `/api/autonomy/sessions/${encodeURIComponent(sessionId)}/ws-ticket`;
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { data?: { ticket?: string } };
  expect(typeof payload.data?.ticket).toBe("string");
  return payload.data!.ticket!;
}

async function openSocket(url: string): Promise<any> {
  return await new Promise((resolve, reject) => {
    const socket = new (globalThis as any).WebSocket(url);

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
      reject(event.error ?? new Error("WebSocket failed to open"));
    };

    socket.addEventListener?.("open", onOpen);
    socket.addEventListener?.("error", onError);
  });
}

async function waitForMessage(socket: any, timeoutMs = 2_000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener?.("message", onMessage);
      socket.removeEventListener?.("error", onError);
      socket.removeEventListener?.("close", onClose);
    };

    const onMessage = (event: any) => {
      cleanup();
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      resolve(JSON.parse(raw));
    };
    const onError = (event: any) => {
      cleanup();
      reject(event.error ?? new Error("WebSocket message wait failed"));
    };
    const onClose = (event: any) => {
      cleanup();
      reject(new Error(`Socket closed before message (${event.code ?? "unknown"})`));
    };

    socket.addEventListener?.("message", onMessage);
    socket.addEventListener?.("error", onError);
    socket.addEventListener?.("close", onClose);
  });
}

async function waitForClose(socket: any, timeoutMs = 2_000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket close"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener?.("close", onClose);
      socket.removeEventListener?.("error", onError);
    };

    const onClose = (event: any) => {
      cleanup();
      resolve(event);
    };
    const onError = (event: any) => {
      cleanup();
      reject(event.error ?? new Error("WebSocket close wait failed"));
    };

    socket.addEventListener?.("close", onClose);
    socket.addEventListener?.("error", onError);
  });
}

async function waitForNoMessage(socket: any, timeoutMs = 250): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener?.("message", onMessage);
      socket.removeEventListener?.("error", onError);
    };

    const onMessage = () => {
      cleanup();
      reject(new Error("Unexpected websocket message"));
    };
    const onError = (event: any) => {
      cleanup();
      reject(event.error ?? new Error("Unexpected websocket error"));
    };

    socket.addEventListener?.("message", onMessage);
    socket.addEventListener?.("error", onError);
  });
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2_000,
  intervalMs = 25,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("GatewayServer mission websocket routes", () => {
  const authToken = "test-gateway-token";
  let gateway: GatewayServer | null = null;
  let repository: InMemoryMissionRepository;
  let tmpDir = "";
  let port = 0;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lojinext-gateway-ws-"));
    port = await getFreePort();
    repository = new InMemoryMissionRepository();
    gateway = new GatewayServer({
      port,
      projectRoot: tmpDir,
      authToken,
      host: "127.0.0.1",
      missionRepository: repository,
      recoveryNotifier: new NoopRecoveryNotifier(),
    });
    await gateway.start();
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
      gateway = null;
    }
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("serves a persisted received-state snapshot with cycleCount 0 and empty queue", async () => {
    await repository.create(createMission());
    const ticket = await issueTicket(port, authToken, "mission-1");
    const socket = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${ticket}`);

    const message = await waitForMessage(socket);
    expect(message.type).toBe("autonomyEvent");
    expect(message.eventType).toBe("snapshot");
    expect(message.payload.state).toBe("received");
    expect(message.payload.cycleCount).toBe(0);
    expect(message.payload.timeline).toEqual([]);
    expect(message.payload.queue).toEqual([]);

    socket.close();
    await waitForClose(socket);
  });

  it("supports the legacy /ws/autonomy alias with the same snapshot behavior", async () => {
    await repository.create(createMission());
    const ticket = await issueTicket(port, authToken, "mission-1", "autonomy");
    const socket = await openSocket(`ws://127.0.0.1:${port}/ws/autonomy/mission-1?ticket=${ticket}`);

    const message = await waitForMessage(socket);
    expect(message.type).toBe("autonomyEvent");
    expect(message.eventType).toBe("snapshot");
    expect(message.payload.selectedSession.id).toBe("mission-1");

    socket.close();
    await waitForClose(socket);
  });

  it("allows multiple live clients on the same mission and cleans up subscribers", async () => {
    const manager = (gateway as any).autonomyManager;
    manager.hydrateSession(createSnapshot());

    const [ticketA, ticketB] = await Promise.all([
      issueTicket(port, authToken, "mission-1"),
      issueTicket(port, authToken, "mission-1"),
    ]);
    const socketA = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${ticketA}`);
    const snapshotA = await waitForMessage(socketA);
    const socketB = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${ticketB}`);
    const snapshotB = await waitForMessage(socketB);
    expect(snapshotA.eventType).toBe("snapshot");
    expect(snapshotB.eventType).toBe("snapshot");
    expect((gateway as any).autonomySubscribers.get("mission-1").size).toBe(2);

    socketA.close();
    socketB.close();
    await Promise.all([waitForClose(socketA), waitForClose(socketB)]);
    await waitForCondition(() => (gateway as any).autonomySubscribers.has("mission-1") === false);
  });

  it("supersedes older sockets for the same clientId and rejects stale generations", async () => {
    const manager = (gateway as any).autonomyManager;
    manager.hydrateSession(createSnapshot());

    const ticketA = await issueTicket(port, authToken, "mission-1", "mission", {
      clientId: "client-a",
      generation: { epochMs: 1_000, seq: 0 },
    });
    const socketA = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${ticketA}`);
    await waitForMessage(socketA);

    const ticketB = await issueTicket(port, authToken, "mission-1", "mission", {
      clientId: "client-a",
      generation: { epochMs: 2_000, seq: 0 },
    });
    const socketB = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${ticketB}`);
    await waitForMessage(socketB);

    const supersededClose = await waitForClose(socketA);
    expect(supersededClose.code).toBe(4409);

    const staleTicket = await issueTicket(port, authToken, "mission-1", "mission", {
      clientId: "client-a",
      generation: { epochMs: 1_500, seq: 0 },
    });
    const staleSocket = await openSocket(
      `ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${staleTicket}`,
    );
    const stalePayload = await waitForMessage(staleSocket);
    expect(stalePayload.type).toBe("error");
    const staleClose = await waitForClose(staleSocket);
    expect(staleClose.code).toBe(4409);

    socketB.close();
    await waitForClose(socketB);
  });

  it("rejects the ninth distinct mission client", async () => {
    const manager = (gateway as any).autonomyManager;
    manager.hydrateSession(createSnapshot());

    const sockets: any[] = [];
    for (let index = 0; index < 8; index += 1) {
      const ticket = await issueTicket(port, authToken, "mission-1", "mission", {
        clientId: `client-${index}`,
        generation: { epochMs: 10_000 + index, seq: 0 },
      });
      const socket = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${ticket}`);
      await waitForMessage(socket);
      sockets.push(socket);
    }

    const deniedResponse = await fetch(`http://127.0.0.1:${port}/api/missions/mission-1/ws-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: "client-8",
        generation: { epochMs: 20_000, seq: 0 },
      }),
    });
    expect(deniedResponse.status).toBe(429);

    await Promise.all(
      sockets.map(async (socket) => {
        socket.close();
        await waitForClose(socket);
      }),
    );
  });

  it("maps gate_bypass and interrupted events without replaying missed events on reconnect", async () => {
    const manager = (gateway as any).autonomyManager;
    manager.hydrateSession(createSnapshot());

    const firstTicket = await issueTicket(port, authToken, "mission-1");
    const firstSocket = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${firstTicket}`);
    await waitForMessage(firstSocket);
    firstSocket.close();
    await waitForClose(firstSocket);

    const liveSession = manager.engine.sessions.get("mission-1");
    liveSession.state = "verify";
    liveSession.currentModel = "claude-opus-4-5-thinking";
    liveSession.currentGear = "elite";
    liveSession.updatedAt = "2026-03-12T10:07:00.000Z";
    liveSession.timeline.push({
      cycle: 2,
      state: "verify",
      taskId: "task-2",
      note: "Verification resumed while disconnected",
      timestamp: "2026-03-12T10:07:00.000Z",
    });

    manager.emit({
      type: "gate_bypass",
      sessionId: "mission-1",
      timestamp: "2026-03-12T10:07:05.000Z",
      payload: {
        taskId: "task-2",
        reasonCode: "NO_FILES_CHANGED",
        passed: true,
        blockingIssues: [],
        impactedScopes: [],
        audit: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
      },
    } satisfies AutonomyEvent);

    const secondTicket = await issueTicket(port, authToken, "mission-1");
    const secondSocket = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${secondTicket}`);
    const snapshot = await waitForMessage(secondSocket);
    expect(snapshot.eventType).toBe("snapshot");
    expect(snapshot.payload.state).toBe("verify");
    expect(snapshot.payload.selectedSession.currentModel).toBe("claude-opus-4-5-thinking");
    expect(snapshot.payload.timeline).toHaveLength(2);
    await waitForNoMessage(secondSocket);

    (manager as any).interruptedSessions.add("mission-1");
    manager.emit({
      type: "stopped",
      sessionId: "mission-1",
      timestamp: "2026-03-12T10:07:10.000Z",
      payload: {
        reason: "Stopped by user",
      },
    } satisfies AutonomyEvent);
    const interruptedEvent = await waitForMessage(secondSocket);
    expect(interruptedEvent.type).toBe("autonomyEvent");
    expect(interruptedEvent.eventType).toBe("interrupted");

    secondSocket.close();
    await waitForClose(secondSocket);
  });

  it("uses the live queue snapshot for persisted missions and closes missing missions with 4404", async () => {
    await repository.create(createMission());
    const manager = (gateway as any).autonomyManager;
    manager.hydrateSession(
      createSnapshot({
        id: "queued-1",
        objective: "Queued mission",
        state: "queued",
        startMode: "queued",
        queuePosition: 1,
        currentGear: null,
        timeline: [],
        touchedFiles: [],
      }),
    );
    manager.queue.push("queued-1");
    manager.engine.setQueuePosition("queued-1", 1);

    const ticket = await issueTicket(port, authToken, "mission-1");
    const socket = await openSocket(`ws://127.0.0.1:${port}/ws/mission/mission-1?ticket=${ticket}`);
    const snapshot = await waitForMessage(socket);
    expect(snapshot.eventType).toBe("snapshot");
    expect(snapshot.payload.queue).toHaveLength(1);
    expect(snapshot.payload.queue[0].sessionId).toBe("queued-1");
    socket.close();
    await waitForClose(socket);

    const missingTicket = (gateway as any).authManager.issueWsTicket("missing-mission").ticket;
    const missingSocket = await openSocket(
      `ws://127.0.0.1:${port}/ws/mission/missing-mission?ticket=${missingTicket}`,
    );
    const errorPayload = await waitForMessage(missingSocket);
    expect(errorPayload.type).toBe("error");
    expect(errorPayload.payload.message).toBe("Mission not found");
    const closeEvent = await waitForClose(missingSocket);
    expect(closeEvent.code).toBe(4404);
  });
});
