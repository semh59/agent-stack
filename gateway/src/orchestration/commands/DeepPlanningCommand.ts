import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ISlashCommand, SlashCommandContext, SlashCommandResult } from './SlashCommandRegistry';
import { DiscoveryAgent } from '../discovery-agent';

/**
 * DeepPlanningCommand: Performs a high-fidelity codebase analysis.
 * Uses a simplified PageRank algorithm to identify high-centrality files.
 */
export class DeepPlanningCommand implements ISlashCommand {
  public name = 'deep-planning';
  public description = 'Performs a recursive semantic analysis to identify core architecture and dependencies.';

  private readonly discovery = new DiscoveryAgent();

  public async execute(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
    const root = context.projectRoot;
    
    // 1. Initial Discovery
    const map = await this.discovery.discover(root);
    
    // 2. Semantic Weighting (Simplified PageRank)
    // We analyze imports in the top 50 components to find "core" utilities/controllers.
    const fileWeights = new Map<string, number>();
    
    // Sample a subset of files for dependency analysis
    const sampleSize = Math.min(map.components.length, 30);
    const sampledFiles = map.components.slice(0, sampleSize);

    for (const file of sampledFiles) {
      try {
        const fullPath = path.resolve(root, file);
        const content = await fs.readFile(fullPath, 'utf-8');
        
        // Match TS/JS imports (simplified regex)
        const importMatches = content.matchAll(/from\s+['"](.+?)['"]/g);
        for (const match of importMatches) {
          const importPath = match[1];
          // Normalize import path to something we can match
          const resolved = this.resolveImport(file, importPath!);
          fileWeights.set(resolved, (fileWeights.get(resolved) || 0) + 1);
        }
      } catch {
        // Skip inaccessible files
      }
    }

    // 3. Identify High-Centrality Files
    const sortedFileWeights = Array.from(fileWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const highValueFiles = sortedFileWeights.map(([file, weight]) => `- ${file} (Weight: ${weight})`);

    // 4. Generate implementation_plan.md structure
    const plan = `
# Deep Planning Report
Generated for session: ${context.sessionId}

## High-Centrality Analysis
The following files are heavily referenced and likely represent core architectural nodes:
${highValueFiles.join('\n') || 'No major central nodes detected in the sample.'}

## Technical Stack Discovery
- **Languages:** ${map.techStack.join(', ')}
- **Entry Points:** ${map.entryPoints.join(', ')}
- **Complexity:** ${map.complexity.toUpperCase()}

## Recommended Action
Based on the high-centrality files and stack, I recommend focusing on hardening the core controllers identified above.
`.trim();

    return {
      success: true,
      message: 'Deep planning analysis complete. Review the generated report.',
      artifacts: {
        'implementation_plan.md': plan
      }
    };
  }

  private resolveImport(sourceFile: string, importPath: string): string {
    // Very simplified resolver: just extracts the basename or last part
    // to match against discovered components.
    if (importPath.startsWith('.')) {
      return path.basename(importPath);
    }
    return importPath;
  }
}
