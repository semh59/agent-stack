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
exports.MerkleSnapshotEngine = void 0;
const fs = __importStar(require("node:fs/promises"));
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const async_lock_1 = __importDefault(require("async-lock"));
/**
 * MerkleSnapshotEngine: Implements differential state tracking via Merkle Trees.
 * Enables bit-perfect rollbacks with minimal I/O overhead.
 */
class MerkleSnapshotEngine {
    baseDir;
    snapshotDir;
    lock = new async_lock_1.default();
    constructor(projectRoot) {
        this.baseDir = path.resolve(projectRoot, '.ai-company');
        this.snapshotDir = path.resolve(this.baseDir, 'snapshots');
    }
    async hashFile(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = (0, node_fs_1.createReadStream)(filePath);
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', (err) => reject(err));
        });
    }
    async buildMerkleTree(dir = this.baseDir) {
        const stats = await fs.stat(dir);
        if (!stats.isDirectory()) {
            const hash = await this.hashFile(dir);
            return { path: dir, hash, type: 'file' };
        }
        const children = {};
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Sort entries to ensure deterministic hashing
        entries.sort((a, b) => a.name.localeCompare(b.name));
        const hashes = [];
        for (const entry of entries) {
            if (entry.name === 'snapshots' || entry.name === 'logs')
                continue; // Exclude volatile dirs
            const childNode = await this.buildMerkleTree(path.join(dir, entry.name));
            children[entry.name] = childNode;
            hashes.push(childNode.hash);
        }
        const combinedHash = crypto.createHash('sha256').update(hashes.join('')).digest('hex');
        return { path: dir, hash: combinedHash, type: 'directory', children };
    }
    async captureSnapshot() {
        return this.lock.acquire('snapshot', async () => {
            const tree = await this.buildMerkleTree();
            const snapshotPath = path.join(this.snapshotDir, tree.hash);
            if (await this.exists(snapshotPath))
                return tree.hash; // Already snapshot
            await fs.mkdir(snapshotPath, { recursive: true });
            await this.persistNode(tree, snapshotPath);
            // Save the tree metadata
            await fs.writeFile(path.join(snapshotPath, 'tree.json'), JSON.stringify(tree, null, 2));
            return tree.hash;
        });
    }
    async persistNode(node, targetDir) {
        if (node.type === 'file') {
            const dest = path.join(targetDir, 'blobs', node.hash);
            if (await this.exists(dest))
                return;
            await fs.mkdir(path.dirname(dest), { recursive: true });
            // Atomic write: Copy to tmp and rename
            const tmpPath = `${dest}.tmp.${Math.random().toString(36).slice(2)}`;
            await fs.copyFile(node.path, tmpPath);
            await fs.rename(tmpPath, dest);
        }
        else if (node.children) {
            for (const child of Object.values(node.children)) {
                await this.persistNode(child, targetDir);
            }
        }
    }
    async revertTo(snapshotHash) {
        return this.lock.acquire('snapshot', async () => {
            const snapshotPath = path.join(this.snapshotDir, snapshotHash);
            const treeData = await fs.readFile(path.join(snapshotPath, 'tree.json'), 'utf-8');
            const tree = JSON.parse(treeData);
            await this.restoreNode(tree, snapshotPath);
        });
    }
    async restoreNode(node, snapshotPath) {
        if (node.type === 'file') {
            const blobPath = path.join(snapshotPath, 'blobs', node.hash);
            await fs.copyFile(blobPath, node.path);
        }
        else if (node.children) {
            for (const child of Object.values(node.children)) {
                await this.restoreNode(child, snapshotPath);
            }
        }
    }
    async exists(p) {
        try {
            await fs.access(p);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.MerkleSnapshotEngine = MerkleSnapshotEngine;
//# sourceMappingURL=MerkleSnapshotEngine.js.map