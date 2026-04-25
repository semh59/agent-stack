import { z } from "zod";

// Re-using types if possible, otherwise defining Zod schemas that match
export const MissionPlanSchema = z.object({
  raw: z.string(),
  objective: z.string(),
  scope: z.array(z.string()),
  currentPhase: z.string().nullable(),
  currentModel: z.string().nullable(),
  proposedSteps: z.array(z.string()),
  expectedTouchPoints: z.array(z.string()),
  risks: z.array(z.string()),
  nextAction: z.string(),
});

export const MissionTimelineEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  cycle: z.number(),
  state: z.enum([
    "queued", "init", "plan", "execute", "verify", "reflect", 
    "paused", "retry", "done", "failed", "stopped"
  ]),
  taskId: z.string().nullable(),
  note: z.string(),
});

export const MissionArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "plan", "change_summary", "next_action_reason", 
    "context_pack", "raw_response", "gate_result"
  ]),
  createdAt: z.string(),
  value: z.any(),
});

export const BudgetStatusSchema = z.object({
  limits: z.object({
    maxCycles: z.number(),
    maxDurationMs: z.number(),
    maxInputTokens: z.number(),
    maxOutputTokens: z.number(),
    maxTPM: z.number(),
    maxRPD: z.number(),
    maxUsd: z.number().optional(),
  }),
  usage: z.object({
    cyclesUsed: z.number(),
    durationMsUsed: z.number(),
    inputTokensUsed: z.number(),
    outputTokensUsed: z.number(),
    currentTPM: z.number(),
    requestsUsed: z.number(),
    usdUsed: z.number(),
    reservedTPM: z.number().optional(),
    reservedRequests: z.number().optional(),
    cachedInputTokensUsed: z.number().optional(),
  }),
  exceeded: z.boolean(),
  exceedReason: z.string().nullable(),
  warning: z.boolean(),
  warningReason: z.string().nullable(),
});

export const GateResultSchema = z.object({
  passed: z.boolean(),
  strictMode: z.boolean(),
  impactedScopes: z.array(z.enum(["root", "ui", "vscode-extension"])),
  commands: z.array(z.object({
    command: z.string(),
    success: z.boolean(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number(),
  })),
  blockingIssues: z.array(z.string()),
  auditSummary: z.object({
    critical: z.number(),
    high: z.number(),
    moderate: z.number(),
    low: z.number(),
    total: z.number(),
  }),
  timestamp: z.string(),
});
