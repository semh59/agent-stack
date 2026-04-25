import * as fs from 'node:fs/promises';
import path from 'node:path';
import * as crypto from 'node:crypto';
import { autonomyPolicyEngine } from './policy/AutonomyPolicyEngine';

/**
 * Result of a tool operation.
 */
export interface ToolResult {
  success: boolean;
  output: string;
  diff?: string;
}

/**
 * Approval request for HITL (Human-In-The-Loop) operations.
 */
export interface ApprovalRequest {
  id: string;
  action: string;
}

/**
 * IToolExecutionEngine: Interface for file operations used by the pipeline.
 * Decouples orchestration from VSCode runtime â€” can be implemented
 * by standalone Node.js or VSCode extension.
 */
export interface IToolExecutionEngine {
  readFile(filePath: string): Promise<ToolResult>;
  writeFile(filePath: string, content: string): Promise<ToolResult>;
  listFiles(dirPath: string): Promise<ToolResult>;
  runCommand(command: string): Promise<ToolResult>;
  setApprovalHandler(handler: (req: ApprovalRequest) => Promise<boolean>): void;
  requestApproval?(action: string, context?: { 
    toolName: string; 
    args: Record<string, unknown>; 
    confidence: number; 
    filePath?: string; 
    command?: string; 
  }): Promise<boolean>;
}

/**
 * StandaloneToolExecutionEngine: Node.js-only implementation.
 * Uses fs/promises â€” no VSCode dependency.
 * Includes realpath traversal protection.
 */
export class StandaloneToolExecutionEngine implements IToolExecutionEngine {
  private onApprovalRequired?: (request: ApprovalRequest) => Promise<boolean>;

  constructor(private readonly projectRoot: string) {}

  public setApprovalHandler(handler: (req: ApprovalRequest) => Promise<boolean>): void {
    this.onApprovalRequired = handler;
  }

  public async requestApproval(action: string, context?: { 
    toolName: string; 
    args: Record<string, unknown>; 
    confidence: number; 
    filePath?: string; 
    command?: string; 
  }): Promise<boolean> {
    // Proactive Policy Check
    const violations = autonomyPolicyEngine.evaluate({
      toolName: context?.toolName ?? 'unknown',
      args: context?.args ?? {},
      confidence: context?.confidence ?? 1.0,
      filePath: context?.filePath,
      command: context?.command,
    });

    const needsPause = violations.some(v => v.action === 'PAUSE');
    const isBlocked = violations.some(v => v.action === 'BLOCK');

    if (isBlocked) {
      throw new Error(`POLICY_BLOCK: ${violations.find(v => v.action === 'BLOCK')?.reason}`);
    }

    if (needsPause || this.onApprovalRequired) {
      if (this.onApprovalRequired) {
        const id = crypto.randomUUID();
        const reason = violations.map(v => v.reason).join('; ');
        return await this.onApprovalRequired({ id, action: reason || action });
      }
      // If no handler but needs pause, we must fail (conservative safety)
      if (needsPause) {
        throw new Error(`POLICY_PAUSE: Manual approval required but no handler registered. ${violations[0]?.reason}`);
      }
    }
    return true;
  }

  public async readFile(filePath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolvePath(filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      return { success: true, output: content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Error reading file: ${msg}` };
    }
  }

  public async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      if (!(await this.requestApproval(`Write file: ${filePath}`, {
        toolName: 'write_to_file',
        filePath,
        args: { content },
        confidence: 1.0
      }))) {
        return { success: false, output: 'Action rejected by user.' };
      }
      const absolutePath = await this.resolvePath(filePath);
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      return { success: true, output: `File written successfully: ${filePath}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Error writing file: ${msg}` };
    }
  }

  public async listFiles(dirPath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolvePath(dirPath);
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      const output = entries
        .map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
        .join('\n');
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Error listing files: ${msg}` };
    }
  }

  public async runCommand(command: string): Promise<ToolResult> {
    try {
      if (!(await this.requestApproval(`Run command: ${command}`, { 
        toolName: 'run_command', 
        command,
        args: {},
        confidence: 1.0 
      }))) {
        return { success: false, output: 'Command rejected by user.' };
      }
      return { success: true, output: 'Command approved' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Policy Error: ${msg}` };
    }
  }

  /**
   * Resolve path with realpath traversal protection.
   */
  private async resolvePath(relativePath: string): Promise<string> {
    const rootReal = await fs.realpath(this.projectRoot);
    const targetPath = path.resolve(this.projectRoot, relativePath);

    let targetReal: string | null = null;
    try {
      targetReal = await fs.realpath(targetPath);
    } catch {
      // File doesn't exist yet — verify parent is inside workspace
      let current = targetPath;
      while (current !== path.dirname(current)) {
        const parent = path.dirname(current);
        try {
          const parentReal = await fs.realpath(parent);
          const isInside = parentReal.startsWith(rootReal + path.sep) || parentReal === rootReal;
          if (!isInside) {
            throw new Error(`SECURITY_BLOCK: Path "${relativePath}" resolves outside the workspace`);
          }
          return targetPath;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.startsWith('SECURITY_BLOCK')) throw err;
          current = parent;
        }
      }
      throw new Error(`SECURITY_BLOCK: Path "${relativePath}" resolves outside the workspace`);
    }

    const isInside = targetReal.startsWith(rootReal + path.sep) || targetReal === rootReal;
    if (!isInside) {
      throw new Error(`SECURITY_BLOCK: Path traversal attempt detected for "${relativePath}"`);
    }
    return targetReal;
  }
}
