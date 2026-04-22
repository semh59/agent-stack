import { Project } from 'ts-morph';
import * as path from 'node:path';
import type { ISlashCommand, SlashCommandContext, SlashCommandResult } from './SlashCommandRegistry';
import { DiscoveryAgent } from '../discovery-agent';

/**
 * DeepPlanningCommand: Performs a high-fidelity codebase analysis.
 * Uses real AST parsing via ts-morph to identify high-centrality files.
 */
export class DeepPlanningCommand implements ISlashCommand {
  public name = 'deep-planning';
  public description = 'Performs a recursive AST-based semantic analysis to identify core architecture and dependencies.';

  private readonly discovery = new DiscoveryAgent();

  public async execute(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
    const root = context.projectRoot;
    
    // 1. Initial Discovery
    const map = await this.discovery.discover(root);
    
    // 2. AST-Based Semantic Weighting
    const fileWeights = new Map<string, number>();
    const project = new Project();
    
    // Scan src files specifically
    const srcFiles = map.components.filter(f => f.startsWith('src/') || f.includes('/src/'));
    const limit = Math.min(srcFiles.length, 100); // 100 is a much better sample size than 30
    
    for (const relativePath of srcFiles.slice(0, limit)) {
      try {
        const fullPath = path.resolve(root, relativePath);
        const sourceFile = project.addSourceFileAtPath(fullPath);
        
        // Analyze imports properly
        const imports = sourceFile.getImportDeclarations();
        for (const imp of imports) {
          const moduleSpecifier = imp.getModuleSpecifierValue();
          const resolvedName = this.resolveImport(relativePath, moduleSpecifier);
          fileWeights.set(resolvedName, (fileWeights.get(resolvedName) || 0) + 1);
        }
        
        // Analyze export dependencies (optional but helpful)
        const exports = sourceFile.getExportDeclarations();
        for (const exp of exports) {
          const moduleSpecifier = exp.getModuleSpecifierValue();
          if (moduleSpecifier) {
            const resolvedName = this.resolveImport(relativePath, moduleSpecifier);
            fileWeights.set(resolvedName, (fileWeights.get(resolvedName) || 0) + 1);
          }
        }
        
        // Cleanup memory for each file
        project.removeSourceFile(sourceFile);
      } catch {
        // Skip inaccessible or non-TS files
      }
    }

    // 3. Identify High-Centrality Files
    const sortedFileWeights = Array.from(fileWeights.entries())
      .filter(([name]) => !name.startsWith('node:')) // Exclude built-ins
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    const highValueFiles = sortedFileWeights.map(([file, weight]) => `- **${file}** (Citations: ${weight})`);

    // 4. Generate implementation_plan.md structure
    const plan = `
# Deep Planning Report (Reality-Anchored)
Generated for session: ${context.sessionId}

## Architectural Centrality Analysis
The following nodes are most cited in the codebase (Citational Authority):
${highValueFiles.join('\n') || 'No major central nodes detected in the sample.'}

## Technical Stack Discovery
- **Platform Architecture:** ${map.techStack.join(' | ')}
- **Primary Entrance:** ${map.entryPoints.join(', ')}
- **Structural Density:** ${map.complexity === 'high' ? 'Dense / High Capacity' : 'Standard / Low Density'}

## Strategic Hardening Path
Based on the citational authority of the nodes identified above, security and stability efforts should prioritize the hardening of **${sortedFileWeights[0]?.[0] || 'core services'}** to ensure systemic resilience.
`.trim();

    return {
      success: true,
      message: 'Deep planning (AST) complete. Citational analysis generated.',
      artifacts: {
        'deep_planning_ast.md': plan
      }
    };
  }

  private resolveImport(sourceFile: string, importPath: string): string {
    if (importPath.startsWith('.')) {
      const dir = path.dirname(sourceFile);
      const absPath = path.posix.join(dir, importPath);
      return path.posix.normalize(absPath);
    }
    return importPath;
  }
}

