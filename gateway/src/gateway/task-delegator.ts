/**
 * Task Delegation API â€” Independent Agent Assignment
 *
 * Enables the user to assign work to specific agent groups independently:
 *   - "Planlama yap" â†’ Management agents only (CEO, PM, Architect)
 *   - "Kod yaz" â†’ Development agents only (Backend, Frontend, Auth)
 *   - "Test et" â†’ Quality agents only (Unit Test, Integration Test, Security)
 *   - "Full pipeline" â†’ All 18 agents
 *   - Custom â†’ Any combination of agents
 *
 * This builds on the existing PlanMode system but adds:
 *   1. Provider-aware model selection per agent group
 *   2. Independent group execution (groups can run concurrently)
 *   3. Cross-group dependency management
 *   4. Real-time progress tracking per group
 *
 * Usage from Gateway API:
 *   POST /api/delegate
 *   {
 *     "task": "Build a REST API with auth",
 *     "groups": ["plan", "code"],
 *     "provider": "google_gemini",
 *     "options": { "modelOverride": "claude-opus-4" }
 *   }
 */

import { AGENTS, type AgentDefinition } from "../orchestration/agents";
import { PlanMode } from "../orchestration/sequential-pipeline";
import type { AIProvider } from "./provider-types";

// â”€â”€â”€ Task Group Definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const TaskGroup = {
  /** CEO â†’ Architect: Strategic planning, requirements, architecture */
  PLAN: "plan",
  /** UI/UX â†’ API Designer: Design specifications */
  DESIGN: "design",
  /** Backend â†’ Integration: Code implementation */
  CODE: "code",
  /** Unit Test â†’ Performance: Quality assurance */
  TEST: "test",
  /** Code Review â†’ DevOps: Final delivery */
  DELIVER: "deliver",
  /** All agents */
  FULL: "full",
  /** Custom selection */
  CUSTOM: "custom",
} as const;

export type TaskGroup = (typeof TaskGroup)[keyof typeof TaskGroup];

// â”€â”€â”€ Group â†’ Agent Mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const GROUP_AGENTS: Record<TaskGroup, string[]> = {
  plan: ["ceo", "pm", "architect"],
  design: ["ui_ux", "database", "api_designer"],
  code: ["backend", "frontend", "auth", "integration"],
  test: ["unit_test", "integration_test", "security", "performance"],
  deliver: ["code_review", "docs", "tech_writer", "devops"],
  full: AGENTS.map((a) => a.role),
  custom: [], // Populated at runtime
};

// â”€â”€â”€ Group â†’ PlanMode Mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const GROUP_PLAN_MODE: Record<TaskGroup, PlanMode> = {
  plan: PlanMode.MANAGEMENT_ONLY,
  design: PlanMode.CUSTOM,
  code: PlanMode.DEV_ONLY,
  test: PlanMode.QUALITY_ONLY,
  deliver: PlanMode.CUSTOM,
  full: PlanMode.FULL,
  custom: PlanMode.CUSTOM,
};

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DelegationRequest {
  /** The user's task description */
  task: string;
  /** Which groups to run */
  groups: TaskGroup[];
  /** Specific agent roles (for custom mode) */
  customAgents?: string[];
  /** Provider preference */
  provider?: AIProvider;
  /** Model override for all agents in this delegation */
  modelOverride?: string;
  /** Run groups concurrently (default: sequential) */
  parallel?: boolean;
  /** Skip specific agents */
  skipAgents?: string[];
  /** Temperature for LLM calls */
  temperature?: number;
  /** Max output tokens */
  maxOutputTokens?: number;
}

export interface DelegationPlan {
  /** Computed execution plan */
  stages: DelegationStage[];
  /** Total agents that will run */
  totalAgents: number;
  /** Estimated time in minutes */
  estimatedMinutes: number;
  /** Dependencies between groups */
  dependencies: GroupDependency[];
  /** Validation issues (warnings) */
  warnings: string[];
}

export interface DelegationStage {
  /** Stage name */
  name: string;
  /** Group this stage belongs to */
  group: TaskGroup;
  /** Agents in this stage */
  agents: AgentDefinition[];
  /** Whether this stage can run in parallel with the next */
  parallel: boolean;
  /** Dependencies: which groups must complete before this stage */
  requires: TaskGroup[];
  /** Provider for this stage */
  provider?: AIProvider;
  /** PlanMode to pass to the SequentialPipeline */
  planMode: PlanMode;
}

export interface GroupDependency {
  from: TaskGroup;
  to: TaskGroup;
  reason: string;
}

// â”€â”€â”€ Cross-Group Dependencies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const GROUP_DEPENDENCIES: GroupDependency[] = [
  { from: "plan", to: "design", reason: "Design needs architecture decisions" },
  { from: "plan", to: "code", reason: "Code needs requirements + architecture" },
  { from: "design", to: "code", reason: "Code needs DB schema + API contracts" },
  { from: "code", to: "test", reason: "Tests need code to exist" },
  { from: "test", to: "deliver", reason: "Delivery needs passing tests" },
];

// â”€â”€â”€ Task Delegator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class TaskDelegator {
  /**
   * Validate a delegation request and build an execution plan.
   */
  plan(request: DelegationRequest): DelegationPlan {
    const warnings: string[] = [];
    const allAgentRoles = new Set<string>();
    const stages: DelegationStage[] = [];

    // Resolve which agents to run
    for (const group of request.groups) {
      let roles: string[];

      if (group === TaskGroup.CUSTOM) {
        roles = request.customAgents ?? [];
        if (roles.length === 0) {
          warnings.push("Custom group specified but no agents provided");
          continue;
        }
      } else {
        roles = GROUP_AGENTS[group] ?? [];
      }

      // Filter out skipped agents
      const skipSet = new Set(request.skipAgents ?? []);
      const filteredRoles = roles.filter((r) => !skipSet.has(r));

      const agents = AGENTS.filter((a) => filteredRoles.includes(a.role));
      if (agents.length === 0) {
        warnings.push(`Group "${group}" has no agents after filtering`);
        continue;
      }

      agents.forEach((a) => allAgentRoles.add(a.role));

      // Determine dependencies for this group
      const requires = this.getRequiredGroups(group, request.groups);

      stages.push({
        name: `${this.getGroupLabel(group)} (${agents.length} agents)`,
        group,
        agents,
        parallel: request.parallel ?? false,
        requires,
        provider: request.provider,
        planMode: GROUP_PLAN_MODE[group] ?? PlanMode.CUSTOM,
      });
    }

    // Dependency validation warnings
    for (const dep of GROUP_DEPENDENCIES) {
      if (
        request.groups.includes(dep.to as TaskGroup) &&
        !request.groups.includes(dep.from as TaskGroup)
      ) {
        warnings.push(
          `Group "${dep.to}" depends on "${dep.from}" (${dep.reason}), but "${dep.from}" is not included. ` +
          `Ensure outputs from "${dep.from}" already exist.`
        );
      }
    }

    const estimatedMinutes = stages.reduce(
      (sum, s) => sum + s.agents.reduce((a, agent) => a + agent.estimatedMinutes, 0),
      0,
    );

    // Sort stages by dependency order
    const sortedStages = this.topologicalSort(stages);

    return {
      stages: sortedStages,
      totalAgents: allAgentRoles.size,
      estimatedMinutes,
      dependencies: this.getRelevantDependencies(request.groups),
      warnings,
    };
  }

  /**
   * Convert a delegation plan into SequentialPipeline options.
   * This bridges the delegation system with the existing pipeline.
   */
  toPipelineOptions(
    plan: DelegationPlan,
    stageIndex: number,
  ): { skipAgents: string[]; planMode: PlanMode; startFromOrder: number } {
    const stage = plan.stages[stageIndex];
    if (!stage) throw new Error(`Invalid stage index: ${stageIndex}`);

    const agentRolesInStage = new Set(stage.agents.map((a) => a.role));
    const allAgents = AGENTS.map((a) => a.role);
    const skipAgents = allAgents.filter((r) => !agentRolesInStage.has(r));

    const minOrder = Math.min(...stage.agents.map((a) => a.order));

    return {
      skipAgents,
      planMode: stage.planMode,
      startFromOrder: minOrder,
    };
  }

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private getRequiredGroups(group: TaskGroup, selectedGroups: TaskGroup[]): TaskGroup[] {
    return GROUP_DEPENDENCIES
      .filter((dep) => dep.to === group && selectedGroups.includes(dep.from as TaskGroup))
      .map((dep) => dep.from as TaskGroup);
  }

  private getRelevantDependencies(groups: TaskGroup[]): GroupDependency[] {
    const groupSet = new Set(groups);
    return GROUP_DEPENDENCIES.filter(
      (dep) => groupSet.has(dep.from as TaskGroup) && groupSet.has(dep.to as TaskGroup),
    );
  }

  private topologicalSort(stages: DelegationStage[]): DelegationStage[] {
    const stageMap = new Map<TaskGroup, DelegationStage>();
    stages.forEach((s) => stageMap.set(s.group, s));

    const visited = new Set<TaskGroup>();
    const sorted: DelegationStage[] = [];

    const visit = (stage: DelegationStage) => {
      if (visited.has(stage.group)) return;
      visited.add(stage.group);

      for (const req of stage.requires) {
        const reqStage = stageMap.get(req);
        if (reqStage) visit(reqStage);
      }

      sorted.push(stage);
    };

    for (const stage of stages) {
      visit(stage);
    }

    return sorted;
  }

  private getGroupLabel(group: TaskGroup): string {
    const labels: Record<TaskGroup, string> = {
      plan: "ğŸ“‹ Planlama",
      design: "ğŸ¨ TasarÄ±m",
      code: "âš™ï¸ GeliÅŸtirme",
      test: "ğŸ§ª Test",
      deliver: "ğŸš€ Teslimat",
      full: "ğŸ­ Tam Pipeline",
      custom: "âš¡ Ã–zel",
    };
    return labels[group] ?? group;
  }

  // â”€â”€ Static Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  static getAvailableGroups(): { id: TaskGroup; label: string; agents: string[]; estimatedMinutes: number }[] {
    return [
      { id: TaskGroup.PLAN, label: "ğŸ“‹ Planlama (CEO â†’ Architect)", agents: GROUP_AGENTS.plan, estimatedMinutes: 18 },
      { id: TaskGroup.DESIGN, label: "ğŸ¨ TasarÄ±m (UI/UX â†’ API)", agents: GROUP_AGENTS.design, estimatedMinutes: 15 },
      { id: TaskGroup.CODE, label: "âš™ï¸ GeliÅŸtirme (Backend â†’ Integration)", agents: GROUP_AGENTS.code, estimatedMinutes: 35 },
      { id: TaskGroup.TEST, label: "ğŸ§ª Test (Unit â†’ Performance)", agents: GROUP_AGENTS.test, estimatedMinutes: 20 },
      { id: TaskGroup.DELIVER, label: "ğŸš€ Teslimat (Review â†’ DevOps)", agents: GROUP_AGENTS.deliver, estimatedMinutes: 20 },
      { id: TaskGroup.FULL, label: "ğŸ­ Tam Pipeline (18 Agent)", agents: GROUP_AGENTS.full, estimatedMinutes: 108 },
    ];
  }
}
