import type { AgentDefinition } from "../agents";
import type { VerificationResult } from "../verification-engine";

/**
 * Plan modes: control which agents run.
 */
export const PlanMode = {
  FULL: "full",
  MANAGEMENT_ONLY: "management_only",
  DEV_ONLY: "dev_only",
  QUALITY_ONLY: "quality_only",
  CUSTOM: "custom",
} as const;

export type PlanMode = (typeof PlanMode)[keyof typeof PlanMode];

/**
 * Error categories for structured error handling.
 */
export type ErrorCategory =
  | "network"
  | "timeout"
  | "validation"
  | "llm_error"
  | "rate_limit"
  | "auth"
  | "unknown";

/**
 * Token usage tracking per agent.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/**
 * Result of a single agent execution.
 */
export interface AgentResult {
  agent: AgentDefinition;
  status: "completed" | "skipped" | "failed" | "halted";
  durationMs: number;
  outputFile: string | null;
  error?: string;
  verification?: VerificationResult;
  tokenUsage?: TokenUsage;
  attempts?: number;
}

/**
 * Result of the full pipeline run.
 */
export interface PipelineResult {
  status: "completed" | "failed" | "paused" | "halted";
  agentResults: AgentResult[];
  totalDurationMs: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  haltedCount: number;
  totalTokenUsage?: TokenUsage;
  totalEstimatedCostUsd?: number;
}
