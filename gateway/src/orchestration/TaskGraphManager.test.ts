import { describe, it, expect } from "vitest";
import { TaskGraphManager } from "./TaskGraphManager";

describe("TaskGraphManager", () => {
  const mgr = new TaskGraphManager();

  describe("createDefaultGraph", () => {
    it("returns exactly 6 nodes", () => {
      const graph = mgr.createDefaultGraph(3);
      expect(graph).toHaveLength(6);
    });

    it("creates correct task types in order", () => {
      const graph = mgr.createDefaultGraph(3);
      const types = graph.map(n => n.type);
      expect(types).toEqual(["analysis", "implementation", "refactor", "test-fix", "verification", "finalize"]);
    });

    it("sets analysis, implementation, verification, finalize as pending", () => {
      const graph = mgr.createDefaultGraph(3);
      expect(graph[0]!.status).toBe("pending"); // analysis
      expect(graph[1]!.status).toBe("pending"); // implementation
      expect(graph[4]!.status).toBe("pending"); // verification
      expect(graph[5]!.status).toBe("pending"); // finalize
    });

    it("sets refactor and test-fix as skipped", () => {
      const graph = mgr.createDefaultGraph(3);
      expect(graph[2]!.status).toBe("skipped"); // refactor
      expect(graph[3]!.status).toBe("skipped"); // test-fix
    });

    it("uses crypto.randomUUID-based IDs", () => {
      const graph = mgr.createDefaultGraph(3);
      for (const node of graph) {
        expect(node.id).toMatch(/^[a-z-]+-[a-f0-9]{8}$/);
      }
    });

    it("sets maxAttempts from parameter", () => {
      const graph = mgr.createDefaultGraph(5);
      for (const node of graph) {
        expect(node.maxAttempts).toBe(5);
      }
    });
  });

  describe("findNextTask", () => {
    it("returns first pending task", () => {
      const graph = mgr.createDefaultGraph(3);
      const next = mgr.findNextTask(graph);
      expect(next?.type).toBe("analysis");
    });

    it("returns in_progress task if exists", () => {
      const graph = mgr.createDefaultGraph(3);
      graph[0]!.status = "completed";
      graph[1]!.status = "in_progress";
      const next = mgr.findNextTask(graph);
      expect(next?.type).toBe("implementation");
    });

    it("returns undefined when all tasks are completed/skipped", () => {
      const graph = mgr.createDefaultGraph(3);
      for (const node of graph) {
        node.status = node.status === "skipped" ? "skipped" : "completed";
      }
      const next = mgr.findNextTask(graph);
      expect(next).toBeUndefined();
    });
  });

  describe("setTaskStatus", () => {
    it("changes status and updates timestamp", () => {
      const graph = mgr.createDefaultGraph(3);
      const _before = graph[0]!.updatedAt;
      // Small delay to ensure timestamp changes
      mgr.setTaskStatus(graph, "analysis", "in_progress");
      expect(graph[0]!.status).toBe("in_progress");
      expect(graph[0]!.updatedAt).toBeDefined();
    });

    it("no-ops for non-existent task type", () => {
      const graph = mgr.createDefaultGraph(3);
      expect(() => mgr.setTaskStatus(graph, "analysis", "completed")).not.toThrow();
    });
  });

  describe("activateFixCycle", () => {
    it("activates skipped refactor and test-fix to pending", () => {
      const graph = mgr.createDefaultGraph(3);
      expect(graph[2]!.status).toBe("skipped");
      expect(graph[3]!.status).toBe("skipped");

      mgr.activateFixCycle(graph);

      expect(graph[2]!.status).toBe("pending");
      expect(graph[3]!.status).toBe("pending");
    });

    it("does not change already pending/completed tasks", () => {
      const graph = mgr.createDefaultGraph(3);
      graph[2]!.status = "completed";
      graph[3]!.status = "pending";

      mgr.activateFixCycle(graph);

      expect(graph[2]!.status).toBe("completed"); // unchanged
      expect(graph[3]!.status).toBe("pending");    // unchanged
    });
  });

  describe("wasTaskCompleted", () => {
    it("returns true for completed task", () => {
      const graph = mgr.createDefaultGraph(3);
      graph[0]!.status = "completed";
      expect(mgr.wasTaskCompleted(graph, "analysis")).toBe(true);
    });

    it("returns false for non-completed task", () => {
      const graph = mgr.createDefaultGraph(3);
      expect(mgr.wasTaskCompleted(graph, "analysis")).toBe(false);
    });
  });
});
