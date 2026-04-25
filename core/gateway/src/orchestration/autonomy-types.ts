export type AutonomyState =
  | "queued"
  | "init"
  | "plan"
  | "execute"
  | "verify"
  | "reflect"
  | "paused"
  | "retry"
  | "done"
  | "failed"
  | "stopped";

export type TaskNodeType =
  | "analysis"
  | "implementation"
  | "refactor"
  | "test-fix"
  | "verification"
  | "finalize";

export type TaskNodeStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export type ScopeMode = "selected_only";
export type ScopeViolationCode = "SCOPE_VIOLATION";
export type ModelPolicy = "smart_multi" | "fast_only" | "pro_only";
export type GearLevel = "fast" | "standard" | "elite";
export type GitMode = "auto_branch_commit" | "patch_only";
export type AutonomyStartMode = "queued" | "immediate";

export type ModelSwitchReason =
  | "INITIAL"
  | "ROUTER_POLICY"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "FORMAT_ERROR"
  | "QUALITY_FAIL_RECOVERY"
  | "BUDGET_EXCEEDED";

export type AutonomyGear = GearLevel;
export type AutonomyReviewStatus = "none" | "plan_pending" | "approved" | "rejected";

export interface BudgetLimits {
  maxCycles: number;
  maxDurationMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTPM: number;
  maxRPD: number;
  maxUsd?: number;
}

export interface BudgetUsage {
  cyclesUsed: number;
  durationMsUsed: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  currentTPM: number;
  requestsUsed: number;
  reservedTPM?: number;
  reservedRequests?: number;
  cachedInputTokensUsed?: number;
  usdUsed: number;
}

export interface BudgetStatus {
  limits: BudgetLimits;
  usage: BudgetUsage;
  warning: boolean;
  warningReason: string | null;
  exceeded: boolean;
  exceedReason: string | null;
}

export interface ScopePolicy {
  mode: ScopeMode;
  paths: string[];
}

export interface TaskNode {
  id: string;
  type: TaskNodeType;
  status: TaskNodeStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  updatedAt: string;
}

export interface ModelDecision {
  selectedModel: string;
  previousModel: string | null;
  anchorModel: string;
  reasonCode: ModelSwitchReason;
  switched: boolean;
  timestamp: string;
}

export interface GateCommandResult {
  command: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AuditSummary {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  total: number;
}

export interface GateResult {
  passed: boolean;
  strictMode: boolean;
  impactedScopes: Array<"root" | "ui" | "vscode-extension">;
  commands: GateCommandResult[];
  blockingIssues: string[];
  auditSummary: AuditSummary;
  timestamp: string;
}

export interface GateContext {
  sessionId: string;
  projectRoot: string;
  touchedFiles: string[];
  scopePaths: string[];
  client?: unknown; // import("./gateway-client").AlloyGatewayClient if possible, but cross-module type avoids circularity
}

export interface GateMetadata {
  commands?: GateCommandResult[];
  audit?: AuditSummary;
  scopes?: Array<"root" | "ui" | "vscode-extension">;
  skipped?: boolean;
  reason?: string;
  llmVerified?: boolean;
  promptLength?: number;
}

export interface AutonomousGate {
  name: string;
  run(context: GateContext): Promise<{
    passed: boolean;
    issues: string[];
    metadata?: GateMetadata;
  }>;
}

export interface SessionArtifacts {
  plan: string;
  changeSummary: string;
  nextActionReason: string;
  gateResult: GateResult | null;
  rawResponses: string[];
  contextPack: string;
}

export interface AutonomyTimelineEntry {
  cycle: number;
  state: AutonomyState;
  taskId: string | null;
  note: string;
  timestamp: string;
}

export interface SessionOpLogEntry {
  operationId: string;
  cycle: number;
  taskType: TaskNodeType;
  status: "started" | "completed" | "failed";
  summary: string;
  touchedFiles: string[];
  timestamp: string;
}

import type { AlloyGatewayClient } from "./gateway-client";
import type { BudgetExecutionAccounting } from "./BudgetTracker";

export type AutonomousClientResolver = (session: AutonomySession) => Promise<AlloyGatewayClient>;

export interface AutonomousTaskExecutorResult {
  summary: string;
  touchedFiles?: string[];
  nextActionReason?: string;
  contextPack?: string;
  usageAccounting?: BudgetExecutionAccounting;
  inputTokens?: number;
  outputTokens?: number;
  estimatedUsd?: number;
}

export interface AutonomousTaskExecutionContext {
  session: AutonomySession;
  task: TaskNode;
  modelDecision: ModelDecision;
  cycle: number;
  isInterrupted: () => boolean;
}

export type AutonomousTaskExecutor = (
  context: AutonomousTaskExecutionContext,
) => Promise<AutonomousTaskExecutorResult>;

export interface AutonomySession {
  id: string;
  objective: string;
  account: string;
  anchorModel: string;
  modelPolicy: ModelPolicy;
  gitMode: GitMode;
  startMode: AutonomyStartMode;
  scope: ScopePolicy;
  strictMode: boolean;
  state: AutonomyState;
  reviewAfterPlan: boolean;
  currentModel: string | null;
  currentGear: AutonomyGear | null;
  reviewStatus: AutonomyReviewStatus;
  reviewUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  cycleCount: number;
  maxCycles: number;
  maxDurationMs: number;
  queuePosition: number | null;
  budgets: BudgetStatus;
  consecutiveGateFailures: number;
  branchName: string | null;
  baseBranch: string | null;
  commitHash: string | null;
  touchedFiles: string[];
  baselineDirtyFiles: string[];
  modelHistory: ModelDecision[];
  timeline: AutonomyTimelineEntry[];
  opLog: SessionOpLogEntry[];
  taskGraph: TaskNode[];
  artifacts: SessionArtifacts;
  error: string | null;
  stopReason: string | null;
  lastProgressAt: string;
}

export interface CreateAutonomySessionRequest {
  account: string;
  anchorModel: string;
  objective: string;
  scope: ScopePolicy;
  modelPolicy: ModelPolicy;
  gitMode: GitMode;
  startMode?: AutonomyStartMode;
  reviewAfterPlan?: boolean;
  strictMode?: boolean;
  maxCycles?: number;
  maxDurationMs?: number;
  budgets?: Partial<BudgetLimits>;
  taskGraph?: TaskNode[]; // Optional custom graph
}

export interface StopAutonomySessionRequest {
  reason?: string;
}

export interface PauseAutonomySessionRequest {
  reason?: string;
}

export interface ResumeAutonomySessionRequest {
  reason?: string;
}

export interface CreateAutonomyWsTicketRequest {
  sessionId: string;
}

export interface CreateAutonomyWsTicketResponse {
  ticket: string;
  expiresAt: string;
}

export interface AutonomyEvent {
  type:
    | "created"
    | "state"
    | "step"
    | "model_switch"
    | "gear_completed"
    | "gear_failed"
    | "decision_log"
    | "queue"
    | "gate_result"
    | "gate_bypass"
    | "budget"
    | "artifact"
    | "log"
    | "diff_ready"
    | "done"
    | "failed"
    | "stopped";
  sessionId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface AutonomyQueueItem {
  sessionId: string;
  state: AutonomyState;
  objective: string;
  account: string;
  createdAt: string;
  queuePosition: number;
}

export interface AccountQuotaUsageSnapshot {
  accountKey: string;
  currentTPM: number;
  requestsUsed: number;
  reservedTPM: number;
  reservedRequests: number;
  cachedInputTokensUsed: number;
}

export interface QuotaReservationRecord {
  reservationId: string;
  accountKey: string;
  sessionId: string;
  requestId: string;
  estimatedTokens: number;
  leaseExpiresAtMs: number;
  createdAtMs: number;
}

export interface ReserveQuotaParams {
  accountKey: string;
  sessionId: string;
  requestId: string;
  estimatedTokens: number;
  maxTPM: number;
  maxRPD: number;
  leaseExpiresAtMs: number;
  nowMs?: number;
}

export interface ReserveQuotaResult {
  accepted: boolean;
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot;
  reason: string | null;
}

export interface CommitQuotaParams {
  reservationId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  nowMs?: number;
}

export interface CommitQuotaResult {
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot | null;
  committedTokens: number;
  cachedInputTokens: number;
}

export interface ReleaseQuotaResult {
  reservation: QuotaReservationRecord | null;
  usage: AccountQuotaUsageSnapshot | null;
  released: boolean;
}

export interface ReleaseSessionQuotaResult {
  usageByAccount: AccountQuotaUsageSnapshot[];
  releasedReservations: number;
}

export interface InitializeQuotaStateResult {
  clearedReservations: number;
}
