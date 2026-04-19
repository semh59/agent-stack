import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import type { MissionModel, MissionState } from "../../models/mission.model";
import { MissionService, MissionServiceError } from "../../services/mission.service";
import { apiError, apiResponse, sendMappedApiError } from "../../gateway/rest-response";

export type ModelPreference = "smart_multi" | "fast_only" | "pro_only";

interface CreateMissionRequest {
  prompt: string;
  model?: ModelPreference;
}

interface MissionRouteDependencies {
  missionService: MissionService;
  resolveActiveMissionAccount: () => Promise<string | null>;
  approveAuth: preHandlerHookHandler;
  isQuotaStateReady: () => boolean;
}

const MAX_PROMPT_LENGTH = 2_000;
const DEFAULT_SCOPE_PATHS = ["src", "ui", "docs", "vscode-extension"];
const DEFAULT_AUTONOMY_BUDGET = {
  maxCycles: 12,
  maxDurationMs: 45 * 60 * 1000,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 400_000,
  maxTPM: 1_000_000,
  maxRPD: 5_000,
  maxUsd: 0,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isModelPreference(value: unknown): value is ModelPreference {
  return value === "smart_multi" || value === "fast_only" || value === "pro_only";
}

function validationError(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(422).send(
    apiError(message, {
      code: "VALIDATION_ERROR",
    }),
  );
}

function mapModelPreference(preference?: ModelPreference): string {
  switch (preference) {
    case "fast_only":
      return "gemini-3-flash";
    case "pro_only":
      return "claude-opus-4-5-thinking";
    case "smart_multi":
    default:
      return "gemini-3-pro-high";
  }
}

function calculatePercentage(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.round((used / limit) * 1000) / 10;
}

function buildBudgetResponse(missionBudget: MissionModel["budget"]) {
  const tpmLimit = missionBudget.limits.maxTPM;
  const rpdLimit = missionBudget.limits.maxRPD;
  const cycleLimit = missionBudget.limits.maxCycles;
  const cyclesUsed = missionBudget.usage.cyclesUsed;
  const efficiency =
    cyclesUsed > 0 && cycleLimit > 0 ? Math.max(0, Math.min(1, 1 - cyclesUsed / cycleLimit)) : 0;

  return {
    tpm: {
      used: missionBudget.usage.currentTPM,
      reserved: missionBudget.usage.reservedTPM ?? 0,
      limit: tpmLimit,
      percentage: calculatePercentage(
        missionBudget.usage.currentTPM + (missionBudget.usage.reservedTPM ?? 0),
        tpmLimit,
      ),
    },
    rpd: {
      used: missionBudget.usage.requestsUsed,
      reserved: missionBudget.usage.reservedRequests ?? 0,
      limit: rpdLimit,
      percentage: calculatePercentage(
        missionBudget.usage.requestsUsed + (missionBudget.usage.reservedRequests ?? 0),
        rpdLimit,
      ),
    },
    cycles: {
      used: cyclesUsed,
      limit: cycleLimit,
      percentage: calculatePercentage(cyclesUsed, cycleLimit),
    },
    efficiency,
    warning: missionBudget.warning,
    warningReason: missionBudget.warningReason,
    exceeded: missionBudget.exceeded,
    exceedReason: missionBudget.exceedReason,
    cachedInputTokensUsed: missionBudget.usage.cachedInputTokensUsed ?? 0,
  };
}

function mapRuntimeStateToMissionState(state: string): MissionState {
  switch (state) {
    case "queued":
    case "init":
      return "received";
    case "plan":
      return "planning";
    case "execute":
    case "reflect":
    case "retry":
      return "coding";
    case "verify":
      return "verifying";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "cancelled";
    default:
      return "received";
  }
}

function projectResumeState(mission: MissionModel): MissionState {
  const timeline = mission.timeline;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (!entry || entry.state === "paused") {
      continue;
    }
    return mapRuntimeStateToMissionState(entry.state);
  }
  return "received";
}

function parseCursorLimit(
  request: FastifyRequest<{ Querystring: Record<string, unknown> }>,
  reply: FastifyReply,
): { cursor?: string; limit: number } | null {
  const query = (request.query ?? {}) as Record<string, unknown>;
  const cursorRaw = query.cursor;
  const limitRaw = query.limit;

  if (cursorRaw !== undefined) {
    const cursor = String(cursorRaw).trim();
    if (!cursor) {
      validationError(reply, "cursor must be a non-empty string");
      return null;
    }
  }

  let limit = 50;
  if (limitRaw !== undefined) {
    const parsedLimit = Number(limitRaw);
    if (!Number.isFinite(parsedLimit) || !Number.isInteger(parsedLimit) || parsedLimit < 1) {
      validationError(reply, "limit must be a positive integer");
      return null;
    }
    if (parsedLimit > 200) {
      validationError(reply, "limit cannot exceed 200");
      return null;
    }
    limit = parsedLimit;
  }

  return {
    cursor: cursorRaw === undefined ? undefined : String(cursorRaw).trim(),
    limit,
  };
}

function handleMissionRouteError(
  reply: FastifyReply,
  error: unknown,
  fallbackMessage: string,
): FastifyReply {
  if (error instanceof MissionServiceError && error.code === "PLAN_NOT_AVAILABLE") {
    return reply.status(404).send(
      apiError(error.message, {
        code: "PLAN_NOT_READY",
      }),
    );
  }

  return sendMappedApiError(reply, error, fallbackMessage);
}

export function registerMissionRoutes(
  app: FastifyInstance,
  dependencies: MissionRouteDependencies,
): void {
  const { missionService, resolveActiveMissionAccount, approveAuth, isQuotaStateReady } = dependencies;

  const requireQuotaState = (reply: FastifyReply): FastifyReply | null => {
    if (isQuotaStateReady()) {
      return null;
    }
    return reply.status(503).send(
      apiError("Quota state is still loading", {
        code: "QUOTA_STATE_NOT_READY",
      }),
    );
  };

  app.post<{ Body: CreateMissionRequest }>("/api/missions", async (request, reply) => {
    const quotaUnavailable = requireQuotaState(reply);
    if (quotaUnavailable) {
      return quotaUnavailable;
    }
    const body = request.body;
    if (!isRecord(body)) {
      return validationError(reply, "request body is required");
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return validationError(reply, "prompt cannot be empty");
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return validationError(reply, `prompt cannot exceed ${MAX_PROMPT_LENGTH} characters`);
    }
    if (body.model !== undefined && !isModelPreference(body.model)) {
      return validationError(reply, "model must be smart_multi, fast_only, or pro_only");
    }

    const activeAccount = await resolveActiveMissionAccount();
    if (!activeAccount) {
      return reply.status(401).send(
        apiError("Unauthorized", {
          code: "UNAUTHORIZED",
        }),
      );
    }

    try {
      const mission = await missionService.create({
        account: activeAccount,
        anchorModel: mapModelPreference(body.model),
        objective: prompt,
        scope: { mode: "selected_only", paths: [...DEFAULT_SCOPE_PATHS] },
        gitMode: "patch_only",
        modelPolicy: "smart_multi",
        startMode: "immediate",
        reviewAfterPlan: true,
        strictMode: true,
        budgets: structuredClone(DEFAULT_AUTONOMY_BUDGET),
      });

      return reply.status(201).send(
        apiResponse({
          id: mission.id,
          state: "received",
          createdAt: mission.createdAt,
        }),
      );
    } catch (error) {
      return handleMissionRouteError(reply, error, "Failed to create mission");
    }
  });

  app.get<{ Params: { id: string } }>("/api/missions/:id", async (request, reply) => {
    try {
      const mission = await missionService.getById(request.params.id);
      return apiResponse(mission);
    } catch (error) {
      return handleMissionRouteError(reply, error, "Failed to get mission");
    }
  });

  app.get<{ Params: { id: string } }>("/api/missions/:id/plan", async (request, reply) => {
    try {
      const plan = await missionService.getPlan(request.params.id);
      return apiResponse(plan);
    } catch (error) {
      return handleMissionRouteError(reply, error, "Failed to get mission plan");
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/missions/:id/approve",
    { preHandler: approveAuth },
    async (request, reply) => {
      const quotaUnavailable = requireQuotaState(reply);
      if (quotaUnavailable) {
        return quotaUnavailable;
      }
      try {
        await missionService.approve(request.params.id);
        return apiResponse({
          id: request.params.id,
          state: "coding" as const,
        });
      } catch (error) {
        return handleMissionRouteError(reply, error, "Failed to approve mission plan");
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/missions/:id/pause", async (request, reply) => {
    const quotaUnavailable = requireQuotaState(reply);
    if (quotaUnavailable) {
      return quotaUnavailable;
    }
    try {
      await missionService.pause(request.params.id);
      return apiResponse({
        id: request.params.id,
        state: "paused" as const,
      });
    } catch (error) {
      return handleMissionRouteError(reply, error, "Failed to pause mission");
    }
  });

  app.post<{ Params: { id: string } }>("/api/missions/:id/resume", async (request, reply) => {
    const quotaUnavailable = requireQuotaState(reply);
    if (quotaUnavailable) {
      return quotaUnavailable;
    }
    try {
      const mission = await missionService.getById(request.params.id);
      const resumedState = projectResumeState(mission);
      await missionService.resume(request.params.id);
      return apiResponse({
        id: request.params.id,
        state: resumedState,
      });
    } catch (error) {
      return handleMissionRouteError(reply, error, "Failed to resume mission");
    }
  });

  app.post<{ Params: { id: string } }>("/api/missions/:id/cancel", async (request, reply) => {
    const quotaUnavailable = requireQuotaState(reply);
    if (quotaUnavailable) {
      return quotaUnavailable;
    }
    try {
      await missionService.cancel(request.params.id);
      return apiResponse({
        id: request.params.id,
        state: "cancelled" as const,
      });
    } catch (error) {
      return handleMissionRouteError(reply, error, "Failed to cancel mission");
    }
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/missions/:id/artifacts",
    async (request, reply) => {
      const pagination = parseCursorLimit(request, reply);
      if (!pagination) {
        return reply;
      }

      try {
        const page = await missionService.getArtifacts(
          request.params.id,
          pagination.cursor,
          pagination.limit,
        );
        return apiResponse(page.items, {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          total: page.total,
        });
      } catch (error) {
        return handleMissionRouteError(reply, error, "Failed to get mission artifacts");
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/api/missions/:id/timeline",
    async (request, reply) => {
      const pagination = parseCursorLimit(request, reply);
      if (!pagination) {
        return reply;
      }

      try {
        const page = await missionService.getTimeline(
          request.params.id,
          pagination.cursor,
          pagination.limit,
        );
        return apiResponse(page.items, {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        });
      } catch (error) {
        return handleMissionRouteError(reply, error, "Failed to get mission timeline");
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/missions/:id/budget", async (request, reply) => {
    try {
      const budget = await missionService.getBudget(request.params.id);
      return apiResponse(buildBudgetResponse(budget));
    } catch (error) {
      return handleMissionRouteError(reply, error, "Failed to get mission budget");
    }
  });
}
