import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { eventBus } from './event-bus';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  role: string;
  epoch: number;
  data: unknown;
}

/**
 * TimelineAggregator: Collects events from the EventBus and persists them to a unified log.
 * Acts as the "Black Box" for the entire agentic orchestration.
 */
export class TimelineAggregator {
  private logPath: string;
  private currentRole: string = 'system';
  private currentEpoch: number = 0;
  private isDisposed: boolean = false;
  private writeQueue: TimelineEvent[] = [];
  private isProcessing: boolean = false;
  private unsubscribe: (() => void) | null = null;

  constructor(rootDir: string, sessionId: string) {
    this.logPath = path.join(rootDir, '.ai-company', 'logs', sessionId, 'timeline.jsonl');
  }

  public async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    
    // Subscribe to all events
    this.unsubscribe = eventBus.subscribe('*', (wrapped: { event: string; data: unknown }) => {
      this.pushEvent(wrapped.event, wrapped.data);
    });
  }

  public setContext(role: string, epoch: number): void {
    this.currentRole = role;
    this.currentEpoch = epoch;
  }

  private pushEvent(type: string, data: unknown): void {
    const event: TimelineEvent = {
       id: Math.random().toString(36).slice(2),
       timestamp: new Date().toISOString(),
       type,
       role: this.currentRole,
       epoch: this.currentEpoch,
       data
    };
    
    this.writeQueue.push(event);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.writeQueue.length === 0) return;
    this.isProcessing = true;

    while (this.writeQueue.length > 0) {
      const event = this.writeQueue.shift()!;
      try {
        const payload = this.safeStringify(event);
        await fs.appendFile(this.logPath, payload + '\n', 'utf-8');
      } catch (err) {
        console.error('[TimelineAggregator] Failed to write event:', err);
      }
    }

    this.isProcessing = false;
  }

  private safeStringify(obj: unknown): string {
    const cache = new Set<object>();
    return JSON.stringify(obj, (key, value: unknown) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value as object)) return `[Circular]`;
        cache.add(value as object);
      }
      return value;
    });
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // Clear queue to free memory
    this.writeQueue = [];
  }
}
