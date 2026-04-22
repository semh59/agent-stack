import chokidar, { FSWatcher } from 'chokidar';
import { eventBus } from './event-bus';
import * as path from 'node:path';

/**
 * FsWatcher: Monitors the project filesystem for changes and emits events to the EventBus.
 * High-performance implementation with strict exclusion rules.
 */
export class FsWatcher {
  private watcher: FSWatcher | null = null;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public start(): void {
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.projectRoot, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.ai-company/**',
        '**/dist/**',
        '**/.tmp/**',
        '**/package-lock.json'
      ],
      persistent: true,
      ignoreInitial: true,
      usePolling: true,
      interval: 100,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    this.watcher
      .on('add', (pathStr: string) => this.emit('fs:add', pathStr))
      .on('change', (pathStr: string) => this.emit('fs:change', pathStr))
      .on('unlink', (pathStr: string) => this.emit('fs:unlink', pathStr))
      .on('error', (error: unknown) => console.error(`[FsWatcher] Error:`, error));

    console.log(`[FsWatcher] Started monitoring: ${this.projectRoot}`);
  }

  private emit(event: string, pathStr: string): void {
    const relativePath = path.relative(this.projectRoot, pathStr);
    eventBus.publish(event, { 
      path: relativePath,
      timestamp: new Date().toISOString()
    });
  }

  public stop(): void {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }
}
