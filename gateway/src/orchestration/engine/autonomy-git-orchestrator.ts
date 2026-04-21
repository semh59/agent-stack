import type { AutonomySession } from "../autonomy-types";
import { AutonomyGitManager } from "../autonomy-git-manager";

export class AutonomyGitOrchestrator {
  constructor(private readonly gitManager: AutonomyGitManager) {}

  public async prepareGit(session: AutonomySession, emit: (msg: string) => void): Promise<void> {
    if (session.gitMode !== "auto_branch_commit") return;
    if (session.branchName && session.baseBranch) return;

    const isRepo = await this.gitManager.isGitRepository();
    if (!isRepo) {
      throw new Error("Git repository not found; auto branch/commit cannot run");
    }

    const dirtyFiles = await this.gitManager.getDirtyFiles();
    session.baselineDirtyFiles = dirtyFiles;
    const baseBranch = await this.gitManager.getCurrentBranch();
    if (!baseBranch) {
      throw new Error("Unable to detect current base branch for autonomy session");
    }
    session.baseBranch = baseBranch;
    if (!session.branchName) {
      session.branchName = await this.gitManager.createSessionBranch(session.id, baseBranch);
    }
    emit(`Created session branch ${session.branchName} from ${baseBranch}`);
  }

  public async findWorkspaceConflict(session: AutonomySession): Promise<string[]> {
    const currentDirty = await this.gitManager.getDirtyFiles();
    const normalize = (f: string) => f.replace(/\\/g, "/");
    
    const baseline = new Set(session.baselineDirtyFiles.map(normalize));
    const touched = new Set(session.touchedFiles.map(normalize));
    const conflicts: string[] = [];

    for (const file of currentDirty.map(normalize)) {
      const nFile = normalize(file);
      if (touched.has(nFile) && baseline.has(nFile)) {
        conflicts.push(file);
        continue;
      }
      if (!touched.has(nFile) && !baseline.has(nFile)) {
        conflicts.push(file);
      }
    }

    return [...new Set(conflicts)];
  }

  public async commitSession(session: AutonomySession): Promise<{ commitHash?: string; message: string }> {
    const gateCommands = session.artifacts.gateResult
      ? session.artifacts.gateResult.commands.map((item) => item.command)
      : [];

    const commit = await this.gitManager.commitSession({
      sessionId: session.id,
      objective: session.objective,
      modelPolicy: session.modelPolicy,
      gateCommands,
      touchedFiles: session.touchedFiles,
    });

    session.commitHash = commit.commitHash;
    return {
      commitHash: commit.commitHash,
      message: commit.commitHash
        ? `Committed session changes: ${commit.commitHash}`
        : "No commit created (no file changes)",
    };
  }

  public async exportPatch(session: AutonomySession): Promise<string | null> {
    const gateCommands = session.artifacts.gateResult
      ? session.artifacts.gateResult.commands.map((item) => item.command)
      : [];
    
    return this.gitManager.exportPatch({
      sessionId: session.id,
      objective: session.objective,
      modelPolicy: session.modelPolicy,
      gateCommands,
      touchedFiles: session.touchedFiles,
    });
  }

  public async cleanupFailedSessionBranch(session: AutonomySession): Promise<{ cleaned: boolean; reason?: string }> {
    if (session.gitMode !== "auto_branch_commit" || !session.branchName || !session.baseBranch || session.commitHash) {
      return { cleaned: false, reason: "Ineligible for cleanup" };
    }

    return this.gitManager.cleanupFailedSessionBranch(
      session.branchName,
      session.baseBranch,
    );
  }
}
