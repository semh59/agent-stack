import crypto from "node:crypto";
import type { 
  TaskNode, 
  TaskNodeType, 
  TaskNodeStatus 
} from "./autonomy-types";

/**
 * TaskGraphManager: Handles creation and status tracking of autonomy tasks.
 */
export class TaskGraphManager {
  /**
   * Initializes a standard task graph for a mission.
   */
  public createDefaultGraph(maxAttempts: number): TaskNode[] {
    const createNode = (type: TaskNodeType, status: TaskNodeStatus = "pending"): TaskNode => ({
      id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      status,
      attempts: 0,
      maxAttempts,
      updatedAt: new Date().toISOString(),
    });

    return [
      createNode("analysis", "pending"),
      createNode("implementation", "pending"),
      createNode("refactor", "skipped"),
      createNode("test-fix", "skipped"),
      createNode("verification", "pending"),
      createNode("finalize", "pending"),
    ];
  }

  /**
   * Finds the next pending or in_progress task in the graph.
   */
  public findNextTask(graph: TaskNode[]): TaskNode | undefined {
    return graph.find((n) => n.status === "pending" || n.status === "in_progress");
  }

  /**
   * Marks a task as completed and handles potential subsequent task activations.
   */
  public completeTask(graph: TaskNode[], taskType: TaskNodeType): void {
    const task = graph.find(n => n.type === taskType);
    if (task) {
      task.status = "completed";
      task.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Externally sets the status of a specific task type.
   */
  public setTaskStatus(graph: TaskNode[], taskType: TaskNodeType, status: TaskNode["status"]): void {
    const task = graph.find((node) => node.type === taskType);
    if (!task) return;
    task.status = status;
    task.updatedAt = new Date().toISOString();
  }

  /**
   * Activates refactor and test-fix tasks from 'skipped' to 'pending' for fix cycles.
   */
  public activateFixCycle(graph: TaskNode[]): void {
    for (const node of graph) {
      if ((node.type === "refactor" || node.type === "test-fix") && node.status === "skipped") {
        node.status = "pending";
        node.updatedAt = new Date().toISOString();
      }
    }
  }

  /**
   * Checks if a specific task type was completed.
   */
  public wasTaskCompleted(graph: TaskNode[], taskType: TaskNodeType): boolean {
    return graph.some(n => n.type === taskType && n.status === "completed");
  }
}

export const taskGraphManager = new TaskGraphManager();
