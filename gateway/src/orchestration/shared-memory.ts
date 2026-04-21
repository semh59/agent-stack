import * as fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import AsyncLock from 'async-lock';
import { AGENTS } from './agents';

/**
 * Pipeline state stored in .ai-company/state.json
 */
export interface PipelineState {
  userTask: string;
  techStack: string;
  architecture: string;
  dbSchema: string;
  apiContracts: string;
  designSystem: string;
  authStrategy: string;
  filesCreated: string[];
  testsPassed: string[];
  knownIssues: string[];
  deploymentConfig: string;
  pipelineStatus: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'halted';
  currentAgent: string | null;
  completedAgents: string[];
  startedAt: string | null;
  completedAt: string | null;

  // â”€â”€ Alloyty Extensions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Verification results per agent */
  verificationResults?: Record<string, {
    passed: boolean;
    commands: string[];
    timestamp: string;
  }>;

  /** Backtrack history */
  backtrackHistory?: Array<{
    from: string;
    to: string;
    reason: string;
    timestamp: string;
  }>;

  /** Agent-level metrics */
  agentMetrics?: Record<string, {
    attempts: number;
    totalDurationMs: number;
    verificationPassed: boolean;
  }>;

  /** RARV engine state per task */
  rarvState?: Record<number, unknown>;
  
  /** RARV aggregate metrics */
  rarvMetrics?: {
    totalCycles: number;
    successfulCycles: number;
    failedCycles: number;
    averageRefinements: number;
    averageDurationMs: number;
  };
  
  /** Persistent cumulative token usage */
  cumulativeTokens?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

export interface TimelineEntry {
  agent: string;
  file: string;
  timestamp: string;
  sizeBytes: number;
}

const DEFAULT_STATE: PipelineState = {
  userTask: '',
  techStack: '',
  architecture: '',
  dbSchema: '',
  apiContracts: '',
  designSystem: '',
  authStrategy: '',
  filesCreated: [],
  testsPassed: [],
  knownIssues: [],
  deploymentConfig: '',
  pipelineStatus: 'idle',
  currentAgent: null,
  completedAgents: [],
  startedAt: null,
  completedAt: null,
  verificationResults: {},
  backtrackHistory: [],
  agentMetrics: {},
};

const LOCK_OPTIONS = {
  stale: 10000,
  retries: {
    retries: 15,
    minTimeout: 100,
    maxTimeout: 1000,
    factor: 1.5,
  },
};

/**
 * SharedMemory: File-based shared state for the sequential pipeline.
 * All agent outputs are stored under `.ai-company/` in the project root.
 */
export class SharedMemory {
  protected rootDir: string;
  private stateFile: string;
  private writeMutex = new AsyncLock();

  constructor(projectRoot: string) {
    this.rootDir = path.resolve(projectRoot, '.ai-company');
    this.stateFile = path.join(this.rootDir, 'state.json');
  }

  /**
   * Initialize the .ai-company/ directory and state file.
   * Safe to call multiple times â€” won't overwrite existing state.
   */
  public async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });

    try {
      await fs.access(this.stateFile);
      // State file exists, don't overwrite
    } catch {
      // State file doesn't exist, create with defaults
      await this.writeState(DEFAULT_STATE);
    }
  }

  /**
   * Get the current pipeline state.
   * If calling from outside a lock, this might return slightly stale data if another process is writing.
   */
  public async getState(): Promise<PipelineState> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf-8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      // If file doesn't exist, return defaults but don't create it here
      return { ...DEFAULT_STATE };
    }
  }

  /**
   * Update the pipeline state atomically (partial merge).
   * Entire read-modify-write cycle is protected by a cross-process lock.
   */
  /**
   * Update the pipeline state atomically (partial merge).
   * Entire read-modify-write cycle is protected by a cross-process lock.
   */
  public async updateState(partial: Partial<PipelineState>): Promise<PipelineState> {
    return this.writeMutex.acquire('state-update', async () => {
      const start = Date.now();
      // 1. Ensure root directory exists (idempotent)
      await fs.mkdir(this.rootDir, { recursive: true });

      // 2. Ensure state file exists before locking (otherwise lockfile fails)
      try {
        await fs.access(this.stateFile);
      } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
          await this.writeState(DEFAULT_STATE);
        } else {
          throw e;
        }
      }

      let release: (() => Promise<void>) | undefined;
      const lockFile = `${this.stateFile}.lock`;
      // Ensure lock file exists
      try { await fs.writeFile(lockFile, '', { flag: 'wx' }); } catch { /* ignore if exists */ }

      try {
        release = await lockfile.lock(lockFile, LOCK_OPTIONS);
      } catch (err) {
        console.error('[SharedMemory] Failed to acquire lock for state update:', err);
        throw new Error(`Pipeline state is persistently locked. Please resolve manually.`);
      }

      try {
        // 3. Read CURRENT state while inside the lock
        let current: PipelineState;
        try {
          const raw = await fs.readFile(this.stateFile, 'utf-8');
          current = { ...DEFAULT_STATE, ...JSON.parse(raw) };
        } catch (err: unknown) {
          if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            current = { ...DEFAULT_STATE };
            await this.writeState(current);
          } else {
            // Corrupted data. Backup and reset to survive OOM/JSON crashes.
            const corruptedPath = `${this.stateFile}.corrupted.${Date.now()}`;
            try { await fs.copyFile(this.stateFile, corruptedPath); } catch { /* ignore */ }
            console.error(`[SharedMemory] CRITICAL STATE CORRUPTION. Backup saved to ${corruptedPath}. Pipeline state reset.`);
            current = { ...DEFAULT_STATE };
          }
        }

        // 4. Atomic Merge Strategy
        const updated: PipelineState = {
          ...current,
          ...partial,
          // Arrays: Merge + Unique + Filter Empty
          filesCreated: partial.filesCreated
            ? Array.from(new Set([...current.filesCreated, ...partial.filesCreated])).filter(Boolean)
            : current.filesCreated,
          testsPassed: partial.testsPassed
            ? Array.from(new Set([...current.testsPassed, ...partial.testsPassed])).filter(Boolean)
            : current.testsPassed,
          knownIssues: partial.knownIssues
            ? Array.from(new Set([...current.knownIssues, ...partial.knownIssues])).filter(Boolean)
            : current.knownIssues,
          completedAgents: partial.completedAgents
            ? Array.from(new Set([...current.completedAgents, ...partial.completedAgents])).filter(Boolean)
            : current.completedAgents,
          
          // Nested Objects: Deep merge for metrics and results
          verificationResults: {
            ...current.verificationResults,
            ...partial.verificationResults,
          },
          agentMetrics: {
            ...current.agentMetrics,
            ...partial.agentMetrics,
          },
          backtrackHistory: partial.backtrackHistory 
            ? [...(current.backtrackHistory ?? []), ...partial.backtrackHistory]
            : current.backtrackHistory,
          cumulativeTokens: partial.cumulativeTokens
            ? {
                promptTokens: (current.cumulativeTokens?.promptTokens ?? 0) + (partial.cumulativeTokens.promptTokens ?? 0),
                completionTokens: (current.cumulativeTokens?.completionTokens ?? 0) + (partial.cumulativeTokens.completionTokens ?? 0),
                totalTokens: (current.cumulativeTokens?.totalTokens ?? 0) + (partial.cumulativeTokens.totalTokens ?? 0),
                estimatedCostUsd: (current.cumulativeTokens?.estimatedCostUsd ?? 0) + (partial.cumulativeTokens.estimatedCostUsd ?? 0),
              }
            : current.cumulativeTokens,
        };

        await this.writeState(updated);
        const duration = Date.now() - start;
        if (duration > 1000) {
          console.warn(`[SharedMemory] Slow state update detected: ${duration}ms`);
        }
        return updated;
      } finally {
        if (release) await release();
      }
    });
  }

  /**
   * Append a log entry to the physical evidence log.
   */
  public async appendLog(agent: string, content: string): Promise<void> {
    return this.writeMutex.acquire('log-append', async () => {
      const logPath = path.join(this.rootDir, 'verification.log');
      const timestamp = new Date().toISOString();
      const entry = `[${timestamp}] [${agent.toUpperCase()}] ${content}\n`;
      await fs.appendFile(logPath, entry, 'utf-8');
    });
  }

  /**
   * Read the last N lines of the physical evidence log.
   */
  public async readLogTail(lines: number = 20): Promise<string> {
    const logPath = path.join(this.rootDir, 'verification.log');
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const allLines = content.split('\n').filter(l => l.trim().length > 0);
      return allLines.slice(-lines).join('\n');
    } catch {
      return 'No physical evidence found yet.';
    }
  }

  /**
   * Write an agent's output file(s) to .ai-company/
   * Supports multi-file extraction using "@file: path/to/file" headers in code blocks.
   */
  public async writeAgentOutput(
    agentRole: string,
    defaultFilename: string,
    content: string
  ): Promise<string[]> {
    return this.writeMutex.acquire('output-write', async () => {
      const writtenFiles: string[] = [];
      
      // Pattern: @file: path/any/where.ext
      const fileRegex = /@file:\s*([\w\-./\\]+)\n([\s\S]*?)(?=\n@file:|$)/g;
      let match;
      let foundMultiFile = false;

      while ((match = fileRegex.exec(content)) !== null) {
        foundMultiFile = true;
        const filePath = match[1]!.trim();
        const fileContent = match[2]!.trim();
        
        // Ensure nested directories exist
        const fullPath = path.join(this.rootDir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        
        await fs.writeFile(fullPath, fileContent, 'utf-8');
        writtenFiles.push(filePath);
        console.log(`[SharedMemory] ${agentRole} extracted â†’ ${filePath} (${Buffer.byteLength(fileContent)} bytes)`);
      }

      // Fallback: If no @file markers, write whole thing to default filename
      if (!foundMultiFile) {
        const fullPath = path.join(this.rootDir, defaultFilename);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content.trim(), 'utf-8');
        writtenFiles.push(defaultFilename);
        console.log(`[SharedMemory] ${agentRole} wrote (legacy) â†’ ${defaultFilename} (${Buffer.byteLength(content)} bytes)`);
      }

      return writtenFiles;
    });
  }

  /**
   * Read an agent's output file from .ai-company/
   * Returns null if the file doesn't exist.
   */
  public async readAgentOutput(filename: string): Promise<string | null> {
    if (!filename) return null;
    try {
      const filePath = path.join(this.rootDir, filename);
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Read multiple agent output files. Missing files are skipped.
   */
  public async readMultipleOutputs(filenames: string[]): Promise<Record<string, string>> {
    const results: Record<string, string> = {};

    for (const filename of filenames) {
      const content = await this.readAgentOutput(filename);
      if (content !== null) {
        results[filename] = content;
      }
    }

    return results;
  }

  /**
   * Get a timeline of all agent outputs (chronological).
   */
  public async getTimeline(): Promise<TimelineEntry[]> {
    const entries: TimelineEntry[] = [];

    try {
      const files = await fs.readdir(this.rootDir);

      for (const file of files) {
        if (file === 'state.json') continue;
        const filePath = path.join(this.rootDir, file);
        const stat = await fs.stat(filePath);

        if (stat.isFile()) {
          entries.push({
            agent: this.inferAgentFromFile(file),
            file,
            timestamp: stat.mtime.toISOString(),
            sizeBytes: stat.size,
          });
        }
      }
    } catch {
      // Directory might not exist yet
    }

    return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Reset the pipeline state to defaults (preserves existing output files).
   */
  public async reset(): Promise<void> {
    await this.writeState(DEFAULT_STATE);
    console.log('[SharedMemory] State reset to defaults');
  }

  /**
   * Clean all outputs: delete everything in .ai-company/ and reset state.
   */
  public async clean(): Promise<void> {
    // Ensure state file exists to lock it
    await this.init();

    const lockFile = `${this.stateFile}.lock`;
    try { await fs.writeFile(lockFile, '', { flag: 'wx' }); } catch { /* ignore */ }
    
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(lockFile, LOCK_OPTIONS);
    } catch (err) {
      console.error('[SharedMemory] Failed to acquire lock for clean:', err);
      throw new Error(`Cannot clean state while it is locked by another process.`);
    }

    try {
      const files = await fs.readdir(this.rootDir);
      for (const file of files) {
        if (file === 'state.json') continue; // Don't delete the file we are locking on
        const fullPath = path.join(this.rootDir, file);
        await fs.rm(fullPath, { recursive: true, force: true });
      }
      // Reset the state file content while still locked
      await this.writeState(DEFAULT_STATE);
    } catch (err) {
      console.error('[SharedMemory] Error during clean:', err);
      throw err;
    } finally {
      await release();
    }
    console.log('[SharedMemory] All outputs and subdirectories cleaned');
  }

  /** Get the root directory path. */
  public getRootDir(): string {
    return this.rootDir;
  }

  // â”€â”€ Private â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async writeState(state: PipelineState): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    
    // Phase 5.1 Fix: Atomic writing to prevent JSON corruption during power loss/OOM
    const content = JSON.stringify(state, null, 2);
    const tmpFile = `${this.stateFile}.tmp.${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmpFile, content, 'utf-8');
    await fs.rename(tmpFile, this.stateFile);
  }

  /**
   * Infer agent role from output filename using the AGENTS registry.
   */
  private inferAgentFromFile(filename: string): string {
    const agent = AGENTS.find(a => a.outputFiles.includes(filename));
    return agent ? agent.role : 'unknown';
  }
}
