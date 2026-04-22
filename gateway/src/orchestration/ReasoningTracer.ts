import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ReasoningTrace {
  file: string;
  range: { startLine: number, endLine: number };
  intent: string;
  alternativesConsidered: string[];
}

/**
 * ReasoningTracer: Captures the "Why" behind agent generated content.
 * Links specific artifact lines to hidden agent reasoning.
 */
export class ReasoningTracer {
  private baseDir: string;

  constructor(projectRoot: string) {
    this.baseDir = path.resolve(projectRoot, '.ai-company', 'reasoning');
  }

  public async trace(file: string, startLine: number, endLine: number, intent: string, alternatives: string[] = []): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    
    // Hash based indexing
    const tracePath = path.join(this.baseDir, `${path.basename(file)}.traces.json`);
    
    let traces: ReasoningTrace[] = [];
    try {
      const data = await fs.readFile(tracePath, 'utf-8');
      traces = JSON.parse(data);
    } catch {}

    traces.push({
      file,
      range: { startLine, endLine },
      intent,
      alternativesConsidered: alternatives
    });

    await fs.writeFile(tracePath, JSON.stringify(traces, null, 2), 'utf-8');
  }

  public async getReasoningForLine(file: string, line: number): Promise<ReasoningTrace | null> {
    const tracePath = path.join(this.baseDir, `${path.basename(file)}.traces.json`);
    try {
      const data = await fs.readFile(tracePath, 'utf-8');
      const traces: ReasoningTrace[] = JSON.parse(data);
      return traces.find(t => line >= t.range.startLine && line <= t.range.endLine) || null;
    } catch {
      return null;
    }
  }

  public async clearTraces(file: string): Promise<void> {
    const tracePath = path.join(this.baseDir, `${path.basename(file)}.traces.json`);
    await fs.rm(tracePath, { force: true });
  }
}
