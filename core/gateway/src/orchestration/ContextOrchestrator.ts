import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ActiveTask {
  id: string;
  name: string;
  status: 'planning' | 'executing' | 'verifying' | 'completed';
  startTime: string;
  subTasks: Array<{ name: string; status: string }>;
}

export interface ADR {
  id: string;
  timestamp: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated';
  context: string;
  decision: string;
  consequences: string;
}

/**
 * ContextOrchestrator: Manages the Alloy Context Protocol (.context/).
 * Provides agents with spatially-aware long-term memory and ADR persistence.
 */
export class ContextOrchestrator {
  private contextDir: string;

  constructor(projectRoot: string) {
    this.contextDir = path.resolve(projectRoot, '.context');
  }

  public async init(): Promise<void> {
    await fs.mkdir(this.contextDir, { recursive: true });
  }

  /**
   * hydrateActiveTask: Updates the current execution state in .context.
   */
  public async hydrateActiveTask(task: ActiveTask): Promise<void> {
    const taskPath = path.join(this.contextDir, 'active_task.json');
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2), 'utf-8');
  }

  /**
   * recordADR: Persists an Architectural Decision Record to the append-only ledger.
   */
  public async recordADR(adr: ADR): Promise<void> {
    const adrPath = path.join(this.contextDir, 'adr.jsonl');
    const entry = JSON.stringify(adr) + '\n';
    await fs.appendFile(adrPath, entry, 'utf-8');
  }

  /**
   * getContextSnapshot: Returns a summary of all active context for agent injection.
   */
  public async getContextSnapshot(): Promise<Record<string, unknown>> {
    const snapshot: Record<string, unknown> = {};
    
    try {
      const taskData = await fs.readFile(path.join(this.contextDir, 'active_task.json'), 'utf-8');
      snapshot.activeTask = JSON.parse(taskData);
    } catch {
      snapshot.activeTask = null;
    }

    try {
      const adrData = await fs.readFile(path.join(this.contextDir, 'adr.jsonl'), 'utf-8');
      snapshot.recentDecisions = adrData.trim().split('\n').map(l => JSON.parse(l)).slice(-5);
    } catch {
      snapshot.recentDecisions = [];
    }

    return snapshot;
  }
}
