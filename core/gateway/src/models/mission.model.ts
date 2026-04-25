import type {
  AutonomyEvent,
  AutonomyReviewStatus,
  AutonomyState,
  BudgetStatus,
  GateResult,
} from "../orchestration/autonomy-types";

export type MissionState =
  | "received"
  | "planning"
  | "plan_review"
  | "coding"
  | "verifying"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface MissionFilter {
  state?: MissionState;
  account?: string;
  reviewStatus?: AutonomyReviewStatus;
}

export interface MissionPlan {
  raw: string;
  objective: string;
  scope: string[];
  currentPhase: string | null;
  currentModel: string | null;
  proposedSteps: string[];
  expectedTouchPoints: string[];
  risks: string[];
  nextAction: string;
}

export interface MissionTimelineEvent {
  id: string;
  timestamp: string;
  cycle: number;
  state: AutonomyState;
  taskId: string | null;
  note: string;
}

export interface MissionTimelineRecord {
  id: string;
  missionId: string;
  type: `mission.${AutonomyEvent["type"]}` | string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type MissionTimelinePage = CursorPage<MissionTimelineRecord>;

export interface MissionArtifactPage extends CursorPage<MissionArtifact> {
  total: number;
}

export interface PersistedGateResult {
  id: string;
  missionId: string;
  phase: AutonomyState | null;
  result: GateResult;
  createdAt: string;
  eventHash: string | null;
}

export interface MissionBudgetSnapshot {
  id: string;
  missionId: string;
  budget: BudgetStatus;
  createdAt: string;
  eventHash: string | null;
}

export type MissionArtifactKind =
  | "plan"
  | "change_summary"
  | "next_action_reason"
  | "context_pack"
  | "raw_response"
  | "gate_result";

export interface MissionArtifact<TValue = unknown> {
  id: string;
  kind: MissionArtifactKind;
  createdAt: string;
  value: TValue;
}

export interface MissionModel {
  id: string;
  prompt: string;
  account: string;
  createdAt: string;
  updatedAt: string;
  state: MissionState;
  currentPhase: AutonomyState | null;
  currentGear: "fast" | "standard" | "elite" | null;
  currentModel: string | null;
  reviewStatus: AutonomyReviewStatus;
  reviewUpdatedAt: string | null;
  scopePaths: string[];
  strictMode: boolean;
  anchorModel: string;
  gateResults: GateResult[];
  plan: MissionPlan | null;
  timeline: MissionTimelineEvent[];
  artifacts: MissionArtifact[];
  budget: BudgetStatus;
  touchedFiles: string[];
  completedAt: string | null;
  error: string | null;
  stopReason: string | null;
  lastProgressAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export function isMissionModel(value: unknown): value is MissionModel {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["prompt"] === "string" &&
    typeof record["account"] === "string" &&
    typeof record["createdAt"] === "string" &&
    typeof record["updatedAt"] === "string" &&
    typeof record["state"] === "string" &&
    Array.isArray(record["touchedFiles"])
  );
}

