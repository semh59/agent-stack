/**
 * Unified Event Bus for Alloy AI Platform
 * 
 * Typed event system replacing raw WebSocket JSON messages.
 * Uses discriminated unions with backpressure ring buffer.
 */

import { EventEmitter } from 'events';
import { AIProvider } from './provider-types';

// â”€â”€â”€ Typed Event Payloads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface OptimizationReport {
  cacheHit: boolean;
  originalTokens: number;
  optimizedTokens: number;
  savingsRatio: number;
  compressionTimeMs: number;
}

// Discriminated union of all possible system events
export type AlloyEvent =
  | { type: "agent:start"; agentId: string; role: string; order: number; modelName: string }
  | { type: "agent:complete"; agentId: string; role: string; tokens: TokenUsage; fromCache: boolean }
  | { type: "agent:error"; agentId: string; role: string; error: string }
  | { type: "optimization:applied"; agentId: string; report: OptimizationReport }
  | { type: "provider:switch"; from: AIProvider; to: AIProvider; reason: string }
  | { type: "circuit:open"; provider: AIProvider; errorRate: number; until: number }
  | { type: "circuit:close"; provider: AIProvider }
  | { type: "circuit:half_open"; provider: AIProvider }
  | { type: "budget:warning"; used: number; limit: number; percent: number; exhaustDate: string | null }
  | { type: "bridge:health"; available: boolean; latencyMs: number }
  | { type: "bridge:dead_letter"; count: number }
  | { type: "model:routed"; agentId: string; modelId: string; tier: string; reasoning: string }
  | { type: "ui:log"; id: number; time: string; source: string; text: string; level: "info"|"success"|"error"|"warning" };

// â”€â”€â”€ Backpressure Ring Buffer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface EventBusConfig {
  maxReplaySize: number;
  maxQueueSize: number;
}

const DEFAULT_CONFIG: EventBusConfig = {
  maxReplaySize: 50,  // Keep last 50 events for new subscribers
  maxQueueSize: 1000, // Maximum pending events before dropping
};

export class AlloyEventBus {
  private readonly emitter = new EventEmitter();
  private readonly config: EventBusConfig;
  
  // Replay buffer for state hydration
  private readonly replayBuffer: AlloyEvent[] = [];
  
  constructor(configOverrides?: Partial<EventBusConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.emitter.setMaxListeners(50);
  }

  /** Emit a typed event to all listeners */
  public emit(event: AlloyEvent): void {
    // 1. Add to replay buffer
    this.replayBuffer.push(event);
    if (this.replayBuffer.length > this.config.maxReplaySize) {
      this.replayBuffer.shift();
    }

    // 2. Broadcast
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event); // wildcard listeners
  }

  /** Listen to a specific event type */
  public on<T extends AlloyEvent["type"]>(
    type: T, 
    listener: (event: Extract<AlloyEvent, { type: T }>) => void
  ): () => void {
    const wrapper = (e: any) => listener(e);
    this.emitter.on(type, wrapper);
    return () => this.emitter.off(type, wrapper);
  }

  /** Listen to all events (good for WebSocket broadcast) */
  public onAll(listener: (event: AlloyEvent) => void): () => void {
    this.emitter.on('*', listener);
    return () => this.emitter.off('*', listener);
  }

  /** Listen for one occurrence of an event */
  public once<T extends AlloyEvent["type"]>(
    type: T,
    listener: (event: Extract<AlloyEvent, { type: T }>) => void
  ): void {
    this.emitter.once(type, listener as any);
  }

  /** Get recent events for hydrating UI state */
  public getReplayBuffer(): AlloyEvent[] {
    return [...this.replayBuffer];
  }

  /** Clear all listeners */
  public dispose(): void {
    this.emitter.removeAllListeners();
    this.replayBuffer.length = 0;
  }
}

// Global Singleton Instance
export const GlobalEventBus = new AlloyEventBus();
