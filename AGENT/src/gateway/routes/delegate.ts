/**
 * Delegation Route — Task Assignment API
 *
 * Enables users to delegate work to specific agent groups:
 *   POST /api/delegate           → Start a delegated task
 *   GET  /api/delegate/groups    → List available groups
 *   POST /api/delegate/plan      → Preview execution plan without starting
 *
 * This is the core "plana ayrı, code yazana ayrı iş ver" capability.
 */

import type { FastifyInstance } from "fastify";
import { apiResponse, apiError } from "../rest-response";
import { TaskDelegator, TaskGroup, type DelegationRequest } from "../task-delegator";
import { AGENTS } from "../../orchestration/agents";

// ─── Singleton Delegator ────────────────────────────────────────────────────

const delegator = new TaskDelegator();

// ─── Types ──────────────────────────────────────────────────────────────────

interface DelegateBody {
  task: string;
  groups: string[];
  customAgents?: string[];
  provider?: string;
  modelOverride?: string;
  parallel?: boolean;
  skipAgents?: string[];
  temperature?: number;
  maxOutputTokens?: number;
}

interface PlanPreviewBody {
  task: string;
  groups: string[];
  customAgents?: string[];
  skipAgents?: string[];
}

// ─── Route Registration ─────────────────────────────────────────────────────

export function registerDelegationRoutes(app: FastifyInstance): void {

  // ── GET /api/delegate/groups — List available groups ─────────────────────
  app.get("/api/delegate/groups", async () => {
    const groups = TaskDelegator.getAvailableGroups();
    return apiResponse(groups);
  });

  // ── GET /api/delegate/agents — List all agents with metadata ────────────
  app.get("/api/delegate/agents", async () => {
    const agents = AGENTS.map((a) => ({
      order: a.order,
      role: a.role,
      name: a.name,
      emoji: a.emoji,
      layer: a.layer,
      estimatedMinutes: a.estimatedMinutes,
      inputFiles: a.inputFiles,
      outputFiles: a.outputFiles,
      backtrackTargets: a.backtrackTargets,
    }));
    return apiResponse(agents);
  });

  // ── POST /api/delegate/plan — Preview execution plan ────────────────────
  app.post<{ Body: PlanPreviewBody }>(
    "/api/delegate/plan",
    async (request, reply) => {
      const { task, groups, customAgents, skipAgents } = request.body ?? {};

      if (!task || typeof task !== "string") {
        return reply.status(400).send(apiError("task is required"));
      }

      if (!groups || !Array.isArray(groups) || groups.length === 0) {
        return reply.status(400).send(apiError("groups is required (array of group IDs)"));
      }

      // Validate group IDs
      const validGroups = new Set(Object.values(TaskGroup));
      const invalidGroups = groups.filter((g) => !validGroups.has(g as TaskGroup));
      if (invalidGroups.length > 0) {
        return reply.status(400).send(
          apiError(`Invalid groups: ${invalidGroups.join(", ")}. Valid: ${[...validGroups].join(", ")}`)
        );
      }

      const plan = delegator.plan({
        task,
        groups: groups as TaskGroup[],
        customAgents,
        skipAgents,
      });

      return apiResponse({
        stages: plan.stages.map((s) => ({
          name: s.name,
          group: s.group,
          agents: s.agents.map((a) => ({
            role: a.role,
            name: a.name,
            emoji: a.emoji,
            estimatedMinutes: a.estimatedMinutes,
          })),
          requires: s.requires,
          parallel: s.parallel,
        })),
        totalAgents: plan.totalAgents,
        estimatedMinutes: plan.estimatedMinutes,
        dependencies: plan.dependencies,
        warnings: plan.warnings,
      });
    },
  );

  // ── POST /api/delegate — Start a delegated task ─────────────────────────
  app.post<{ Body: DelegateBody }>(
    "/api/delegate",
    async (request, reply) => {
      const body = request.body ?? {};
      const { task, groups } = body;

      if (!task || typeof task !== "string") {
        return reply.status(400).send(apiError("task is required"));
      }

      if (!groups || !Array.isArray(groups) || groups.length === 0) {
        return reply.status(400).send(apiError("groups is required"));
      }

      const validGroups = new Set(Object.values(TaskGroup));
      const invalidGroups = groups.filter((g) => !validGroups.has(g as TaskGroup));
      if (invalidGroups.length > 0) {
        return reply.status(400).send(
          apiError(`Invalid groups: ${invalidGroups.join(", ")}`)
        );
      }

      const delegationRequest: DelegationRequest = {
        task,
        groups: groups as TaskGroup[],
        customAgents: body.customAgents,
        provider: body.provider as any,
        modelOverride: body.modelOverride,
        parallel: body.parallel,
        skipAgents: body.skipAgents,
        temperature: body.temperature,
        maxOutputTokens: body.maxOutputTokens,
      };

      const plan = delegator.plan(delegationRequest);

      if (plan.warnings.length > 0 && plan.totalAgents === 0) {
        return reply.status(400).send(
          apiError("No agents to run after filtering", { warnings: plan.warnings })
        );
      }

      // Generate pipeline options for each stage
      // The actual execution is handled by AutonomySessionManager
      const executionPlan = plan.stages.map((stage, i) => ({
        stage: i + 1,
        name: stage.name,
        group: stage.group,
        pipelineOptions: delegator.toPipelineOptions(plan, i),
        agentCount: stage.agents.length,
        requires: stage.requires,
      }));

      return apiResponse({
        status: "planned",
        plan: {
          totalAgents: plan.totalAgents,
          estimatedMinutes: plan.estimatedMinutes,
          warnings: plan.warnings,
        },
        execution: executionPlan,
        message: `Delegation plan created: ${plan.totalAgents} agents across ${plan.stages.length} stages (~${plan.estimatedMinutes} min)`,
      });
    },
  );
}
