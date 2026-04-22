import { type AgentDefinition, AGENTS } from './agents';

export interface GraphNode {
  agent: AgentDefinition;
  dependencies: string[]; // List of agent roles
  dependents: string[];   // List of agent roles that depend on this one
}

export interface ParallelLevel {
  level: number;
  agents: AgentDefinition[];
}

/**
 * DependencyGraph: Manages agent relationships and calculates parallel execution levels.
 * Uses topological sorting (Kahn's Algorithm variant) for efficient scheduling.
 */
export class DependencyGraph {
  private nodes: Map<string, GraphNode> = new Map();

  constructor(agents: AgentDefinition[] = AGENTS) {
    this.buildGraph(agents);
  }

  /**
   * Build the graph based on inputFiles and explicit backtrackTargets.
   * Time Complexity: O(Agents * Files)
   */
  private buildGraph(agents: AgentDefinition[]) {
    // 1. Create mapping of output file -> producing agent role
    const fileToAgent = new Map<string, string>();
    for (const agent of agents) {
      for (const file of agent.outputFiles) {
        fileToAgent.set(file, agent.role);
      }
    }

    // 2. Initialize nodes
    for (const agent of agents) {
      this.nodes.set(agent.role, {
        agent,
        dependencies: [],
        dependents: [],
      });
    }

    // 3. Resolve dependencies
    for (const agent of agents) {
      const node = this.nodes.get(agent.role)!;
      const deps = new Set<string>();

      // File-based dependencies
      for (const file of agent.inputFiles) {
        const producer = fileToAgent.get(file);
        if (producer && producer !== agent.role) {
          deps.add(producer);
        }
      }

      // Explicit role-based ordering (if order is strictly enforced)
      // For legacy compatibility, we might assume agents with lower order are potential dependencies
      // but for "High Performance", we only care about ACTUAL functional dependencies (files).
      
      // Add dependencies to node
      node.dependencies = Array.from(deps);

      // Link dependents
      for (const depRole of deps) {
        const depNode = this.nodes.get(depRole);
        if (depNode) {
          depNode.dependents.push(agent.role);
        }
      }
    }
  }

  /**
   * Get Parallel Levels using Kahn's Algorithm variant.
   * Nodes at the same level have no dependencies between them and can run in parallel.
   * Time Complexity: O(V + E)
   */
  public getParallelLevels(): ParallelLevel[] {
    const levels: ParallelLevel[] = [];
    const inDegrees = new Map<string, number>();
    const nodeQueue: string[] = [];

    // Initialize in-degrees
    for (const [role, node] of this.nodes) {
      inDegrees.set(role, node.dependencies.length);
      if (node.dependencies.length === 0) {
        nodeQueue.push(role);
      }
    }

    let currentLevel = 0;
    while (nodeQueue.length > 0) {
      const currentLevelAgents: AgentDefinition[] = [];
      const batchSize = nodeQueue.length;

      // Process all nodes currently in queue (all have in-degree 0)
      for (let i = 0; i < batchSize; i++) {
        const role = nodeQueue.shift()!;
        const node = this.nodes.get(role)!;
        currentLevelAgents.push(node.agent);

        // Reduce in-degree of dependents
        for (const dependentRole of node.dependents) {
          const currentInDegree = inDegrees.get(dependentRole)! - 1;
          inDegrees.set(dependentRole, currentInDegree);
          if (currentInDegree === 0) {
            nodeQueue.push(dependentRole);
          }
        }
      }

      if (currentLevelAgents.length > 0) {
        levels.push({
          level: currentLevel++,
          agents: currentLevelAgents.sort((a, b) => a.order - b.order),
        });
      }
    }

    // Cycle detection check
    const totalProcessed = levels.reduce((sum, lvl) => sum + lvl.agents.length, 0);
    if (totalProcessed !== this.nodes.size) {
      throw new Error(`Circular dependency detected in Agent Graph! Processed ${totalProcessed} of ${this.nodes.size} nodes.`);
    }

    return levels;
  }

  /**
   * Get all dependency roles for a specific agent.
   */
  public getDependencies(role: string): string[] {
    return this.nodes.get(role)?.dependencies ?? [];
  }

  /**
   * Get all agent roles that depend on this one.
   */
  public getDependents(role: string): string[] {
    return this.nodes.get(role)?.dependents ?? [];
  }

  /**
   * Check if agent A depends on agent B (directly or indirectly).
   */
  public dependsOn(a: string, b: string): boolean {
    const node = this.nodes.get(a);
    if (!node) return false;
    
    if (node.dependencies.includes(b)) return true;
    
    for (const dep of node.dependencies) {
      if (this.dependsOn(dep, b)) return true;
    }
    
    return false;
  }
}
