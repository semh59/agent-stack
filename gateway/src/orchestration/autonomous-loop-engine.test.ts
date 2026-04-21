import { describe, expect, it, vi, beforeEach } from "vitest";
import { AutonomousLoopEngine } from "./autonomous-loop-engine";
import { GateEngine } from "./GateEngine";
import type { GateContext, GateResult } from "./autonomy-types";
import { eventBus } from "./event-bus";
import fs from "node:fs/promises";
import path from "node:path";

class FakeGateEngine extends GateEngine {
  constructor(private passAll = true) { super(); }
  override async run(_ctx: GateContext): Promise<GateResult> {
    return { 
      passed: this.passAll,
      strictMode: true,
      blockingIssues: this.passAll ? [] : ["FAIL"], 
      auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
      impactedScopes: ["root"],
      commands: [],
      timestamp: new Date().toISOString()
    } as any;
  }
}

async function waitForTerminalState(engine: AutonomousLoopEngine, sessionId: string): Promise<any> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const session = engine.getSession(sessionId);
    if (session && ["done", "failed", "stopped"].includes(session.state)) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for session ${sessionId} to finish`);
}

async function waitForSessionState(
  engine: AutonomousLoopEngine,
  sessionId: string,
  targetState: "paused" | "execute" | "stopped" | "done" | "failed",
): Promise<any> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const session = engine.getSession(sessionId);
    if (session?.state === targetState) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for session ${sessionId} to reach ${targetState}`);
}

describe("AutonomousLoopEngine", () => {
  const projectRoot = process.cwd();

  beforeEach(async () => {
    eventBus.clearAll();
    // Clear session persistence directory to ensure isolation
    const autonomyPath = path.join(projectRoot, ".gemini", "autonomy");
    try {
      await fs.rm(autonomyPath, { recursive: true, force: true });
    } catch (_e) {}
  });

  // 1. Happy Path
  it("completes session when executor and gates pass", async () => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async ({ task }) => ({
        summary: `ok ${task.type}`,
        touchedFiles: task.type === "implementation" ? ["src/feature.ts"] : [],
      }),
    });

    const session = await engine.start({
      account: "user@example.com",
      anchorModel: "gemini-3-pro-high",
      objective: "successful objective",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 5, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 1 },
    });

    expect(session.state).toBe("done");
    expect(session.touchedFiles).toContain("src/feature.ts");
    expect(session.cycleCount).toBeGreaterThan(0);
  });

  // 2. Gate Failures & Retries
  it("fails after repeated gate failures (3-strike rule)", async () => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(false), // Always fails
      taskExecutor: async ({ task }) => ({
        summary: `ran ${task.type}`,
        touchedFiles: ["src/dummy.ts"],
      }),
    });

    const session = await engine.start({
      account: "user@example.com",
      anchorModel: "gemini-3-pro-high",
      objective: "failing gate test",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 1 },
    });

    expect(session.state).toBe("failed");
    expect(session.consecutiveGateFailures).toBe(3);
  });

  // 3. Budget: TPM/RPD Quota Handling
  it("downgrades model and emits budget warning when TPM approaches the limit", async () => {
    const budgetEvents: Array<Record<string, unknown>> = [];
    const modelSwitches: Array<Record<string, unknown>> = [];
    let executionCount = 0;

    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async ({ task }) => {
        executionCount += 1;
        return {
          summary: `ok ${task.type}`,
          touchedFiles: task.type === "implementation" ? ["src/feature.ts"] : [],
          inputTokens: executionCount === 1 ? 950 : 0,
        };
      },
    });

    engine.onEvent((event) => {
      if (event.type === "budget") {
        budgetEvents.push(event.payload);
      }
      if (event.type === "model_switch") {
        modelSwitches.push(event.payload);
      }
    });

    const session = engine.create({
      account: "test@loji.next",
      objective: "Budget soft boundary test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: {
        maxCycles: 5,
        maxDurationMs: 60000,
        maxInputTokens: 1_000_000,
        maxOutputTokens: 50_000,
        maxTPM: 1_000,
        maxRPD: 20,
      }
    });
    expect(engine.runExistingInBackground(session.id)).toBe(true);

    const finalSession = await waitForTerminalState(engine, session.id);

    expect(finalSession.state).toBe("done");
    expect(
      budgetEvents.some((payload) => payload.warning === true && payload.exceeded !== true),
    ).toBe(true);

    const downgrade = modelSwitches.find((payload) => payload.reasonCode === "BUDGET_EXCEEDED");
    expect(downgrade).toBeDefined();
    expect((downgrade as any).selectedModel).not.toBe("gemini-3-pro-high");
  });

  it("fails the mission when the TPM limit is exceeded", async () => {
    let failedEventSeen = false;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => ({
        summary: "hard stop step",
        touchedFiles: [],
        inputTokens: 1_200,
      }),
    });

    engine.onEvent((event) => {
      if (event.type === "failed") {
        failedEventSeen = true;
      }
    });

    const session = engine.create({
      account: "test@loji.next",
      objective: "Budget hard stop test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: {
        maxCycles: 5,
        maxDurationMs: 60000,
        maxInputTokens: 1_000_000,
        maxOutputTokens: 50_000,
        maxTPM: 1_000,
        maxRPD: 20,
      }
    });
    expect(engine.runExistingInBackground(session.id)).toBe(true);

    const finalSession = await waitForTerminalState(engine, session.id);

    expect(finalSession.state).toBe("failed");
    expect(finalSession.budgets.exceeded).toBe(true);
    expect(finalSession.error).toContain("tpm");
    expect(failedEventSeen).toBe(true);
  });

  it("fails a rapid-fire mission when repeated requests exhaust the TPM window", async () => {
    let executionCount = 0;

    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async ({ task }) => {
        executionCount += 1;
        return {
          summary: `burst ${task.type}`,
          touchedFiles: task.type === "implementation" ? ["src/burst.ts"] : [],
          inputTokens: 400,
        };
      },
    });

    const session = engine.create({
      account: "test@loji.next",
      objective: "Rapid-fire TPM mission",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: {
        maxCycles: 6,
        maxDurationMs: 60_000,
        maxInputTokens: 1_000_000,
        maxOutputTokens: 50_000,
        maxTPM: 1_000,
        maxRPD: 20,
      }
    });
    expect(engine.runExistingInBackground(session.id)).toBe(true);

    const finalSession = await waitForTerminalState(engine, session.id);

    expect(executionCount).toBeGreaterThanOrEqual(3);
    expect(finalSession.state).toBe("failed");
    expect(finalSession.budgets.exceeded).toBe(true);
    expect(finalSession.budgets.exceedReason).toContain("tpm");
    expect(finalSession.budgets.usage.currentTPM).toBeGreaterThan(1_000);
  });

  // 4. Budget: Cycle Limit
  it("fails when maxCycles is reached", async () => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => ({ summary: "nop", touchedFiles: [] }),
    });

    const session = await engine.start({
      account: "test@loji.next",
      objective: "Cycle limit test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 1, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 10 }
    });

    expect(session.state).toBe("failed");
    expect(session.error).toContain("cycles budget exhausted");
  });

  it.each([
    "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
    "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory",
  ])("fails immediately on Node OOM signature (%s) without entering retry", async (oomMessage) => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => {
        throw new Error(oomMessage);
      },
    });

    const session = await engine.start({
      account: "oom@test.dev",
      anchorModel: "gemini-3-pro-high",
      objective: "OOM hard failure path",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 5, maxDurationMs: 60_000, maxInputTokens: 100_000, maxOutputTokens: 50_000, maxUsd: 1 },
      taskGraph: [
        {
          id: "impl-1",
          type: "implementation",
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(session.state).toBe("failed");
    expect(session.error).toContain("unrecoverable runtime error");
    expect(session.error?.toLowerCase()).toContain("out of memory");
    expect(session.timeline.some((entry) => entry.state === "retry")).toBe(false);
  });

  it("keeps spent token cost after gate-failure retry (no refund on backtrack)", async () => {
    let gateRuns = 0;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: {
        run: async () => {
          gateRuns += 1;
          return {
            passed: gateRuns > 1,
            strictMode: true,
            blockingIssues: gateRuns > 1 ? [] : ["Deterministic verify failure"],
            auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
            impactedScopes: ["root"],
            commands: [],
            timestamp: new Date().toISOString(),
          };
        },
      } as any,
      taskExecutor: async ({ task }) => ({
        summary: `step ${task.type}`,
        touchedFiles: task.type === "implementation" ? ["src/retry-cost.ts"] : [],
        inputTokens: task.type === "implementation" ? 200 : 0,
        outputTokens: 0,
      }),
    });

    const session = await engine.start({
      account: "sunk@test.dev",
      anchorModel: "gemini-3-pro-high",
      objective: "Sunk cost retry path",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 8, maxDurationMs: 60_000, maxInputTokens: 100_000, maxOutputTokens: 50_000, maxUsd: 1 },
      taskGraph: [
        {
          id: "impl-1",
          type: "implementation",
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          updatedAt: new Date().toISOString(),
        },
        {
          id: "final-1",
          type: "finalize",
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(session.state).toBe("done");
    expect(gateRuns).toBe(2);
    expect(session.budgets.usage.inputTokensUsed).toBe(400);
  });

  it("applies TPM budget cumulatively across retries (no sunk-cost refund)", async () => {
    let gateRuns = 0;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: {
        run: async () => {
          gateRuns += 1;
          return {
            passed: gateRuns > 1,
            strictMode: true,
            blockingIssues: gateRuns > 1 ? [] : ["Force retry once"],
            auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
            impactedScopes: ["root"],
            commands: [],
            timestamp: new Date().toISOString(),
          };
        },
      } as any,
      taskExecutor: async ({ task }) => ({
        summary: `step ${task.type}`,
        touchedFiles: task.type === "implementation" ? ["src/retry-budget.ts"] : [],
        inputTokens: task.type === "implementation" ? 600 : 0,
      }),
    });

    const session = await engine.start({
      account: "budget-retry@test.dev",
      anchorModel: "gemini-3-pro-high",
      objective: "Cumulative TPM after retry",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: {
        maxCycles: 8,
        maxDurationMs: 60_000,
        maxInputTokens: 100_000,
        maxOutputTokens: 50_000,
        maxTPM: 1_000,
        maxRPD: 20,
        maxUsd: 1,
      },
      taskGraph: [
        {
          id: "impl-1",
          type: "implementation",
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(session.state).toBe("failed");
    expect(session.budgets.exceeded).toBe(true);
    expect(session.budgets.exceedReason).toContain("tpm");
    expect(session.budgets.usage.currentTPM).toBeGreaterThan(1_000);
  });

  it("revalidates touchedFiles against git dirty tree and prunes stale entries", async () => {
    const gitManager = {
      getDirtyFiles: vi.fn().mockResolvedValue(["src/fresh.ts", "src/windows.ts"]),
    } as any;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      gitManager,
      taskExecutor: async () => ({ summary: "noop", touchedFiles: [] }),
    });

    const session = engine.create({
      account: "stale@test.dev",
      objective: "Stale touched files sync",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 3, maxDurationMs: 60_000, maxInputTokens: 10_000, maxOutputTokens: 1_000, maxUsd: 1 },
    });
    session.touchedFiles = ["src/stale.ts", "src/fresh.ts", "src\\windows.ts"];

    await (engine as any).revalidateTouchedFiles(session);

    expect(gitManager.getDirtyFiles).toHaveBeenCalledTimes(1);
    expect(session.touchedFiles).toEqual(["src/fresh.ts", "src/windows.ts"]);
  });

  // 5. Interrupt: Stop
  it("stops session immediately when stop() is called", async () => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => {
        await new Promise(r => setTimeout(r, 100));
        return { summary: "delayed", touchedFiles: [] };
      }
    });

    const session = engine.create({
      account: "test@loji.next",
      objective: "Stop test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 10 }
    });

    engine.runExistingInBackground(session.id);
    engine.stop(session.id, "User request");

    const finalSession = await waitForTerminalState(engine, session.id);
    expect(finalSession.state).toBe("stopped");
    expect(finalSession.stopReason).toBe("User request");
  });

  // 6. Interrupt: Pause/Resume
  it("pauses and resumes correctly", async () => {
    let executorCalled = 0;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => {
        executorCalled++;
        await new Promise(r => setTimeout(r, 200)); // Increased to ensure pause window
        return { summary: "step", touchedFiles: [] };
      }
    });

    const session = engine.create({
      account: "test@loji.next",
      objective: "Pause test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 5, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 10 }
    });

    engine.runExistingInBackground(session.id);
    
    expect(session.id).toBeDefined();
    engine.pause(session.id, "Wait for me");
    
    const pausedSession = await waitForSessionState(engine, session.id, "paused");
    expect(pausedSession?.state).toBe("paused");
    
    // Resume
    engine.resume(session.id, "Go ahead");
    const finalSession = await waitForTerminalState(engine, session.id);
    
    expect(finalSession.state).toBe("done");
    expect(executorCalled).toBeGreaterThan(0);
  });

  it("waits at the real plan review checkpoint and resumes the same cycle after approval", async () => {
    let executionCount = 0;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => {
        executionCount += 1;
        return { summary: "approved plan execution", touchedFiles: [] };
      },
    });

    const session = engine.create({
      account: "review@test.dev",
      objective: "Review before execute",
      anchorModel: "claude-opus-4-5-thinking",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      reviewAfterPlan: true,
      budgets: {
        maxCycles: 3,
        maxDurationMs: 60_000,
        maxInputTokens: 100_000,
        maxOutputTokens: 50_000,
        maxTPM: 10_000,
        maxRPD: 100,
      },
      taskGraph: [
        {
          id: "analysis-only",
          type: "analysis",
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(engine.runExistingInBackground(session.id)).toBe(true);
    const pausedSession = await waitForSessionState(engine, session.id, "paused");

    expect(pausedSession.reviewStatus).toBe("plan_pending");
    expect(pausedSession.currentModel).toBe("claude-opus-4-5-thinking");
    expect(pausedSession.currentGear).toBe("elite");
    expect(pausedSession.artifacts.plan).toContain("## Objective");
    expect(pausedSession.artifacts.plan).toContain("## Current Model");
    expect(executionCount).toBe(0);

    expect(engine.resume(session.id, "Approved from test")).toBe(true);
    const finalSession = await waitForTerminalState(engine, session.id);

    expect(finalSession.state).toBe("done");
    expect(finalSession.reviewStatus).toBe("approved");
    expect(executionCount).toBe(1);
  });

  it("marks review as rejected when the mission is stopped during plan approval", async () => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => ({ summary: "should not execute", touchedFiles: [] }),
    });

    const session = engine.create({
      account: "review@test.dev",
      objective: "Reject before execute",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      reviewAfterPlan: true,
      budgets: {
        maxCycles: 3,
        maxDurationMs: 60_000,
        maxInputTokens: 100_000,
        maxOutputTokens: 50_000,
        maxTPM: 10_000,
        maxRPD: 100,
      },
      taskGraph: [
        {
          id: "analysis-only",
          type: "analysis",
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(engine.runExistingInBackground(session.id)).toBe(true);
    await waitForSessionState(engine, session.id, "paused");
    expect(engine.stop(session.id, "Plan rejected")).toBe(true);

    const finalSession = await waitForTerminalState(engine, session.id);
    expect(finalSession.state).toBe("stopped");
    expect(finalSession.reviewStatus).toBe("rejected");
    expect(finalSession.stopReason).toBe("Plan rejected");
  });

  // 7. Event sequence
  it("emits correct sequence of events", async () => {
    const events: string[] = [];
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => ({ summary: "ok", touchedFiles: ["test.ts"] })
    });

    engine.onEvent((ev) => {
      events.push(ev.type);
    });

    await engine.start({
      account: "test@loji.next",
      objective: "Event test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 1, maxDurationMs: 2000, maxInputTokens: 1000, maxOutputTokens: 1000, maxUsd: 1 }
    });

    expect(events).toContain("state");
    expect(events).toContain("model_switch");
    expect(events).toContain("artifact");
  });

  // 8. Model Switching on Error
  it("switches model context on execution error", async () => {
    let switchReasonDetected = false;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async ({ modelDecision }) => {
        if (modelDecision.reasonCode === "INITIAL") throw new Error("Rate limit exceeded 429");
        return { summary: "recovered", touchedFiles: [] };
      }
    });

    engine.onEvent((ev) => {
      if (ev.type === "model_switch" && (ev.payload as any).reasonCode === "RATE_LIMIT") {
        switchReasonDetected = true;
      }
    });

    const session = await engine.start({
      account: "test@loji.next",
      objective: "Recovery test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 10 }
    });

    expect(session.state).toBe("done");
    expect(switchReasonDetected).toBe(true);
  });

  // 9. Fix-cycle activation
  it("activates fix-cycle tasks on gate failure", async () => {
    let gateAttempts = 0;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: {
        run: async () => {
          gateAttempts++;
          return { 
             passed: gateAttempts > 1, 
             strictMode: true,
             blockingIssues: gateAttempts === 1 ? ["Lint error"] : [], 
             auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 }, 
             commands: [], 
             impactedScopes: ["src"],
             timestamp: new Date().toISOString()
          };
        }
      } as any,
      taskExecutor: async () => ({ summary: "fixed", touchedFiles: ["src/app.ts"] })
    });

    const session = await engine.start({
      account: "test@loji.next",
      objective: "Fix cycle test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 10 }
    });

    expect(session.state).toBe("done");
    expect(session.taskGraph.find(n => n.type === "test-fix")?.status).toBe("completed");
  });

  // 10. Task skip logic
  it("skips already completed tasks in the graph", async () => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async ({ task }) => ({ 
        summary: `Mock for ${task.type}`, 
        touchedFiles: [] 
      })
    });

    const session = engine.create({
      account: "test@loji.next",
      objective: "Skip test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 5, maxDurationMs: 60000, maxInputTokens: 10000, maxOutputTokens: 1000, maxUsd: 1 }
    });

    // Manually complete analysis
    const analysisNode = session.taskGraph.find(n => n.type === "analysis")!;
    analysisNode.status = "completed";

    await engine.runExistingInBackground(session.id);
    
    // Wait for completion
    let finalSession: any;
    for(let i=0; i<50; i++) {
        await new Promise(r => setTimeout(r, 50));
        finalSession = engine.getSession(session.id);
        if (finalSession.state === "done" || finalSession.state === "failed") break;
    }

    expect(finalSession.state).toBe("done");
  });

  // 11. Gate Bypass for non-file tasks
  it("bypasses gate for research/analysis tasks", async () => {
    let gateCalled = false;
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: {
        run: async () => {
          gateCalled = true;
          return { passed: true };
        }
      } as any,
      taskExecutor: async () => ({ 
        summary: "Bypass test summary", 
        touchedFiles: [] 
      })
    });

    const session = await engine.start({
      account: "test@loji.next",
      objective: "Bypass test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 5, maxDurationMs: 5000, maxInputTokens: 1000, maxOutputTokens: 1000, maxUsd: 1 }
    });

    // Research/Analysis tasks should not trigger GateEngine if no files touched
    // In our implementation, verifyCycle bypasses if task type is not implementation or no files touched.
    // The first task is usually 'analysis'.
    expect(gateCalled).toBe(false);
    expect(session.state).toBe("done");
  });

  // 12. Interrupted state emission
  it("sets state to 'stopped' (interrupted) when stop() is called during bypassed cycle", async () => {
    const engine = new AutonomousLoopEngine({
      projectRoot,
      gateEngine: new FakeGateEngine(true),
      taskExecutor: async () => {
        await new Promise(r => setTimeout(r, 200));
        return { summary: "ok", touchedFiles: [] };
      }
    });

    const session = engine.create({
      account: "test@loji.next",
      objective: "Interrupt test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 5, maxDurationMs: 30000, maxInputTokens: 1000, maxOutputTokens: 1000, maxUsd: 1 }
    });

    engine.runExistingInBackground(session.id);

    // Wait for the session to start and be in running state
    await new Promise(r => setTimeout(r, 50));
    engine.stop(session.id, "Immediate stop");

    const finalSession = await waitForTerminalState(engine, session.id);
    expect(finalSession.state).toBe("stopped");
    expect(finalSession.stopReason).toBe("Immediate stop");
  });
});
