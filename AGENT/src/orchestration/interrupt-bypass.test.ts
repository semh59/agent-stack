import { describe, expect, it, vi, beforeEach } from "vitest";
import { AutonomousLoopEngine } from "./autonomous-loop-engine";
import { GateEngine } from "./GateEngine";
import { taskGraphManager } from "./TaskGraphManager";

class FakeGateEngine extends GateEngine {
  constructor() { super(); }
  override async run(): Promise<any> {
    throw new Error("GateEngine should have been bypassed!");
  }
}

describe("AutonomousLoopEngine: Interrupt & Bypass", () => {
  const projectRoot = "/test/root";

  it("should bypass GateEngine for Analysis tasks and respond to stop immediately", async () => {
    let cycleCount = 0;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(),
      taskExecutor: async () => {
        cycleCount++;
        return { summary: "Analysis complete", touchedFiles: [] };
      }
    });

    // Create a task graph where the first task is 'analysis'
    const taskGraph = taskGraphManager.createDefaultGraph(3);
    const analysisTask = taskGraph.find((n: any) => n.type === "analysis");
    if (analysisTask) {
        analysisTask.status = "pending";
    }

    const sessionPromise = engine.start({
      account: "test@loji.next",
      objective: "Bypass test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      taskGraph,
      budgets: { maxCycles: 5, maxDurationMs: 60000, maxInputTokens: 1000, maxOutputTokens: 1000, maxUsd: 1 }
    });

    // Wait for the session to start and find the ID
    let sessionId: string | undefined;
    for(let i=0; i<50; i++) {
        await new Promise(r => setTimeout(r, 5));
        const list = await engine.listSessions();
        if (list.length > 0) {
            sessionId = list[0]!.id;
            break;
        }
    }

    expect(sessionId).toBeDefined();

    // Send stop command
    engine.stop(sessionId!, "User stop");

    const session = await sessionPromise;
    
    // Assertions
    expect(session.state).toBe("stopped");
    expect(cycleCount).toBe(1); // Should not start the second task
    // If it didn't bypass, FakeGateEngine would have thrown an error and session would be 'failed'
  });
});
