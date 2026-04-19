import type { AutonomySession, CreateAutonomySessionRequest } from "../orchestration/autonomy-types";
import type { AutonomySessionManager } from "../gateway/autonomy-session-manager";

export interface MissionRuntime {
  startMission(input: CreateAutonomySessionRequest): AutonomySession;
  getSession(id: string): AutonomySession | null;
  pauseMission(id: string, reason?: string): Promise<boolean>;
  resumeMission(id: string, reason?: string): Promise<boolean>;
  cancelMission(id: string, reason?: string): Promise<boolean>;
}

export class AutonomyMissionRuntime implements MissionRuntime {
  constructor(
    private readonly sessionManager: Pick<
      AutonomySessionManager,
      "startSession" | "getSession" | "pauseSession" | "resumeSession" | "stopSession"
    >,
  ) {}

  public startMission(input: CreateAutonomySessionRequest): AutonomySession {
    return this.sessionManager.startSession(input);
  }

  public getSession(id: string): AutonomySession | null {
    return this.sessionManager.getSession(id);
  }

  public async pauseMission(id: string, reason?: string): Promise<boolean> {
    return await this.sessionManager.pauseSession(id, reason);
  }

  public async resumeMission(id: string, reason?: string): Promise<boolean> {
    return await this.sessionManager.resumeSession(id, reason);
  }

  public async cancelMission(id: string, reason?: string): Promise<boolean> {
    return await this.sessionManager.stopSession(id, reason);
  }
}
