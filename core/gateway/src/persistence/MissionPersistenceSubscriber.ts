import crypto from "node:crypto";
import { MissionFactory } from "../models/mission-factory";
import type { MissionRepository } from "../repositories/mission.repository";
import type { AutonomyEvent, AutonomySession } from "../orchestration/autonomy-types";

export interface MissionPersistenceSubscriberOptions {
  getSession: (sessionId: string) => AutonomySession | null;
  logger?: Pick<Console, "warn" | "error">;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }

  return value;
}

function eventHash(event: AutonomyEvent): string {
  const normalized = JSON.stringify(canonicalize(event.payload));
  return crypto
    .createHash("sha256")
    .update(`${event.sessionId}:${event.type}:${event.timestamp}:${normalized}`)
    .digest("hex");
}

export class MissionPersistenceSubscriber {
  private readonly logger: Pick<Console, "warn" | "error">;

  constructor(
    private readonly repository: MissionRepository,
    private readonly options: MissionPersistenceSubscriberOptions,
  ) {
    this.logger = options.logger ?? console;
  }

  public async handleEvent(event: AutonomyEvent): Promise<void> {
    try {
      const session = this.options.getSession(event.sessionId);
      if (session) {
        await this.ensureMission(session);
      }

      const hash = eventHash(event);
      await this.repository.saveEvent(event.sessionId, event, {
        eventHash: hash,
        type: `mission.${event.type}`,
      });

      if (!session) {
        return;
      }

      await this.repository.saveRuntimeSnapshot(event.sessionId, session);

      if (event.type === "gate_result" && session.artifacts.gateResult) {
        await this.repository.saveGateResult(event.sessionId, session.artifacts.gateResult, {
          eventHash: hash,
          phase: session.state,
          createdAt: event.timestamp,
        });
      }

      if (event.type === "budget") {
        await this.repository.saveBudgetSnapshot(event.sessionId, session.budgets, {
          eventHash: hash,
          createdAt: event.timestamp,
        });
      }

      const mission = MissionFactory.fromSession(session);
      const existing = await this.repository.findById(event.sessionId);
      if (!existing) {
        await this.repository.create(mission);
      } else {
        await this.repository.update(event.sessionId, mission);
      }
    } catch (error) {
      this.logger.error?.(
        `[MissionPersistenceSubscriber] Failed to persist autonomy event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async ensureMission(session: AutonomySession): Promise<void> {
    const existing = await this.repository.findById(session.id);
    if (existing) {
      return;
    }

    await this.repository.create(MissionFactory.fromSession(session));
  }
}
