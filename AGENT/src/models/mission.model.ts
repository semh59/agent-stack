import type {
  AutonomyEvent,
  AutonomyReviewStatus,
  AutonomySession,
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

const SECTION_PATTERN = /^##\s+(.+?)\s*$/;

function parseBulletList(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, ""));
}

function parsePlanSections(raw: string): Map<string, string> {
  const sections = new Map<string, string[]>();
  let currentSection: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const headingMatch = SECTION_PATTERN.exec(line);
    if (headingMatch?.[1]) {
      currentSection = headingMatch[1];
      sections.set(currentSection, []);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    sections.get(currentSection)!.push(line);
  }

  return new Map(
    Array.from(sections.entries(), ([key, value]) => [key, value.join("\n").trim()]),
  );
}

function normalizeMissionState(session: Pick<AutonomySession, "state" | "reviewStatus">): MissionState {
  switch (session.state) {
    case "queued":
    case "init":
      return "received";
    case "plan":
      return session.reviewStatus === "plan_pending" ? "plan_review" : "planning";
    case "execute":
    case "reflect":
    case "retry":
      return "coding";
    case "verify":
      return "verifying";
    case "paused":
      return "paused";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "cancelled";
  }
}

function buildMissionTimeline(session: AutonomySession): MissionTimelineEvent[] {
  return session.timeline.map((entry, index) => ({
    id: `${session.id}:timeline:${index}`,
    timestamp: entry.timestamp,
    cycle: entry.cycle,
    state: entry.state,
    taskId: entry.taskId,
    note: entry.note,
  }));
}

function buildMissionArtifacts(session: AutonomySession): MissionArtifact[] {
  const artifacts: MissionArtifact[] = [];
  const artifactTimestamp = session.updatedAt;

  if (session.artifacts.plan.trim().length > 0) {
    artifacts.push({
      id: `${session.id}:artifact:plan`,
      kind: "plan",
      createdAt: session.reviewUpdatedAt ?? artifactTimestamp,
      value: session.artifacts.plan,
    });
  }

  if (session.artifacts.changeSummary.trim().length > 0) {
    artifacts.push({
      id: `${session.id}:artifact:change_summary`,
      kind: "change_summary",
      createdAt: artifactTimestamp,
      value: session.artifacts.changeSummary,
    });
  }

  if (session.artifacts.nextActionReason.trim().length > 0) {
    artifacts.push({
      id: `${session.id}:artifact:next_action_reason`,
      kind: "next_action_reason",
      createdAt: artifactTimestamp,
      value: session.artifacts.nextActionReason,
    });
  }

  if (session.artifacts.contextPack.trim().length > 0) {
    artifacts.push({
      id: `${session.id}:artifact:context_pack`,
      kind: "context_pack",
      createdAt: artifactTimestamp,
      value: session.artifacts.contextPack,
    });
  }

  session.artifacts.rawResponses.forEach((response, index) => {
    if (response.trim().length === 0) {
      return;
    }
    artifacts.push({
      id: `${session.id}:artifact:raw_response:${index}`,
      kind: "raw_response",
      createdAt: artifactTimestamp,
      value: response,
    });
  });

  if (session.artifacts.gateResult) {
    artifacts.push({
      id: `${session.id}:artifact:gate_result`,
      kind: "gate_result",
      createdAt: session.artifacts.gateResult.timestamp,
      value: structuredClone(session.artifacts.gateResult),
    });
  }

  return artifacts;
}

export function parseMissionPlan(raw: string): MissionPlan | null {
  const normalizedRaw = raw.trim();
  if (normalizedRaw.length === 0) {
    return null;
  }

  const sections = parsePlanSections(normalizedRaw);

  return {
    raw: normalizedRaw,
    objective: sections.get("Objective") ?? "",
    scope: parseBulletList(sections.get("Scope") ?? ""),
    currentPhase: sections.get("Current Phase") ?? null,
    currentModel: sections.get("Current Model") ?? null,
    proposedSteps: parseBulletList(sections.get("Proposed Steps") ?? ""),
    expectedTouchPoints: parseBulletList(sections.get("Expected Touch Points") ?? ""),
    risks: parseBulletList(sections.get("Risks / Gate Expectations") ?? ""),
    nextAction: sections.get("Next Action") ?? "",
  };
}

export function toMissionModel(session: AutonomySession): MissionModel {
  const completedAt =
    session.state === "done" || session.state === "failed" || session.state === "stopped"
      ? session.updatedAt
      : null;

  return {
    id: session.id,
    prompt: session.objective,
    account: session.account,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    state: normalizeMissionState(session),
    currentPhase: session.state,
    currentGear: session.currentGear,
    currentModel: session.currentModel,
    reviewStatus: session.reviewStatus,
    reviewUpdatedAt: session.reviewUpdatedAt,
    scopePaths: [...session.scope.paths],
    strictMode: session.strictMode,
    anchorModel: session.anchorModel,
    gateResults: session.artifacts.gateResult ? [structuredClone(session.artifacts.gateResult)] : [],
    plan: parseMissionPlan(session.artifacts.plan),
    timeline: buildMissionTimeline(session),
    artifacts: buildMissionArtifacts(session),
    budget: structuredClone(session.budgets),
    touchedFiles: [...session.touchedFiles],
    completedAt,
    error: session.error,
    stopReason: session.stopReason,
    lastProgressAt: session.lastProgressAt ?? session.updatedAt,
  };
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
