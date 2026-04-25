import type {
  AutonomySession,
} from "../orchestration/autonomy-types";
import {
  type MissionArtifact,
  type MissionModel,
  type MissionPlan,
  type MissionState,
  type MissionTimelineEvent,
} from "./mission.model";

const SECTION_PATTERN = /^##\s+(.+?)\s*$/;

export class MissionFactory {
  /**
   * Converts an AutonomySession into a MissionModel
   */
  public static fromSession(session: AutonomySession): MissionModel {
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
      state: this.normalizeState(session),
      currentPhase: session.state,
      currentGear: session.currentGear,
      currentModel: session.currentModel,
      reviewStatus: session.reviewStatus,
      reviewUpdatedAt: session.reviewUpdatedAt,
      scopePaths: [...session.scope.paths],
      strictMode: session.strictMode,
      anchorModel: session.anchorModel,
      gateResults: session.artifacts.gateResult ? [structuredClone(session.artifacts.gateResult)] : [],
      plan: this.parsePlan(session.artifacts.plan),
      timeline: this.buildTimeline(session),
      artifacts: this.buildArtifacts(session),
      budget: structuredClone(session.budgets),
      touchedFiles: [...session.touchedFiles],
      completedAt,
      error: session.error,
      stopReason: session.stopReason,
      lastProgressAt: session.lastProgressAt ?? session.updatedAt,
    };
  }

  public static normalizeState(session: Pick<AutonomySession, "state" | "reviewStatus">): MissionState {
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
      default:
        return "received";
    }
  }

  public static parsePlan(raw: string): MissionPlan | null {
    const normalizedRaw = raw.trim();
    if (normalizedRaw.length === 0) {
      return null;
    }

    const sections = this.parsePlanSections(normalizedRaw);

    return {
      raw: normalizedRaw,
      objective: sections.get("Objective") ?? "",
      scope: this.parseBulletList(sections.get("Scope") ?? ""),
      currentPhase: sections.get("Current Phase") ?? null,
      currentModel: sections.get("Current Model") ?? null,
      proposedSteps: this.parseBulletList(sections.get("Proposed Steps") ?? ""),
      expectedTouchPoints: this.parseBulletList(sections.get("Expected Touch Points") ?? ""),
      risks: this.parseBulletList(sections.get("Risks / Gate Expectations") ?? ""),
      nextAction: sections.get("Next Action") ?? "",
    };
  }

  private static parsePlanSections(raw: string): Map<string, string> {
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

  private static parseBulletList(section: string): string[] {
    return section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*]\s+/, ""));
  }

  private static buildTimeline(session: AutonomySession): MissionTimelineEvent[] {
    return session.timeline.map((entry, index) => ({
      id: `${session.id}:timeline:${index}`,
      timestamp: entry.timestamp,
      cycle: entry.cycle,
      state: entry.state,
      taskId: entry.taskId,
      note: entry.note,
    }));
  }

  private static buildArtifacts(session: AutonomySession): MissionArtifact[] {
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
}
