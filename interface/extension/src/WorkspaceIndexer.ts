import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GlobalEventBus } from '../../../core/gateway/src/gateway/event-bus';

interface IndexRequest {
  uri: vscode.Uri;
  content: string;
  priority: number;
}

export class WorkspaceIndexer implements vscode.Disposable {
  private readonly hashCache = new Map<string, string>();
  private readonly indexQueue: IndexRequest[] = [];
  
  private watcher: vscode.FileSystemWatcher;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  constructor(private readonly port: number = 9100) {
    // Watch relevant text/code files
    this.watcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{ts,js,py,md,json,html,css}"
    );

    this.watcher.onDidChange(uri => this.onFileChanged(uri));
    this.watcher.onDidCreate(uri => this.onFileChanged(uri));
    this.watcher.onDidDelete(uri => this.hashCache.delete(uri.fsPath));

    // Listen to active editor changes to boost priority
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        void this.onFileChanged(editor.document.uri);
      }
    });

    GlobalEventBus.emit({
      type: "ui:log",
      id: Date.now(),
      time: new Date().toISOString(),
      source: "WorkspaceIndexer",
      text: "Workspace Context RAG Indexer listening for changes",
      level: "info"
    });
  }

  public async onFileChanged(uri: vscode.Uri): Promise<void> {
    try {
      // Phase 3.2 Fix: Prevent RAG memory explosion
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > 1024 * 1024) return; // Skip files > 1MB

      const contentBuffer = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBuffer).toString('utf-8');
      
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (this.hashCache.get(uri.fsPath) === hash) {
        return; // No change
      }
      
      this.hashCache.set(uri.fsPath, hash);

      // Higher priority for currently active file
      const isActive = vscode.window.activeTextEditor?.document.uri.fsPath === uri.fsPath;
      const priority = isActive ? 0 : 1;

      this.indexQueue.push({ uri, content, priority });
      this.indexQueue.sort((a, b) => a.priority - b.priority); // priority queue

      // OOM Hard-capping: Drop lowest priority files if flooded
      if (this.indexQueue.length > 500) {
        this.indexQueue.length = 500;
      }

      this.scheduleFlush();
    } catch {
      // Ignore read errors for deleted/locked files
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    // Debounce flush to batch operations
    this.flushTimer = setTimeout(() => void this.flushQueue(), 1000);
  }

  private async flushQueue() {
    if (this.isProcessing || this.indexQueue.length === 0) return;
    this.isProcessing = true;

    try {
      // Take up to 10 files
      const batch = this.indexQueue.splice(0, 10);
      const payload = batch.map(req => ({
        path: req.uri.fsPath,
        content: req.content
      }));

      // Send to Bridge RAG endpoint
      const response = await fetch(`http://127.0.0.1:${this.port}/rag/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload })
      });

      if (!response.ok) {
        // If it failed, put them back
        this.indexQueue.unshift(...batch);
      }
    } catch {
      // Bridge might be down
    } finally {
      this.isProcessing = false;
      if (this.indexQueue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  public dispose() {
    this.watcher.dispose();
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }
}
