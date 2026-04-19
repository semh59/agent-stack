import type { AutonomyEvent } from "./autonomy-types";

/**
 * Known event types for type-safe subscriptions.
 * Wildcard ('*') handlers receive WrappedEvent.
 */
export interface EventMap {
  "agent_start": Record<string, unknown>;
  "gate_result": Record<string, unknown>;
  "budget": Record<string, unknown>;
  "budget:warning": AutonomyEvent;
  "mission.created": AutonomyEvent;
  "mission.state": AutonomyEvent;
  "mission.step": AutonomyEvent;
  "mission.model_switch": AutonomyEvent;
  "mission.gear_completed": AutonomyEvent;
  "mission.gear_failed": AutonomyEvent;
  "mission.queue": AutonomyEvent;
  "mission.gate_result": AutonomyEvent;
  "mission.gate_bypass": AutonomyEvent;
  "mission.budget": AutonomyEvent;
  "mission.artifact": AutonomyEvent;
  "mission.log": AutonomyEvent;
  "mission.diff_ready": AutonomyEvent;
  "mission.done": AutonomyEvent;
  "mission.failed": AutonomyEvent;
  "mission.stopped": AutonomyEvent;
  "mission:created": AutonomyEvent;
  "phase:started": AutonomyEvent;
  "phase:completed": AutonomyEvent;
  "gear:started": AutonomyEvent;
  "gear:completed": AutonomyEvent;
  "gear:failed": AutonomyEvent;
  "gate:passed": AutonomyEvent;
  "gate:failed": AutonomyEvent;
  "mission:completed": AutonomyEvent;
  "mission:failed": AutonomyEvent;
  "decision_log": AutonomyEvent;
  "gate_bypass": AutonomyEvent;
  "interrupted": AutonomyEvent;
  "eventbus.error": { event: string; error: unknown };
  "*": WrappedEvent;
  [key: string]: unknown; // escape hatch for dynamic events
}

export interface WrappedEvent {
  event: string;
  data: unknown;
  timestamp: string;
}

interface DeadLetter {
  event: string;
  data: unknown;
  error: unknown;
  timestamp: string;
}

type Handler<T = unknown> = (data: T) => void | Promise<void>;

export class EventBus {
  private static instance: EventBus;
  private handlers: Map<string, Set<Handler>> = new Map();
  private deadLetters: DeadLetter[] = [];
  private readonly maxDeadLetters = 100;

  private constructor() {}

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public publish<K extends keyof EventMap>(event: K & string, data: EventMap[K]): void;
  public publish(event: string, data: unknown): void;
  public publish(event: string, data: unknown): void {
    const handlersToCall = new Set<Handler>();

    const specificHandlers = this.handlers.get(event);
    if (specificHandlers) {
      specificHandlers.forEach(h => handlersToCall.add(h));
    }

    if (event !== '*') {
      const wildcardHandlers = this.handlers.get('*');
      if (wildcardHandlers) {
        const wildcardPayload: WrappedEvent = {
          event,
          data,
          timestamp: new Date().toISOString()
        };
        wildcardHandlers.forEach(h => {
          handlersToCall.add((_) => h(wildcardPayload));
        });
      }
    }

    handlersToCall.forEach(handler => {
      try {
        const result = handler(data);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error(`[EventBus] Error in async handler for ${event}:`, err);
            this.addDeadLetter(event, data, err);
            if (event !== 'eventbus.error') {
              this.publish('eventbus.error', { event, error: err });
            }
          });
        }
      } catch (err) {
        console.error(`[EventBus] Error in sync handler for ${event}:`, err);
        this.addDeadLetter(event, data, err);
      }
    });
  }

  public subscribe<K extends keyof EventMap>(event: K & string, handler: Handler<EventMap[K]>): () => void;
  public subscribe(event: string, handler: Handler): () => void;
  public subscribe(event: string, handler: Handler): () => void {
    if (typeof handler !== 'function') {
      throw new Error(`Handler must be a function`);
    }

    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const currentHandlers = this.handlers.get(event)!;
    currentHandlers.add(handler);
    
    return () => {
      const handlers = this.handlers.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(event);
        }
      }
    };
  }

  /**
   * Returns dead letters (events that failed to process).
   */
  public getDeadLetters(): readonly DeadLetter[] {
    return this.deadLetters;
  }

  /**
   * Clears the dead letter queue.
   */
  public clearDeadLetters(): void {
    this.deadLetters = [];
  }

  public clearAll(): void {
    this.handlers.clear();
  }

  public clearEvent(event: string): void {
    this.handlers.delete(event);
  }

  public getTotalSubscriberCount(): number {
    let count = 0;
    for (const subs of this.handlers.values()) {
      count += subs.size;
    }
    return count;
  }

  public getSubscriberCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  private addDeadLetter(event: string, data: unknown, error: unknown): void {
    this.deadLetters.push({
      event,
      data,
      error,
      timestamp: new Date().toISOString()
    });
    // Ring buffer: keep only the most recent entries
    if (this.deadLetters.length > this.maxDeadLetters) {
      this.deadLetters = this.deadLetters.slice(-this.maxDeadLetters);
    }
  }
}

export const eventBus = EventBus.getInstance();
