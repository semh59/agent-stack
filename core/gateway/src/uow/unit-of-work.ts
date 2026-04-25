import { getMissionDatabase, type MissionDatabase } from "../persistence/database";
import { SQLiteMissionRepository } from "../persistence/SQLiteMissionRepository";
import { SQLiteQuotaRepository } from "../persistence/SQLiteQuotaRepository";
import { 
  InMemoryMissionRepository, 
  type MissionRepository 
} from "../repositories/mission.repository";
import { 
  InMemoryQuotaRepository, 
  type QuotaRepository 
} from "../repositories/quota.repository";

export interface UnitOfWork {
  readonly missions: MissionRepository;
  readonly quotas: QuotaRepository;
  complete(): Promise<void>;
  rollback(): Promise<void>;
  participate?(): Promise<void>;
}

export interface InMemoryUnitOfWorkOptions {
  repository?: MissionRepository;
  quotaRepository?: QuotaRepository;
}

export class InMemoryUnitOfWork implements UnitOfWork {
  public readonly missions: MissionRepository;
  public readonly quotas: QuotaRepository;

  constructor(options: InMemoryUnitOfWorkOptions = {}) {
    this.missions = options.repository ?? new InMemoryMissionRepository();
    this.quotas = options.quotaRepository ?? new InMemoryQuotaRepository();
  }

  public async complete(): Promise<void> {}
  public async rollback(): Promise<void> {}
}

export interface SQLiteUnitOfWorkOptions {
  repository?: MissionRepository;
  quotaRepository?: QuotaRepository;
  database?: MissionDatabase;
}

export class SQLiteUnitOfWork implements UnitOfWork {
  public readonly missions: MissionRepository;
  public readonly quotas: QuotaRepository;
  private readonly database: MissionDatabase;
  private inTransaction = false;

  constructor(options: SQLiteUnitOfWorkOptions = {}) {
    this.database = options.database ?? getMissionDatabase();
    this.missions =
      options.repository ??
      new SQLiteMissionRepository(this.database);
    this.quotas = 
      options.quotaRepository ??
      new SQLiteQuotaRepository(this.database);
  }

  public async complete(): Promise<void> {
    if (this.inTransaction) {
      this.database.connection.prepare("COMMIT").run();
      this.inTransaction = false;
    }
  }

  public async rollback(): Promise<void> {
    if (this.inTransaction) {
      this.database.connection.prepare("ROLLBACK").run();
      this.inTransaction = false;
    }
  }

  public async participate(): Promise<void> {
    if (!this.inTransaction) {
      this.database.connection.prepare("BEGIN TRANSACTION").run();
      this.inTransaction = true;
    }
  }
}
