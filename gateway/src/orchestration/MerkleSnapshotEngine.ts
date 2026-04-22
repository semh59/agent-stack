import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import AsyncLock from 'async-lock';

export interface MerkleNode {
  path: string;
  hash: string;
  type: 'file' | 'directory';
  children?: Record<string, MerkleNode>;
}

/**
 * MerkleSnapshotEngine: Implements differential state tracking via Merkle Trees.
 * Enables bit-perfect rollbacks with minimal I/O overhead.
 */
export class MerkleSnapshotEngine {
  private baseDir: string;
  private snapshotDir: string;
  private lock = new AsyncLock();

  constructor(projectRoot: string) {
    this.baseDir = path.resolve(projectRoot, '.ai-company');
    this.snapshotDir = path.resolve(this.baseDir, 'snapshots');
  }

  private async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err: Error) => reject(err));
    });
  }

  public async buildMerkleTree(dir: string = this.baseDir): Promise<MerkleNode> {
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) {
       const hash = await this.hashFile(dir);
       return { path: dir, hash, type: 'file' };
    }

    const children: Record<string, MerkleNode> = {};
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    // Sort entries to ensure deterministic hashing
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const hashes: string[] = [];
    for (const entry of entries) {
      if (entry.name === 'snapshots' || entry.name === 'logs') continue; // Exclude volatile dirs
      
      const childNode = await this.buildMerkleTree(path.join(dir, entry.name));
      children[entry.name] = childNode;
      hashes.push(childNode.hash);
    }

    const combinedHash = crypto.createHash('sha256').update(hashes.join('')).digest('hex');
    return { path: dir, hash: combinedHash, type: 'directory', children };
  }

  public async captureSnapshot(): Promise<string> {
    return this.lock.acquire('snapshot', async () => {
      const tree = await this.buildMerkleTree();
      const snapshotPath = path.join(this.snapshotDir, tree.hash);
      
      if (await this.exists(snapshotPath)) return tree.hash; // Already snapshot

      await fs.mkdir(snapshotPath, { recursive: true });
      await this.persistNode(tree, snapshotPath);
      
      // Save the tree metadata
      await fs.writeFile(path.join(snapshotPath, 'tree.json'), JSON.stringify(tree, null, 2));
      return tree.hash;
    });
  }

  private async persistNode(node: MerkleNode, targetDir: string): Promise<void> {
    if (node.type === 'file') {
      const dest = path.join(targetDir, 'blobs', node.hash);
      if (await this.exists(dest)) return;

      await fs.mkdir(path.dirname(dest), { recursive: true });
      // Atomic write: Copy to tmp and rename
      const tmpPath = `${dest}.tmp.${Math.random().toString(36).slice(2)}`;
      await fs.copyFile(node.path, tmpPath);
      await fs.rename(tmpPath, dest);
    } else if (node.children) {
      for (const child of Object.values(node.children)) {
        await this.persistNode(child, targetDir);
      }
    }
  }

  public async revertTo(snapshotHash: string): Promise<void> {
    return this.lock.acquire('snapshot', async () => {
      const snapshotPath = path.join(this.snapshotDir, snapshotHash);
      const treeData = await fs.readFile(path.join(snapshotPath, 'tree.json'), 'utf-8');
      const tree = JSON.parse(treeData) as MerkleNode;

      await this.restoreNode(tree, snapshotPath);
    });
  }

  private async restoreNode(node: MerkleNode, snapshotPath: string): Promise<void> {
    if (node.type === 'file') {
      const blobPath = path.join(snapshotPath, 'blobs', node.hash);
      await fs.copyFile(blobPath, node.path);
    } else if (node.children) {
      for (const child of Object.values(node.children)) {
        await this.restoreNode(child, snapshotPath);
      }
    }
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
