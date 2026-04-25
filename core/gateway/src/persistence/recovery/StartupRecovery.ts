import type { MissionRepository } from "../../repositories/mission.repository";
import type { MissionModel } from "../../models/mission.model";
import type { AutonomySession } from "../../orchestration/autonomy-types";
import { buildPendingRecoverySummary, type PendingRecoverySummary } from "./RecoveryPrompt";

export interface RecoverySessionController {
  hydrateSession(snapshot: AutonomySession): AutonomySession;
  resumeRecoveredSession(sessionId: string): boolean;
}

export class StartupRecoveryCoordinator {
  private readonly pendingRecoveries = new Map<string, PendingRecoverySummary>();

  constructor(
    private readonly repository: MissionRepository,
    private readonly sessions: RecoverySessionController,
  ) {}

  public async scanInterrupted(): Promise<PendingRecoverySummary[]> {
    const interrupted = await this.repository.findInterrupted();
    this.pendingRecoveries.clear();

    for (const mission of interrupted) {
      const summary = buildPendingRecoverySummary(mission);
      this.pendingRecoveries.set(summary.missionId, summary);
    }

    return this.listPendingRecoveries();
  }

  public listPendingRecoveries(): PendingRecoverySummary[] {
    return Array.from(this.pendingRecoveries.values()).map((item) => structuredClone(item));
  }

  public async resumeRecovery(missionId: string): Promise<boolean> {
    const snapshot = await this.repository.getRuntimeSnapshot(missionId);
    if (!snapshot) {
      return false;
    }

    this.sessions.hydrateSession(snapshot);
    const resumed = this.sessions.resumeRecoveredSession(missionId);
    if (resumed) {
      this.pendingRecoveries.delete(missionId);
    }
    return resumed;
  }

  public async cancelRecovery(missionId: string): Promise<boolean> {
    const mission = await this.repository.findById(missionId);
    if (!mission) {
      return false;
    }

    await this.repository.update(missionId, this.cancelledMissionPatch(mission));
    this.pendingRecoveries.delete(missionId);
    return true;
  }

  private cancelledMissionPatch(mission: MissionModel): Partial<MissionModel> {
    return {
      state: "cancelled",
      currentPhase: "stopped",
      completedAt: new Date().toISOString(),
      stopReason: mission.stopReason ?? "Cancelled during startup recovery",
    };
  }
}
