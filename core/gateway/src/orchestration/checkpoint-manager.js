"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointManager = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const async_lock_1 = __importDefault(require("async-lock"));
/**
 * CheckpointManager: Provides Git-based "Undo" capability for agent actions.
 * Takes a snapshot before destructive operations.
 */
class CheckpointManager {
    projectRoot;
    terminal;
    lock = new async_lock_1.default();
    constructor(projectRoot, terminal) {
        this.projectRoot = projectRoot;
        this.terminal = terminal;
    }
    /**
     * Create a checkpoint using git stash or shadow copy.
     */
    async createCheckpoint(label) {
        return this.lock.acquire('checkpoint', async () => {
            const now = new Date();
            const timestamp = now.toISOString().replace(/[:.]/g, '-');
            const id = `checkpoint_${timestamp}`;
            const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
            try {
                // Check if git is initialized
                const gitCheck = await this.terminal.run('git rev-parse --is-inside-work-tree');
                if (gitCheck.success) {
                    // Create a stash with a specific message
                    const stashResult = await this.terminal.run(`git stash push -u -m "${id}_${safeLabel}"`);
                    // Critical check: Git returns success: true even if "No local changes to save"
                    if (!stashResult.success || stashResult.stdout.includes('No local changes to save') || stashResult.stdout.includes('No local changes')) {
                        console.log(`[Checkpoint] No local changes for "${label}", creating virtual empty checkpoint`);
                        return `${id}_empty`;
                    }
                    return id;
                }
                else {
                    // Fallback to shadow copy if no git
                    const shadowDir = path.join(this.projectRoot, '.ai-company', 'shadow', id);
                    await fs.mkdir(shadowDir, { recursive: true });
                    await this.copyRecursive(this.projectRoot, shadowDir, ['node_modules', '.git', '.ai-company']);
                    return `${id}_no_git`;
                }
            }
            catch (err) {
                console.error(`[Checkpoint] Failed to create: ${err}`);
                return 'failed';
            }
        });
    }
    /**
     * Rollback to a specific checkpoint.
     */
    async rollback(checkpointId) {
        return this.lock.acquire('checkpoint', async () => {
            try {
                if (checkpointId === 'failed')
                    return false;
                if (checkpointId.endsWith('_empty')) {
                    console.log(`[Checkpoint] Bypassing rollback for empty checkpoint: ${checkpointId}`);
                    return true; // Virtual success
                }
                if (checkpointId.includes('_no_git')) {
                    const id = checkpointId.split('_no_git')[0];
                    const shadowDir = path.join(this.projectRoot, '.ai-company', 'shadow', id);
                    if (await fs.stat(shadowDir).catch(() => null)) {
                        process.stdout.write(`[Checkpoint] Restoring from shadow copy: ${id}... `);
                        await this.copyRecursive(shadowDir, this.projectRoot);
                        // Cleanup shadow
                        await fs.rm(shadowDir, { recursive: true, force: true });
                        return true;
                    }
                    return false;
                }
                const list = await this.terminal.run('git stash list');
                if (list.success && list.stdout.includes(checkpointId)) {
                    // Find index and pop
                    const lines = list.stdout.split('\n');
                    const index = lines.findIndex(l => l.includes(checkpointId));
                    if (index !== -1) {
                        await this.terminal.run(`git stash pop stash@{${index}}`);
                        return true;
                    }
                }
                return false;
            }
            catch (err) {
                console.error(`[Checkpoint] Rollback failure: ${err}`);
                return false;
            }
        });
    }
    /**
     * Rollback only specific files from a checkpoint.
     * Useful for partial undos without affecting unrelated changes.
     */
    async rollbackFiles(checkpointId, filePaths) {
        return this.lock.acquire('checkpoint', async () => {
            try {
                if (checkpointId === 'failed' || checkpointId.endsWith('_empty'))
                    return false;
                if (checkpointId.includes('_no_git')) {
                    const id = checkpointId.split('_no_git')[0];
                    const shadowDir = path.join(this.projectRoot, '.ai-company', 'shadow', id);
                    if (!(await fs.stat(shadowDir).catch(() => null)))
                        return false;
                    for (const fp of filePaths) {
                        const srcFile = path.join(shadowDir, fp);
                        const destFile = path.join(this.projectRoot, fp);
                        if (await fs.stat(srcFile).catch(() => null)) {
                            await fs.mkdir(path.dirname(destFile), { recursive: true });
                            await fs.copyFile(srcFile, destFile);
                        }
                    }
                    return true;
                }
                // For git-based checkpoints: stash pop into a temp branch, copy files, then revert
                const list = await this.terminal.run('git stash list');
                if (!list.success || !list.stdout.includes(checkpointId))
                    return false;
                const lines = list.stdout.split('\n');
                const stashIndex = lines.findIndex(l => l.includes(checkpointId));
                if (stashIndex === -1)
                    return false;
                // Checkout specific files from the stash
                for (const fp of filePaths) {
                    await this.terminal.run(`git checkout stash@{${stashIndex}} -- ${fp}`).catch(() => { });
                }
                return true;
            }
            catch (err) {
                console.error(`[Checkpoint] Partial rollback failure: ${err}`);
                return false;
            }
        });
    }
    /**
     * Get metadata about a checkpoint.
     */
    async getCheckpointInfo(checkpointId) {
        const info = {
            id: checkpointId,
            exists: false,
            type: 'unknown',
            label: '',
            timestamp: null,
        };
        if (checkpointId === 'failed') {
            return { ...info, type: 'failed' };
        }
        if (checkpointId.endsWith('_empty')) {
            return { ...info, type: 'empty', exists: true };
        }
        if (checkpointId.includes('_no_git')) {
            const id = checkpointId.split('_no_git')[0];
            const shadowDir = path.join(this.projectRoot, '.ai-company', 'shadow', id);
            const stat = await fs.stat(shadowDir).catch(() => null);
            return {
                ...info,
                type: 'shadow',
                exists: !!stat,
                timestamp: id.replace('checkpoint_', '').replace(/-/g, (m, i) => i === 10 ? 'T' : i > 10 ? ':' : m),
            };
        }
        // Git stash checkpoint
        const list = await this.terminal.run('git stash list');
        if (list.success && list.stdout.includes(checkpointId)) {
            return { ...info, type: 'git', exists: true };
        }
        return info;
    }
    /**
     * Prune old shadow-copy checkpoints to free disk space.
     * Only removes shadow copies older than maxAgeMs.
     */
    async pruneOldCheckpoints(maxCount = 10) {
        const shadowBase = path.join(this.projectRoot, '.ai-company', 'shadow');
        const stat = await fs.stat(shadowBase).catch(() => null);
        if (!stat)
            return 0;
        const entries = await fs.readdir(shadowBase);
        if (entries.length <= maxCount)
            return 0;
        // Sort by name (contains timestamp) ascending â€” oldest first
        const sorted = entries.sort();
        const toRemove = sorted.slice(0, sorted.length - maxCount);
        let removed = 0;
        for (const entry of toRemove) {
            const fullPath = path.join(shadowBase, entry);
            await fs.rm(fullPath, { recursive: true, force: true }).catch(() => { });
            removed++;
        }
        console.log(`[Checkpoint] Pruned ${removed} old shadow checkpoints`);
        return removed;
    }
    async copyRecursive(src, dest, excludes = []) {
        const entries = await fs.readdir(src, { withFileTypes: true });
        await fs.mkdir(dest, { recursive: true });
        for (const entry of entries) {
            if (excludes.includes(entry.name))
                continue;
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                await this.copyRecursive(srcPath, destPath, excludes);
            }
            else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }
}
exports.CheckpointManager = CheckpointManager;
//# sourceMappingURL=checkpoint-manager.js.map