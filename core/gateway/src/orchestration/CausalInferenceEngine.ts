import * as fs from 'node:fs/promises';
import type { TimelineEvent } from './TimelineAggregator';

export interface CausalLink {
  cause: TimelineEvent;
  effect: TimelineEvent;
  confidence: number;
  reason: string;
}

/**
 * CausalInferenceEngine: Detects latent regressions by analyzing the timeline log.
 * Attributes current failures to past agent modifications.
 */
export class CausalInferenceEngine {
  constructor(private timelinePath: string) {}

  public async analyzeFailure(failureEvent: TimelineEvent): Promise<CausalLink[]> {
    const events = await this.loadTimeline();
    const failureTime = new Date(failureEvent.timestamp).getTime();
    
    // Look for edits to the same components in the last 100 events
    const candidates = events
      .filter(e => new Date(e.timestamp).getTime() < failureTime)
      .filter(e => e.type === 'fs_change' || e.type === 'agent_action')
      .slice(-100);

    const links: CausalLink[] = [];
    const targetFiles = this.extractTargetFiles(failureEvent);

    for (const cause of candidates) {
      const causeFiles = this.extractTargetFiles(cause);
      const overlap = causeFiles.filter(f => targetFiles.includes(f));

      if (overlap.length > 0) {
        links.push({
          cause,
          effect: failureEvent,
          confidence: this.calculateConfidence(cause, overlap),
          reason: `Modified shared sectors: ${overlap.join(', ')}`
        });
      }
    }

    return links.sort((a, b) => b.confidence - a.confidence);
  }

  private async loadTimeline(): Promise<TimelineEvent[]> {
    try {
      const data = await fs.readFile(this.timelinePath, 'utf-8');
      return data.trim().split('\n').map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  private extractTargetFiles(event: TimelineEvent): string[] {
    const data = event.data as Record<string, unknown> | null | undefined;
    if (event.type === 'fs_change' && typeof data?.path === 'string') return [data.path];
    if (event.type === 'terminal_output' && typeof data?.command === 'string') {
       // Simple heuristic: extract file names from test commands
       const matches = data.command.match(/[\w-]+\.\w+/g);
       return matches || [];
    }
    return [];
  }

  private calculateConfidence(cause: TimelineEvent, overlap: string[]): number {
    let score = 0.5;
    if (cause.role === 'architect' || cause.role === 'pm') score += 0.2;
    if (overlap.length > 2) score += 0.2;
    return Math.min(0.99, score);
  }
}
