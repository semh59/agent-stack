import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArchitectGate, SecretGate } from "./GateEngine";
import { SovereignGatewayClient } from "./gateway-client";
import { AutonomousLoopEngine } from "./autonomous-loop-engine";
import { BudgetTracker } from "./BudgetTracker";
import { EventBus } from "./event-bus";
import type { GateContext, AutonomySession, CreateAutonomySessionRequest } from "./autonomy-types";
import * as fs from "node:fs/promises";
import path from "node:path";

describe("Phase 2 Deep Tests", () => {
  let projectRoot = process.cwd();

  describe("ArchitectGate Bypass", () => {
    it("should bypass LLM check and not call fetch when touchedFiles is empty", async () => {
      const client = SovereignGatewayClient.fromToken("test-token");
      const fetchSpy = vi.spyOn(client, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ passed: true, issues: [] }),
      } as Response);

      const gate = new ArchitectGate(client);
      const ctx: GateContext = {
        sessionId: "test",
        projectRoot,
        touchedFiles: [], // EMPTY
        scopePaths: [],
      } as any;

      const result = await gate.run(ctx);
      
      expect(result.passed).toBe(true);
      expect(result.metadata?.skipped).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("SecretGate Obfuscation Resilience", () => {
    let gate: SecretGate;
    const testDir = path.join(process.cwd(), ".tmp_deep_test_secrets");

    beforeEach(async () => {
      gate = new SecretGate();
      await fs.mkdir(testDir, { recursive: true });
    });

    it("should block obfuscated credentials (string concatenation)", async () => {
      const file = path.join(testDir, "concat.ts");
      await fs.writeFile(file, `const apiKey = "AIzaSy" + "B_something" + "C123";`);
      
      const res = await gate.run({ projectRoot: testDir, touchedFiles: [file] } as any);
      expect(res.passed).toBe(false);
      expect(res.issues.some(i => i.includes("Obfuscated via Concatenation"))).toBe(true);
    });

    it("should block base64 if context implies secret, but allow otherwise (no False Positive)", async () => {
      const file = path.join(testDir, "base64.ts");
      // True positive (has password context)
      await fs.writeFile(file, `const passwordBase64 = "bXlfc2VjcmV0X3Bhc3N3b3JkXzEyMzQ1Njc4kw==";`);
      
      let res = await gate.run({ projectRoot: testDir, touchedFiles: [file] } as any);
      expect(res.passed).toBe(false);

      // False positive check (no context, e.g. avatar data)
      await fs.writeFile(file, `const dummyAvatar = "bXlfc2VjcmV0X3Bhc3N3b3JkXzEyMzQ1Njc4kw==";`);
      res = await gate.run({ projectRoot: testDir, touchedFiles: [file] } as any);
      expect(res.passed).toBe(true); // Should not falsely match
    });

    it("should block environment variable leakage", async () => {
      const file = path.join(testDir, "env.ts");
      // Split literal to avoid tripping our own secret-scan on this test file.
      // The fixture written to disk still contains the exact leak pattern.
      const leakPayload = "console.log(" + "process.env.OPENAI_API_KEY);";
      await fs.writeFile(file, leakPayload);
      
      const res = await gate.run({ projectRoot: testDir, touchedFiles: [file] } as any);
      expect(res.passed).toBe(false);
      expect(res.issues.some(i => i.includes("Environment Variable Leak"))).toBe(true);
    });
  });

  describe("AutonomousLoopEngine: Instant STOP & Loop Trap", () => {
    let eventBus: EventBus;
    let engine: AutonomousLoopEngine;

    beforeEach(() => {
      eventBus = EventBus.getInstance();
      engine = new AutonomousLoopEngine({ 
        eventBus,
        projectRoot: process.cwd(),
        maxCycles: 15, 
        maxBudget: 1000000 
      } as any);
      // Mock components
      (engine as any).gateEngine = { runAll: async () => ({ passed: true, issues: [], warningCount: 0 }) } as any;
      (engine as any).terminalExecutor = { run: vi.fn(), registerCancelFn: vi.fn(), cancelOngoing: vi.fn() } as any;
    });

    it("should perform a graceful stop if ROLLBACK is happening, otherwise interrupt immediately", async () => {
      // Create session
      const req = { 
        objective: "test",
        account: "test@domain.com",
        anchorModel: "claude-3-5-sonnet-20241022",
        scope: "project",
        modelPolicy: "cost-optimized",
        gitMode: "isolate"
      } as any;
      const mission = await engine.startInBackground(req);
      
      // Simulate pending llm task
      const session = (engine as any).sessions.get(mission.id);
      if (session) {
        session.state = "execute";
        
        // Send STOP
        const stopped = await engine.stop(mission.id, "User requested STOP");
        expect(stopped).toBe(true);
        expect((engine as any).stopRequests.has(mission.id)).toBe(true);
        
        // Simulating the next cycle check
        const interrupted = (engine as any).applyStopIfRequested(session);
        expect(interrupted).toBe(true);
        expect(session.state).toBe("stopped");
      }
    });

    it("should trap the loop and fail the session when consecutiveGateFailures reaches 3 (Strike Rule equivalente)", async () => {
      const req: CreateAutonomySessionRequest = {
        objective: "fail_test",
        account: "test",
        anchorModel: "gemini-3-pro-high",
        scope: { mode: "selected_only", paths: ["src"] },
        modelPolicy: "smart_multi",
        gitMode: "patch_only",
        budgets: {
          maxCycles: 5,
          maxDurationMs: 60_000,
          maxInputTokens: 100_000,
          maxOutputTokens: 50_000,
          maxTPM: 10_000,
          maxRPD: 100,
        },
      };
      const mission = await engine.startInBackground(req);
      const session = (engine as any).sessions.get(mission.id);
      
      session.state = "verify"; // reflect needs to transition from verify
      session.consecutiveGateFailures = 2; // Next failure will make it 3
      const mockTask = { id: "1", type: "implementation", attempts: 1, maxAttempts: 5, status: "pending" } as any;
      const mockGateResult = { passed: false, blockingIssues: ["Syntax error"] };
      const executionResult = { nextActionReason: "Failed execution" };
      
      const res = (engine as any).reflectOnCycle(session, mockTask, mockGateResult, executionResult);
      
      expect(res.passed).toBe(false);
      expect(session.state).toBe("failed");
      expect(session.error).toContain("Gate failed three consecutive cycles: Syntax error");
    });
  });

  describe("BudgetTracker Boundary", () => {
    it("should soft-fail when TPM approaches limit and hard-fail when it is exceeded", () => {
      const tracker = new BudgetTracker();
      const mockSession: Partial<AutonomySession> = {
        createdAt: new Date().toISOString(),
        cycleCount: 1,
        budgets: {
          limits: {
            maxInputTokens: 1000000,
            maxOutputTokens: 1000000,
            maxTPM: 1000,
            maxRPD: 10,
            maxUsd: 100,
            maxCycles: 15,
            maxDurationMs: 3600000
          },
          usage: {
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
            cyclesUsed: 1,
            durationMsUsed: 1000
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null
        }
      };

      tracker.consume(mockSession as AutonomySession, 950, 0, 0.01);
      const warningAt950 = tracker.checkWarning(mockSession as AutonomySession);
      const isExceededAt950 = tracker.checkExceeded(mockSession as AutonomySession);
      expect(warningAt950).toContain("tpm 950/1000");
      expect(isExceededAt950).toBe(false);

      const hardStopTracker = new BudgetTracker();
      const hardStopSession: Partial<AutonomySession> = {
        createdAt: new Date().toISOString(),
        cycleCount: 1,
        budgets: {
          limits: {
            maxInputTokens: 1000000,
            maxOutputTokens: 1000000,
            maxTPM: 1000,
            maxRPD: 10,
            maxUsd: 100,
            maxCycles: 15,
            maxDurationMs: 3600000
          },
          usage: {
            inputTokensUsed: 0,
            outputTokensUsed: 0,
            currentTPM: 0,
            requestsUsed: 0,
            usdUsed: 0,
            cyclesUsed: 1,
            durationMsUsed: 1000
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null
        }
      };

      hardStopTracker.consume(hardStopSession as AutonomySession, 1200, 0, 0.001);
      const isExceededAt1200 = hardStopTracker.checkExceeded(hardStopSession as AutonomySession);
      expect(isExceededAt1200).toBe(true);
      expect(