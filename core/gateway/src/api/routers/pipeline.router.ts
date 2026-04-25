import type { FastifyInstance } from "fastify";
import { type TokenStore } from "../../gateway/token-store";
import { type AccountManager } from "../../plugin/accounts";
import { SequentialPipeline } from "../../orchestration/sequential-pipeline";
import { AlloyGatewayClient } from "../../orchestration/gateway-client";
import { apiResponse, apiError } from "../../gateway/rest-response";

const VALID_PLAN_MODES = new Set([
  "full",
  "management_only",
  "dev_only",
  "quality_only",
  "custom",
]);
const MAX_USER_TASK_LENGTH = 10_000;

export interface PipelineRouteDependencies {
  tokenStore: TokenStore;
  getAccountManager: () => AccountManager | null;
  projectRoot: string;
  getActivePipeline: () => SequentialPipeline | null;
  setActivePipeline: (pipeline: SequentialPipeline | null) => void;
}

export function registerPipelineRoutes(
  app: FastifyInstance,
  dependencies: PipelineRouteDependencies,
): void {
  const { tokenStore, getAccountManager, projectRoot, getActivePipeline, setActivePipeline } = dependencies;

  app.get("/api/pipelines/status", async () => {
    const activePipeline = getActivePipeline();
    if (!activePipeline) {
      return apiResponse({ status: "idle" });
    }
    const progress = await activePipeline.getProgress();
    return apiResponse(progress);
  });

  app.post<{ Body: { userTask: string; planMode?: string } }>(
    "/api/pipelines/start",
    async (request, reply) => {
      const { userTask, planMode } = request.body ?? {};

      // Input validation
      if (
        !userTask ||
        typeof userTask !== "string" ||
        userTask.trim().length === 0
      ) {
        return reply
          .status(400)
          .send(apiError("userTask is required and must be a non-empty string", { code: "BAD_REQUEST" }));
      }
      if (userTask.length > MAX_USER_TASK_LENGTH) {
        return reply
          .status(400)
          .send(apiError(`userTask exceeds maximum length of ${MAX_USER_TASK_LENGTH} characters`, { code: "BAD_REQUEST" }));
      }
      if (planMode !== undefined && !VALID_PLAN_MODES.has(planMode)) {
        return reply
          .status(400)
          .send(apiError(`Invalid planMode. Valid values: ${[...VALID_PLAN_MODES].join(", ")}`, { code: "BAD_REQUEST" }));
      }

      const activePipeline = getActivePipeline();
      if (activePipeline) {
        const progress = await activePipeline.getProgress();
        if (progress.state.pipelineStatus === "running") {
          return reply.status(409).send(apiError("Pipeline is already running", { code: "CONFLICT" }));
        }
      }

      const token = tokenStore.getActiveToken();
      if (!token) {
        return reply.status(401).send(apiError("No active account", { code: "UNAUTHORIZED" }));
      }

      const accountManager = getAccountManager();
      if (accountManager && token.email) {
          accountManager.switchToAccountByEmail(token.email);
      }

      const client = AlloyGatewayClient.fromToken(
        token.accessToken,
        token.email,
        accountManager || undefined
      );
      
      const newPipeline = new SequentialPipeline(projectRoot, client);
      setActivePipeline(newPipeline);

      // Start in background
      newPipeline
        .start(userTask.trim(), { planMode: planMode as import("../../orchestration/sequential-pipeline").PlanMode })
        .catch((err) => {
          app.log.error(err, "[GatewayServer] Pipeline background error");
        });

      return apiResponse({ message: "Pipeline started" });
    },
  );

  app.post("/api/pipelines/stop", async (_request, reply) => {
    const activePipeline = getActivePipeline();
    if (activePipeline) {
      activePipeline.pause();
      return apiResponse({ stopped: true });
    }
    return reply.status(404).send(apiError("No active pipeline", { code: "RESOURCE_NOT_FOUND" }));
  });
}
