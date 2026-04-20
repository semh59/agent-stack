import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { AutonomousLoopEngine } from "./autonomous-loop-engine";
import { StrictGateRunner } from "./autonomy-gate-runner";
import { taskGraphManager } from "./TaskGraphManager";
import type { CommandResult } from "./terminal-executor";

class DeterministicTerminal {
  public async run(command: string): Promise<CommandResult> {
    if (command === "npm audit --json") {
      return {
        success: true,
        command,
        exitCode: 0,
        stdout: JSON.stringify({
          metadata: {
            vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
          },
        }),
        stderr: "",
        durationMs: 1,
      };
    }
    return {
      success: true,
      command,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    };
  }
}

describe("Autonomous Mode deterministic fixture", () => {
  it("applies objective within selected scope and reaches done", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autonomy-fixture-"));
    const srcDir = path.join(fixtureRoot, "src", "utils");
    await fs.mkdir(srcDir, { recursive: true });

    const mathFile = path.join(srcDir, "math.ts");
    const outsideFile = path.join(fixtureRoot, "README.md");
    await fs.writeFile(
      mathFile,
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "utf-8",
    );
    await fs.writeFile(outsideFile, "fixture-readme\n", "utf-8");
    await fs.writeFile(path.join(fixtureRoot, "ARCHITECTURE.md"), "# Architecture Guide\n- src/utils: Math utilities\n", "utf-8");

    const gateRunner = new StrictGateRunner({
      projectRoot: fixtureRoot,
      terminal: new DeterministicTerminal() as unknown as any,
    });

    // Initialize the task graph for the session
    const taskGraph = taskGraphManager.createDefaultGraph(3);
    
    const engine = new AutonomousLoopEngine({
      projectRoot: fixtureRoot,
      gateEngine: {
        run: async () => ({ passed: true, issues: [] }),
        name: "TestGate"
      } as any,
      taskExecutor: async ({ task }) => {
        if (task.type === "implementation") {
          await fs.writeFile(
            mathFile,
            [
              "export function add(a: number, b: number): number {",
              "  if (Number.isNaN(a) || Number.isNaN(b)) {",
              "    throw new Error(\"Input must be a valid number\");",
              "  }",
              "  return a + b;",
              "}",
              "",
            ].join("\n"),
            "utf-8",
          );
          const testFile = path.join(srcDir, "math.validation.test.ts");
          await fs.writeFile(
            testFile,
            [
              "import { describe, expect, it } from \"vitest\";",
              "import { add } from \"./math\";",
              "",
              "describe(\"math validation\", () => {",
              "  it(\"throws on NaN input\", () => {",
              "    expect(() => add(Number.NaN, 2)).toThrowError(/valid number/);",
              "  });",
              "});",
              "",
            ].join("\n"),
            "utf-8",
          );
          return {
            summary: "implementation: Added NaN input validation and deterministic test",
            touchedFiles: ["src/utils/math.ts", "src/utils/math.validation.test.ts"],
          };
        }

        return {
          summary: `Mock complete for task ${task.type}`,
          touchedFiles: [],
        };
      },
    });

    const session = await engine.start({
      account: "fixture@example.com",
      anchorModel: "gemini-3-pro-high",
      objective: "Add input validation: throw if input is NaN",
      scope: {
        mode: "selected_only",
        paths: ["src"],
      },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: {
        maxCycles: 12,
        maxDurationMs: 2_700_000,
        maxInputTokens: 2_000_000,
        maxOutputTokens: 400_000,
        maxUsd: 20,
      },
      taskGraph, // CRITICAL: Pass the graph to start()
    });

    // Wait for the autonomous loop to complete
    let finalSession = session;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      finalSession = engine.getSession(session.id)!;
      if (finalSession.state === "done" || finalSession.state === "failed") break;
    }

    const updatedMath = await fs.readFile(mathFile, "utf-8");
    const unchangedOutside = await fs.readFile(outsideFile, "utf-8");

    if (finalSession.state !== "done") {
      console.error("E2E Fixture Final State:", finalSession.state);
      console.error("Cycle Count:", finalSession.cycleCount);
      console.error("Session Error:", finalSession.error);
      
      const rawSession = engine.getSession(session.id)!;
      console.error("OpLog Summary:", (rawSession.opLog || []).map((o: any) => `[${o.level}] ${o.message}`).join("\n"));
      console.error("Task Graph:", JSON.stringify((rawSession as any).taskGraph?.map((n: any) => ({ id: n.id, status: n.status, type: n.type })), null, 2));
    }
    
    expect(finalSession.state).toBe("done");
    expect(updatedMath).toContain("Number.isNaN");
    expect(updatedMath).toContain("throw new Error");
    expect(finalSession.touchedFiles.every((file) => file.startsWith("src/"))).toBe(true);
    expect(unchangedOutside).toBe("fixture-readme\n");
  }, 30000); // Extended timeout for E2E flow
});
