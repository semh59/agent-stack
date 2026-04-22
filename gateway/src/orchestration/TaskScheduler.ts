import { type AgentDefinition } from './agents';
import { DependencyGraph } from './DependencyGraph';

export interface TaskStatus {
  role: string;
  state: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
}

export interface SchedulerOptions {
  maxConcurrency?: number;
  graph?: DependencyGraph;
}

/**
 * TaskScheduler: An event-driven engine that manages parallel agent execution.
 * Decouples task lifecycle from orchestration logic to optimize for performance and scalability.
 */
export class TaskScheduler {
  private graph: DependencyGraph;
  private maxConcurrency: number;
  private activeCount: number = 0;
  private taskStatuses: Map<string, TaskStatus> = new Map();
  private queue: string[] = [];
  private graphNodes: string[] = [];
  private abortControllers: Map<string, AbortController> = new Map();
  private isAborted = false;

  constructor(options: SchedulerOptions = {}) {
    this.graph = options.graph ?? new DependencyGraph();
    this.maxConcurrency = options.maxConcurrency ?? 4;
  }

  /**
   * Initialize the scheduler with a set of agents to run.
   */
  public init(agents: AgentDefinition[]) {
    this.graphNodes = agents.map(a => a.role);
    for (const agent of agents) {
      const deps = this.graph.getDependencies(agent.role);
      const isReady = deps.every(d => !this.graphNodes.includes(d));
      
      this.taskStatuses.set(agent.role, {
        role: agent.role,
        state: isReady ? 'ready' : 'pending',
      });

      if (isReady) {
        this.queue.push(agent.role);
      }
    }
  }

  /**
   * Dispatches ready tasks while respecting concurrency limits.
   * Returns roles that should be executed.
   */
  public dispatch(): string[] {
    if (this.isAborted) return [];
    const toExecute: string[] = [];

    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const role = this.queue.shift()!;
      const status = this.taskStatuses.get(role)!;
      
      status.state = 'running';
      this.activeCount++;
      this.abortControllers.set(role, new AbortController());
      toExecute.push(role);
    }

    return toExecute;
  }

  public getSignal(role: string): AbortSignal | undefined {
    return this.abortControllers.get(role)?.signal;
  }

  public abortAll(): void {
    this.isAborted = true;
    for (const controller of this.abortControllers.values()) {
      controller.abort('Pipeline Failure');
    }
  }

  /**
   * Marks a task as completed and updates its dependents.
   */
  public complete(role: string) {
    const status = this.taskStatuses.get(role);
    if (!status) return;

    status.state = 'completed';
    this.activeCount--;

    // Proactively check dependents to reduce time complexity
    const dependents = this.graph.getDependents(role);
    for (const depRole of dependents) {
      const depStatus = this.taskStatuses.get(depRole);
      if (depStatus && depStatus.state === 'pending') {
        const allDepsMet = this.graph.getDependencies(depRole).every(d => {
          const s = this.taskStatuses.get(d);
          return !this.graphNodes.includes(d) || (s && s.state === 'completed');
        });

        if (allDepsMet) {
          depStatus.state = 'ready';
          this.queue.push(depRole);
        }
      }
    }
  }

  /**
   * Marks a task as failed.
   */
  public fail(role: string, error: string) {
    const status = this.taskStatuses.get(role);
    if (!status) return;

    status.state = 'failed';
    status.error = error;
    this.activeCount--;
  }

  /**
   * Returns true if all tasks are finished.
   */
  public isDone(): boolean {
    return Array.from(this.taskStatuses.values()).every(
      s => s.state === 'completed' || s.state === 'failed' || s.state === 'skipped'
    );
  }

  /**
   * Returns current snapshot of statuses for monitoring.
   */
  public getSnaphot(): TaskStatus[] {
    return Array.from(this.taskStatuses.values());
  }

  public getActiveCount(): number {
    return this.activeCount;
  }
}
