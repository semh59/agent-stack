import * as fs from 'node:fs/promises';
import { type TimelineEvent } from './TimelineAggregator';

/**
 * ContextProjector: Transforms raw timeline events into a human-readable historical summary.
 * Allows agents to "see" what happened in the system since their last turn.
 */
export class ContextProjector {
  /**
   * Summarize recent events from a JSONL timeline file.
   */
  public static async projectRecentActivity(
    logPath: string, 
    maxEvents: number = 20
  ): Promise<string> {
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      const recentLines = lines.slice(-maxEvents);
      
      const events: TimelineEvent[] = recentLines.map(l => JSON.parse(l));
      
      if (events.length === 0) return 'No recent activity recorded.';

      const summaryLines: string[] = [];
      
      // Group by type for a cleaner summary
      const fsChanges = events.filter(e => e.type.startsWith('fs:'));
      const termResults = events.filter(e => e.type === 'terminal:result');
      
      if (fsChanges.length > 0) {
        summaryLines.push(`### Filesystem Activity:`);
        fsChanges.forEach(e => {
          const data = e.data as { path: string };
          summaryLines.push(`- [${e.role.toUpperCase()}] ${e.type.split(':')[1]} -> ${data.path}`);
        });
      }

      if (termResults.length > 0) {
        summaryLines.push(`\n### Command Activity:`);
        termResults.forEach(e => {
          const data = e.data as { command: string; success: boolean; durationMs: number };
          summaryLines.push(`- [${e.role.toUpperCase()}] "${data.command}" -> ${data.success ? '🏆 OK' : '❌ FAIL'} (${data.durationMs}ms)`);
        });
      }

      return summaryLines.join('\n');
    } catch {
      return 'No historical context available.';
    }
  }
}
