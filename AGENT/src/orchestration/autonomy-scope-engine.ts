import * as path from "node:path";
import {
  StandaloneToolExecutionEngine,
  type ApprovalRequest,
  type IToolExecutionEngine,
  type ToolResult,
} from "./tool-execution-engine";
import type { ScopePolicy } from "./autonomy-types";

interface ScopeValidation {
  allowed: boolean;
  absolutePath: string;
  reason?: string;
}

/**
 * Scope-limited file tool wrapper. "selected_only" is treated as a hard boundary.
 */
export class ScopedToolExecutionEngine implements IToolExecutionEngine {
  private readonly delegate: IToolExecutionEngine;
  private readonly projectRoot: string;
  private readonly allowedRoots: string[];

  constructor(projectRoot: string, scope: ScopePolicy, delegate?: IToolExecutionEngine) {
    this.projectRoot = path.resolve(projectRoot);
    this.delegate = delegate ?? new StandaloneToolExecutionEngine(this.projectRoot);
    
    // Phase 4D: Selected Only Mode Enforcement (ISSUE-10)
    if (scope.mode === "selected_only") {
      this.allowedRoots = (scope.paths ?? [])
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => path.resolve(this.projectRoot, entry))
        .map((entry) => entry.replace(/[\\/]+$/, ""))
        .filter((entry, index, arr) => arr.indexOf(entry) === index);
    } else {
      // Fallback: Allow all if not explicitly in selected_only mode
      this.allowedRoots = [this.projectRoot];
    }
  }

  public setApprovalHandler(handler: (req: ApprovalRequest) => Promise<boolean>): void {
    this.delegate.setApprovalHandler(handler);
  }

  public async readFile(filePath: string): Promise<ToolResult> {
    const validation = this.validatePath(filePath);
    if (!validation.allowed) {
      console.error(`[ScopeGuard] VIOLATION: ${validation.reason} during readFile`);
      return {
        success: false,
        output: `SCOPE_VIOLATION: ${validation.reason ?? "Path is outside selected scope"}`,
      };
    }
    return this.delegate.readFile(filePath);
  }

  public async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const validation = this.validatePath(filePath);
    if (!validation.allowed) {
      console.error(`[ScopeGuard] VIOLATION: ${validation.reason} during writeFile`);
      return {
        success: false,
        output: `SCOPE_VIOLATION: ${validation.reason ?? "Path is outside selected scope"}`,
      };
    }
    return this.delegate.writeFile(filePath, content);
  }

  public async listFiles(dirPath: string): Promise<ToolResult> {
    const validation = this.validatePath(dirPath);
    if (!validation.allowed) {
      console.error(`[ScopeGuard] VIOLATION: ${validation.reason} during listFiles`);
      return {
        success: false,
        output: `SCOPE_VIOLATION: ${validation.reason ?? "Path is outside selected scope"}`,
      };
    }
    return this.delegate.listFiles(dirPath);
  }

  private validatePath(inputPath: string): ScopeValidation {
    const normalizedInput = inputPath.trim().length > 0 ? inputPath : ".";
    const absolutePath = path.isAbsolute(normalizedInput)
      ? path.resolve(normalizedInput)
      : path.resolve(this.projectRoot, normalizedInput);

    if (this.allowedRoots.length === 0) {
      return {
        allowed: false,
        absolutePath,
        reason: "No selected scope paths were provided",
      };
    }

    const inScope = this.allowedRoots.some((allowedRoot) => this.isInside(absolutePath, allowedRoot));
    if (!inScope) {
      return {
        allowed: false,
        absolutePath,
        reason: `Path "${absolutePath}" is outside selected scope`,
      };
    }

    return { allowed: true, absolutePath };
  }

  private isInside(candidatePath: string, basePath: string): boolean {
    const normalizedBase = basePath.endsWith(path.sep) ? basePath : `${basePath}${path.sep}`;
    return candidatePath === basePath || candidatePath.startsWith(normalizedBase);
  }
}
