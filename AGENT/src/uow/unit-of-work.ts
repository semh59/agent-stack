import { MissionDatabase, getMissionDatabase } from "../persistence/database";
import { SQLiteMissionRepository } from "../persistence/SQLiteMissionRepository";
import {
  InMemoryMissionRepository,
  type MissionRepository,
} from "../repositories/mission.repository";

export interface UnitOfWork {
  readonly missions: MissionRepository;
  complete(): Promise<void>;
  rollback(): Promise<void>;
}

export interface InMemoryUnitOfWorkOptions {
  repository?: MissionRepository;
}

export class InMemoryUnitOfWork implements UnitOfWork {
  public readonly missions: MissionRepository;

  constructor(options: InMemoryUnitOfWorkOptions = {}) {
    this.missions = options.repository ?? new InMemoryMissionRepository();
  }

  public async complete(): Promise<void> {
    // No-op by design. In-memory state mutates immediately.
  }

  public async rollback(): Promise<void> {
    // No-op by design. In-memory state mutates immediately.
  }
}

export interface SQLiteUnitOfWorkOptions {
  database?: MissionDatabase;
  repository?: MissionRepository;
}

export class SQLiteUnitOfWork implements UnitOfWork {
  public readonly missions: MissionRepository;

  constructor(options: SQLiteUnitOfWorkOptions = {}) {
    this.missions =
      options.repository ??
      new SQLiteMissionRepository(options.database ?? getMissionDatabase());
  }

  public async complete(): Promise<void> {
    // Thin facade for Phase 3.2. Repository methods remain the atomic boundary.
  }

  public async rollback(): Promise<void> {
    // Thin facade for Phase 3.2. Request-scoped transactions are deferred.
  }
}
