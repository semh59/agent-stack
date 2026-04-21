import path from "node:path";
import { spawn } from "node:child_process";

interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommitSessionInput {
  sessionId: string;
  objective: string;
  modelPolicy: string;
  gateCommands: string[];
  touchedFiles: string[];
}

export interface CommitSessionResult {
  commitHash: string | null;
  committedFiles: string[];
}

export interface FailedBranchCleanupResult {
  cleaned: boolean;
  reason: string;
}

export class AutonomyGitManager {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public async isGitRepository(): Promise<boolean> {
    const result = await this.runGit(["rev-parse", "--is-inside-work-tree"]);
    return result.ok && result.stdout.trim() === "true";
  }

  public async getDirtyFiles(): Promise<string[]> {
    const result = await this.runGit(["status", "--porcelain"]);
    if (!result.ok) return [];

    const files = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(3).trim())
      .filter((line) => line.length > 0);

    return [...new Set(files)];
  }

  public async getCurrentBranch(): Promise<string | null> {
    const result = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!result.ok) return null;
    const branch = result.stdout.trim();
    if (!branch || branch === "HEAD") {
      return null;
    }
    return branch;
  }

  public async createSessionBranch(
    sessionId: string,
    baseBranch?: string,
  ): Promise<string> {
    const branchName = buildAutonomyBranchName(sessionId);

    if (baseBranch) {
      const checkoutBase = await this.runGit(["checkout", baseBranch]);
      if (!checkoutBase.ok) {
        throw new Error(
          `Failed to checkout base branch ${baseBranch}: ${checkoutBase.stderr || checkoutBase.stdout}`,
        );
      }
    }

    const checkoutResult = await this.runGit(["checkout", "-b", branchName]);
    if (!checkoutResult.ok) {
      throw new Error(`Failed to create branch ${branchName}: ${checkoutResult.stderr || checkoutResult.stdout}`);
    }

    return branchName;
  }

  public async cleanupFailedSessionBranch(
    branchName: string,
    baseBranch: string,
  ): Promise<FailedBranchCleanupResult> {
    const normalizedBranch = branchName.trim();
    if (!normalizedBranch) {
      return { cleaned: false, reason: "branch name is empty" };
    }

    const exists = await this.branchExists(normalizedBranch);
    if (!exists) {
      return { cleaned: false, reason: `branch ${normalizedBranch} does not exist` };
    }

    const current = await this.getCurrentBranch();
    if (current === normalizedBranch) {
      const checkoutBase = await this.runGit(["checkout", baseBranch]);
      if (!checkoutBase.ok) {
        return {
          cleaned: false,
          reason: `failed to checkout base branch ${baseBranch}: ${checkoutBase.stderr || checkoutBase.stdout}`,
        };
      }
    }

    const deleteResult = await this.runGit(["branch", "-D", normalizedBranch]);
    if (!deleteResult.ok) {
      return {
        cleaned: false,
        reason: deleteResult.stderr || deleteResult.stdout || "git branch -D failed",
      };
    }

    return { cleaned: true, reason: "deleted" };
  }

  public async commitSession(input: CommitSessionInput): Promise<CommitSessionResult> {
    const files = normalizeFiles(input.touchedFiles);
    if (files.length === 0) {
      return { commitHash: null, committedFiles: [] };
    }

    const addResult = await this.runGit(["add", "--", ...files]);
    if (!addResult.ok) {
      throw new Error(`git add failed: ${addResult.stderr || addResult.stdout}`);
    }

    const title = buildAutonomyCommitTitle(input.objective);
    const body = [
      `Session: ${input.sessionId}`,
      `Model Policy: ${input.modelPolicy}`,
      `Gate Commands: ${input.gateCommands.join(", ")}`,
      `Touched Files: ${files.join(", ")}`,
    ].join("\n");

    const commitResult = await this.runGit(["commit", "-m", title, "-m", body]);
    if (!commitResult.ok) {
      const message = `${commitResult.stderr}\n${commitResult.stdout}`.toLowerCase();
      if (message.includes("nothing to commit")) {
        return { commitHash: null, committedFiles: [] };
      }
      throw new Error(`git commit failed: ${commitResult.stderr || commitResult.stdout}`);
    }

    const hashResult = await this.runGit(["rev-parse", "HEAD"]);
    if (!hashResult.ok) {
      throw new Error(`git rev-parse failed: ${hashResult.stderr || hashResult.stdout}`);
    }

    return {
      commitHash: hashResult.stdout.trim() || null,
      committedFiles: files,
    };
  }

  public async exportPatch(input: CommitSessionInput): Promise<string> {
    if (!(await this.isGitRepository())) return "";
    const files = normalizeFiles(input.touchedFiles);
    if (files.length === 0) return "";

    // Check if HEAD exists. If not, diff against the empty tree hash.
    const hasHead = await this.runGit(["rev-parse", "HEAD"]);
    const base = hasHead.ok ? "HEAD" : "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

    const diffResult = await this.runGit(["diff", base, "--", ...files]);
    if (!diffResult.ok) {
      // Final fallback to just 'git diff' which might work for unstaged changes in some environments
      const simpleDiff = await this.runGit(["diff", "--", ...files]);
      if (simpleDiff.ok) return simpleDiff.stdout;
      
      throw new Error(`git diff failed: ${diffResult.stderr || diffResult.stdout}`);
    }

    return diffResult.stdout;
  }


  private async runGit(args: string[]): Promise<GitCommandResult> {
    return new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd: this.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error: Error) => {
        resolve({
          ok: false,
          stdout,
          stderr: error.message || stderr,
          exitCode: -1,
        });
      });

      child.on("close", (exitCode) => {
        resolve({
          ok: exitCode === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? 1,
        });
      });
    });
  }

  private async branchExists(branchName: string): Promise<boolean> {
    const result = await this.runGit(["branch", "--list", branchName]);
    if (!result.ok) return false;
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/^\*?\s*/, "").trim())
      .some((line) => line === branchName);
  }
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truncateTitle(objective: string): string {
  const compact = objective.replace(/\s+/g, " ").trim();
  if (compact.length <= 64) return compact;
  return `${compact.slice(0, 61)}...`;
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.filter((file) => file.trim().length > 0).map((file) => file.replace(/\\/g, "/")))];
}

export function buildAutonomyBranchName(sessionId: string): string {
  return `auto_branch/${sessionId}`;
}

export function buildAutonomyCommitTitle(objective: string): string {
  return `feat(autonomy): ${truncateTitle(objective)}`;
}
