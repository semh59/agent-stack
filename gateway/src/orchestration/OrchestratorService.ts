import { eventBus } from "./event-bus";
import { AutonomousLoopEngine } from "./autonomous-loop-engine";
import type { SequentialPipeline } from "./sequential-pipeline";

import type { AlloyGatewayClient } from "./gateway-client";

import { SharedMemory } from "./shared-memory";

import type { 
  AutonomySession, 
  CreateAutonomySessionRequest, 
  AutonomyEvent 
} from "./autonomy-types";


/**
 * OrchestratorService: The central coordinator for Alloy autonomous missions and pipelines.
 * 
 * Implements the "Global State Controller" pattern, ensuring synchronization between
 * autonomous missions, task pipelines, and the frontend store.
 * 
 * Pattern: router â†’ service â†’ engine/manager
 */
export class OrchestratorService {
  private static instance: OrchestratorService;
  private autonomyEngine: AutonomousLoopEngine;
  private pipelines: Map<string, SequentialPipeline> = new Map();
  private subscriptions: Array<() => void> = [];
  private engineDispose: { dispose: () => void } | null = null;
  private sharedMemory: SharedMemory;


  private constructor(
    projectRoot: string, 
    client?: AlloyGatewayClient
  ) {

    this.sharedMemory = new SharedMemory(projectRoot);
    this.autonomyEngine = new AutonomousLoopEngine({ projectRoot, client });

    
    // Listen to autonomy events and broadcast them globally
    this.engineDispose = this.autonomyEngine.onEvent((event) => {
      this.handleAutonomyEvent(event);
    });

    // Listen to the global event bus for pipeline events
    this.subscriptions.push(
      eventBus.subscribe("agent_start", (data) => this.syncPipelineWithMission("agent_start", data)),
      eventBus.subscribe("mission.gate_result", (data: AutonomyEvent) => this.handleGateEvent(data)),
      eventBus.subscribe("mission.budget", (data: AutonomyEvent) => this.handleBudgetLimit(data)),
    );
  }

  public static getInstance(
    projectRoot: string, 
    client?: AlloyGatewayClient
  ): OrchestratorService {

    if (!OrchestratorService.instance) {
      OrchestratorService.instance = new OrchestratorService(projectRoot, client);
    }
    return OrchestratorService.instance;
  }

  /**
   * Start a new autonomous mission (Mission Control)
   */
  public createMission(request: CreateAutonomySessionRequest): AutonomySession {
    return this.autonomyEngine.create(request);
  }

  public runMission(sessionId: string): boolean {
    return this.autonomyEngine.runExistingInBackground(sessionId);
  }

  /**
   * Disposes all subscriptions. Call in tests or shutdown.
   */
  public dispose(): void {
    for (const unsub of this.subscriptions) unsub();
    this.subscriptions = [];
    this.engineDispose?.dispose();
    this.engineDispose = null;
  }

  /**
   * Handle events from the Autonomy Engine.
   * Publishes to the global event bus for cross-module consumption.
   */
  private handleAutonomyEvent(event: AutonomyEvent): void {
    eventBus.publish(`mission.${event.type}`, event);
  }

  /**
   * Sync Pipeline events with Mission state
   */
  private syncPipelineWithMission(type: string, data: Record<string, unknown>): void {
    console.debug(`[Orchestrator] Syncing ${type}:`, data);
  }

  /**
   * Handle gate failure events â€” halt affected pipelines.
   */
  private handleGateEvent(event: AutonomyEvent): void {
    if (event.payload.passed === false) {
      console.warn(`[Orchestrator] Gate failed for session ${event.sessionId}. Halting pipelines.`);
      this.haltAffectedPipelines(event.sessionId, "Quality Gate Failed");
    }
  }

  /**
   * Handle budget limit events â€” emit warning notifications and leave hard-stop
   * ownership to the engine so missions fail instead of being marked as stopped.
   */
  private handleBudgetLimit(event: AutonomyEvent): void {
    if (event.payload.warning === true) {
      const reason = String(event.payload.warningReason ?? "Budget warning");
      console.warn(`[Orchestrator] Budget warning for session ${event.sessionId}: ${reason}`);
      eventBus.publish("budget:warning", event);
    }

    if (event.payload.exceeded === true) {
      const reason = String(event.payload.exceedReason ?? "Budget exceeded");
      console.warn(`[Orchestrator] Budget hard stop for session ${event.sessionId}: ${reason}`);
    }
  }

  private haltAffectedPipelines(sessionId: string, reason: string): void {
    console.warn(`[Orchestrator] Halting pipelines for session ${sessionId}. Reason: ${reason}`);
  }

  /**
   * Pipeline Operations
   */
  public getPipeline(id: string): SequentialPipeline | undefined {
    return this.pipelines.get(id);
  }

  public getSharedMemory(): SharedMemory {
    return this.sharedMemory;
  }
}


export const orchestratorService = (
  projectRoot: string, 
  client?: AlloyGatewayClient
) => OrchestratorService.getInstance(projectRoot, client);

