import { describe, it, expect, beforeEach, vi } from "vitest";
import { GateEngine, SecretGate, ScopeGate, ArchitectGate } from "./GateEngine";
import type { CommandResult } from "./terminal-executor";
import type { GateContext, AuditSummary } from "./autonomy-types";
import * as fs from "node:fs/promises";
import path from "node:path";

class FakeTerminal {
  constructor(private readonly fn: (cmd: string) => CommandResult | Promise<CommandResult>) {}
  async run(cmd: string): Promise<CommandResult> {
    return this.fn(cmd);
  }
}

function ok(cmd: string): CommandResult {
  return { success: true, command: cmd, exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
}

describe("GateEngine", () => {
  let ctx: GateContext;

  beforeEach(() => {
    ctx = {
      sessionId: "test",
      projectRoot: ".",
      touchedFiles: ["src/index.ts"],
      scopePaths: ["root"],
    } as any;
  });

  describe("Audit Merging", () => {
    it("merges multiple audit summaries correctly", async () => {
      const engine = new GateEngine();
      
      const gate1 = {
        name: "Gate1",
        run: async () => ({
          passed: true,
          issues: [],
          metadata: {
            audit: { critical: 1, high: 2, moderate: 0, low: 0, total: 3 } as AuditSummary
          }
        })
      };
      const gate2 = {
        name: "Gate2",
        run: async () => ({
          passed: true,
          issues: [],
          metadata: {
            audit: { critical: 0, high: 1, moderate: 5, low: 10, total: 16 } as AuditSummary
          }
        })
      };

      (engine as any).gates = [gate1, gate2];

      const result = await engine.runAll(ctx);
      
      const audit = result.auditSummary;
      expect(audit.critical).toBe(1);
      expect(audit.high).toBe(3);
      expect(audit.moderate).toBe(5);
      expect(audit.total).toBe(19);
    });
  });

  describe("SecurityGate", () => {
    it("blocks on critical vulnerabilities", async () => {
      const terminal = new FakeTerminal((cmd) => {
        if (cmd === "npm audit --json") {
          return {
            ...ok(cmd),
            stdout: JSON.stringify({
              metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 0, low: 0, total: 1 } }
            })
          };
        }
        return ok(cmd);
      });

      const engine = GateEngine.createDefaultGateEngine(terminal as any);
      const result = await engine.runAll(ctx);

      expect(result.passed).toBe(false);
      expect(result.blockingIssues).toContain("[SecurityGate] 1 critical vulnerabilities found");
    });
  });

  describe("SecretGate", () => {
    it("detects hardcoded AWS keys and OpenAI keys", async () => {
      const gate = new SecretGate();
      const tempFile = path.join(process.cwd(), "temp_secret.txt");
      await fs.writeFile(tempFile, "const key = 'mock_secret_' + 'is_here_long_enough';\nconst aws = 'AKIA' + '0000000000000000';");
      
      try {
        const result = await gate.run({ touchedFiles: [tempFile], projectRoot: process.cwd() } as any);
        expect(result.passed).toBe(false);
        expect(result.issues.some(i => i.includes("detected"))).toBe(true);
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
    });

    it("passes when no secrets are present", async () => {
      const gate = new SecretGate();
      const tempFile = path.join(process.cwd(), "temp_safe.txt");
      await fs.writeFile(tempFile, "const key = 'SAFE_STRING';");
      
      try {
        const result = await gate.run({ touchedFiles: [tempFile], projectRoot: process.cwd() } as any);
        expect(result.passed).toBe(true);
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
    });

    it("does not false-positive on benign env placeholders", async () => {
      const gate = new SecretGate();
      const tempFile = path.join(process.cwd(), "temp_env_placeholder.env");
      await fs.writeFile(tempFile, "API_KEY=test_string\nNODE_ENV=development\n");

      try {
        const result = await gate.run({ touchedFiles: [tempFile], projectRoot: process.cwd() } as any);
        expect(result.passed).toBe(true);
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
    });

    it("blocks encoded decode-exec payload patterns", async () => {
      const gate = new SecretGate();
      const tempFile = path.join(process.cwd(), "temp_encoded_exec.ts");
      await fs.writeFile(
        tempFile,
        "execute_encoded('Y29uc29sZS5sb2coJ3B3bmVkJyk=');\n" +
          "eval(Buffer.from('Y29uc29sZS5sb2coJ2V2YWwnKQ==', 'base64').toString());\n",
      );

      try {
        const result = await gate.run({ touchedFiles: [tempFile], projectRoot: process.cwd() } as any);
        expect(result.passed).toBe(false);
        expect(result.issues.some((issue) => issue.includes("Encoded Execute Payload"))).toBe(true);
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
    });
  });

  describe("ScopeGate", () => {
    it("allows files within designated scope", async () => {
      const gate = new ScopeGate();
      const result = await gate.run({
        projectRoot: "/app",
        touchedFiles: ["/app/src/index.ts", "/app/ui/App.tsx"],
        scopePaths: ["src", "ui"]
      } as any);
      expect(result.passed).toBe(true);
    });

    it("blocks files outside designated scope", async () => {
      const gate = new ScopeGate();
      const result = await gate.run({
        projectRoot: "/app",
        touchedFiles: ["/app/src/index.ts", "/app/other/secret.ts"],
        scopePaths: ["src"]
      } as any);
      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain("File outside scope: other/secret.ts");
    });

    it("correctly handles directory prefix overlaps", async () => {
      const gate = new ScopeGate();
      const result = await gate.run({
        projectRoot: "/app",
        touchedFiles: ["/app/src-old/legacy.ts"],
        scopePaths: ["src"]
      } as any);
      expect(result.passed).toBe(false);
    });
  });

  describe("ArchitectGate", () => {
    it("assembles a verification prompt with ARCHITECTURE.md content", async () => {
      const gate = new ArchitectGate();
      const result = await gate.run({
        projectRoot: process.cwd(),
        touchedFiles: ["src/logic.ts"]
      } as any);

      expect(result.passed).toBe(true);
      expect(result.metadata?.promptLength).toBeGreaterThan(50);
    });

    it("fails for large changes if ARCHITECTURE.md is missing", async () => {
      const gate = new ArchitectGate();
      const result = await gate.run({
        projectRoot: "/non/existent/path",
        touchedFiles: ["f1", "f2", "f3", "f4", "f5", "f6"]
      } as any);

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain("ARCHITECTURE.md is required");
    });

    it("runs the LLM verification path when a client is available", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ passed: false, issues: ["Layer violation"] }),
      });
      const gate = new ArchitectGate({ fetch: fetchSpy } as any);

      const result = await gate.run({
        projectRoot: process.cwd(),
        touchedFiles: ["src/logic.ts"],
      } as any);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.passed).toBe(false);
      expect(result.issues[0]).toContain("[Architecture Violation] Layer violation");
    });
  });
});
