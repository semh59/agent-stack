import * as fs from 'node:fs/promises';
import path from 'node:path';
import * as crypto from 'node:crypto';

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
  setApprovalHandler(handler: (req: ApprovalRequest) => Promise<boolean>): void;
  requestApproval?(action: string): Promise<boolean>;
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

  public async requestApproval(action: string): Promise<boolean> {
    if (this.onApprovalRequired) {
      const id = crypto.randomUUID();
      return await this.onApprovalRequired({ id, action });
    }
    return true;
  }

  public async readFile(filePath: string): Promise<ToolResult> {
    try {
      const absolutePath = await this.resolvePath(filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      return { success: true, output: content };
    } catch (err: any) {
      return { success: false, output: `Error reading file: ${err.message}` };
    }
  }

  public async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      if (!(await this.requestApproval(`Write file: ${filePath}`))) {
        return { success: false, output: 'Action rejected by user.' };
      }
      const absolutePath = await this.resolvePath(filePath);
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      return { success: true, output: `File written successfully: ${filePath}` };
    } catch (err: any) {
      return { success: false, output: `Error writing file: ${err.message}` };
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
    } catch (err: any) {
      return { success: false, output: `Error listing files: ${err.message}` };
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
      // File doesn't exist yet â€” verify parent is inside workspace
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
        } catch (err: any) {
          if (err.message?.startsWith('SECURITY_BLOCK')) throw err;
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
