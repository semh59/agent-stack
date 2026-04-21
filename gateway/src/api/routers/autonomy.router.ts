import type { FastifyInstance, FastifyReply } from "fastify";
import { type TokenStore } from "../../gateway/token-store";
import { type AccountManager } from "../../plugin/accounts";
import { type AutonomySessionManager } from "../../gateway/autonomy-session-manager";
import { type StartupRecoveryCoordinator } from "../../persistence/recovery/StartupRecovery";
import { apiResponse, apiError } from "../../gateway/rest-response";
import {
  type CreateAutonomySessionRequest,
  type PauseAutonomySessionRequest,
  type ResumeAutonomySessionRequest,
  type StopAutonomySessionRequest,
  type AutonomySession
} from "../../orchestration/autonomy-types";

const MAX_USER_TASK_LENGTH = 10_000;

export interface AutonomyRouteDependencies {
  tokenStore: TokenStore;
  getAccountManager: () => AccountManager | null;
  autonomyManager: AutonomySessionManager;
  startupRecovery: StartupRecoveryCoordinator;
  issueMissionWsTicket: (sessionId: string, reply: FastifyReply, body?: any) => Promise<any>;
}

function summarizeAutonomySession(session: AutonomySession) {
  return {
    id: session.id,
    state: session.state,
    objective: session.objective,
    account: session.account,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    queuePosition: session.queuePosition,
    branchName: session.branchName,
    baseBranch: session.baseBranch,
    commitHash: session.commitHash,
    currentModel: session.currentModel,
    currentGear: session.currentGear,
    reviewStatus: session.reviewStatus,
    reviewUpdatedAt: session.reviewUpdatedAt,
  };
}

function validateAutonomyCreateRequest(payload: CreateAutonomySessionRequest | undefined): string | null {
  if (!payload || typeof payload !== "object") {
    return "Request body is required";
  }
  if (!payload.account || typeof payload.account !== "string") {
    return "account is required";
  }
  if (!payload.anchorModel || typeof payload.anchorModel !== "string") {
    return "anchorModel is required";
  }
  if (!payload.objective || typeof payload.objective !== "string" || payload.objective.trim().length === 0) {
    return "objective is required";
  }
  if (payload.objective.length > MAX_USER_TASK_LENGTH) {
    return `objective exceeds maximum length of ${MAX_USER_TASK_LENGTH}`;
  }
  if (!payload.scope || payload.scope.mode !== "selected_only") {
    return "scope.mode must be selected_only";
  }
  if (!Array.isArray(payload.scope.paths) || payload.scope.paths.length === 0) {
    return "scope.paths must include at least one path";
  }
  if (payload.scope.paths.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    return "scope.paths entries must be non-empty strings";
  }
  if (payload.modelPolicy !== "smart_multi") {
    return "modelPolicy must be smart_multi";
  }
  if (
    payload.startMode !== undefined &&
    payload.startMode !== "queued" &&
    payload.startMode !== "immediate"
  ) {
    return "startMode must be queued or immediate";
  }
  if (payload.reviewAfterPlan !== undefined && typeof payload.reviewAfterPlan !== "boolean") {
    return "reviewAfterPlan must be a boolean";
  }
  if (payload.gitMode !== "auto_branch_commit" && payload.gitMode !== "patch_only") {
    return "gitMode must be auto_branch_commit or patch_only";
  }
  if (payload.maxDurationMs !== undefined) {
    if (typeof payload.maxDurationMs !== "number" || payload.maxDurationMs <= 0) {
      return "maxDurationMs must be a positive number";
    }
  }
  if (!payload.budgets || typeof payload.budgets !== "object") {
    return "budgets is required and must be an object";
  }
  const numericKeys: Array<keyof NonNullable<CreateAutonomySessionRequest["budgets"]>> = [
    "maxCycles",
    "maxDurationMs",
    "maxInputTokens",
    "maxOutputTokens",
    "maxTPM",
    "maxRPD",
  ];
  for (const key of numericKeys) {
    const value = payload.budgets[key];
    if (value !== undefined && (typeof value !== "number" || value <= 0)) {
      return `budgets.${key} must be a positive number`;
    }
  }
  if (
    payload.budgets.maxUsd !== undefined &&
    (typeof payload.budgets.maxUsd !== "number" || payload.budgets.maxUsd < 0)
  ) {
    return "budgets.maxUsd must be a non-negative number";
  }
  return null;
}

export function registerAutonomyRoutes(
  app: FastifyInstance,
  dependencies: AutonomyRouteDependencies,
): void {
  const { tokenStore, getAccountManager, autonomyManager, startupRecovery, issueMissionWsTicket } = dependencies;

  app.post<{ Body: CreateAutonomySessionRequest }>(
    "/api/autonomy/sessions",
    async (request, reply) => {
      const body = request.body;
      const validationError = validateAutonomyCreateRequest(body);
      if (validationError) {
        return reply.status(400).send(apiError(validationError));
      }

      const normalizedRequest: CreateAutonomySessionRequest = {
        account: body.account.trim(),
        anchorModel: body.anchorModel.trim(),
        objective: body.objective.trim(),
        scope: {
          mode: "selected_only",
          paths: body.scope.paths
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        },
        modelPolicy: "smart_multi",
        gitMode: body.gitMode,
        startMode: body.startMode ?? "queued",
        reviewAfterPlan: body.reviewAfterPlan ?? false,
        strictMode: body.strictMode ?? true,
        maxCycles: body.maxCycles,
        maxDurationMs: body.maxDurationMs,
        budgets: body.budgets,
      };

      if (normalizedRequest.account.includes("@")) {
        tokenStore.setActiveAccountByEmail(normalizedRequest.account);
        const accountManager = getAccountManager();
        accountManager?.switchToAccountByEmail(normalizedRequest.account);
      }

      const session = autonomyManager.startSession(normalizedRequest);
      return apiResponse(summarizeAutonomySession(session));
    },
  );

  app.get("/api/autonomy/sessions", async () => {
    const sessions = (await autonomyManager.listSessions()).map((session) => summarizeAutonomySession(session));
    return apiResponse(sessions);
  });

  app.get("/api/autonomy/queue", async () => {
    return apiResponse(autonomyManager.getQueue());
  });

  app.get<{ Params: { id: string } }>("/api/autonomy/sessions/:id", async (request, reply) => {
    const session = autonomyManager.getSession(request.params.id);
    if (!session) {
      return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
    }
    return apiResponse(session);
  });

  app.post<{ Params: { id: string }; Body: StopAutonomySessionRequest }>(
    "/api/autonomy/sessions/:id/stop",
    async (request, reply) => {
      const reason =
        request.body && typeof request.body.reason === "string"
          ? request.body.reason
          : "Stopped by API request";
      const stopped = autonomyManager.stopSession(request.params.id, reason);
      if (!stopped) {
        return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse({ stopped: true });
    },
  );

  app.post<{ Params: { id: string }; Body: StopAutonomySessionRequest }>(
    "/api/autonomy/sessions/:id/cancel",
    async (request, reply) => {
      const reason =
        request.body && typeof request.body.reason === "string"
          ? request.body.reason
          : "Cancelled by API request";
      const cancelled = autonomyManager.stopSession(request.params.id, reason);
      if (!cancelled) {
        return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse({ cancelled: true });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/autonomy/sessions/:id/promote",
    async (request, reply) => {
      const promoted = autonomyManager.promoteSession(request.params.id);
      if (!promoted) {
        return reply.status(404).send(apiError("Autonomy queued session not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse({ promoted: true });
    },
  );

  app.post<{ Params: { id: string }; Body: PauseAutonomySessionRequest }>(
    "/api/autonomy/sessions/:id/pause",
    async (request, reply) => {
      const reason =
        request.body && typeof request.body.reason === "string"
          ? request.body.reason
          : "Paused by API request";
      const paused = autonomyManager.pauseSession(request.params.id, reason);
      if (!paused) {
        return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse({ paused: true });
    },
  );

  app.post<{ Params: { id: string }; Body: ResumeAutonomySessionRequest }>(
    "/api/autonomy/sessions/:id/resume",
    async (request, reply) => {
      const reason =
        request.body && typeof request.body.reason === "string"
          ? request.body.reason
          : "Resumed by API request";
      const resumed = autonomyManager.resumeSession(request.params.id, reason);
      if (!resumed) {
        return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse({ resumed: true });
    },
  );

  app.post<{ Params: { id: string }; Body: any }>(
    "/api/autonomy/sessions/:id/ws-ticket",
    async (request, reply) => {
      return issueMissionWsTicket(request.params.id, reply, request.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/autonomy/sessions/:id/artifacts",
    async (request, reply) => {
      const artifacts = autonomyManager.getArtifacts(request.params.id);
      if (!artifacts) {
        return reply.status(404).send(apiError("Autonomy session not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse(artifacts);
    },
  );

  app.get("/api/autonomy/recovery/pending", async () => {
    return apiResponse(startupRecovery.listPendingRecoveries());
  });

  app.post<{ Params: { id: string } }>(
    "/api/autonomy/recovery/:id/resume",
    async (request, reply) => {
      const resumed = await startupRecovery.resumeRecovery(request.params.id);
      if (!resumed) {
        return reply.status(404).send(apiError("Pending recovery not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse({ resumed: true });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/autonomy/recovery/:id/cancel",
    async (request, reply) => {
      const cancelled = await startupRecovery.cancelRecovery(request.params.id);
      if (!cancelled) {
        return reply.status(404).send(apiError("Pending recovery not found", { code: "MISSION_NOT_FOUND" }));
      }
      return apiResponse({ cancelled: true });
    },
  );
}
