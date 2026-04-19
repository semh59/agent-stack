import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StrictGateRunner } from "./autonomy-gate-runner";
import type { CommandResult } from "./terminal-executor";

class FakeTerminal {
  constructor(private readonly fn: (command: string) => Promise<CommandResult> | CommandResult) {}
  public async run(command: string): Promise<CommandResult> {
    return this.fn(command);
  }
}

const tempDirs: string[] = [];

function commandResult(command: string, success = true): CommandResult {
  return {
    success,
    command,
    exitCode: success ? 0 : 1,
    stdout: "",
    stderr: success ? "" : "failed",
    durationMs: 1,
  };
}

async function makeTempProject(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autonomy-gate-"));
  tempDirs.push(tempDir);
  await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
  return tempDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("StrictGateRunner", () => {
  it("stops remaining commands on fail-fast", async () => {
    const projectRoot = await makeTempProject();
    const calls: string[] = [];
    const terminal = new FakeTerminal((command) => {
      calls.push(command);
      if (command === "npm run typecheck") return commandResult(command, false);
      return commandResult(command, true);
    });

    const runner = new StrictGateRunner({
      projectRoot,
      terminal: terminal as unknown as any,
      failFast: true,
    });

    const result = await runner.run(["src/index.ts"]);
    expect(result.passed).toBe(false);
    expect(calls).toEqual(["npm run typecheck"]);
    expect(result.blockingIssues.some((issue) => issue.includes("Fail-fast"))).toBe(true);
  });

  it("blocks when touched files contain hardcoded credentials", async () => {
    const projectRoot = await makeTempProject();
    const filePath = path.join(projectRoot, "src", "secrets.ts");
    await fs.writeFile(filePath, 'const API_KEY = "sk-abcdefghijklmnopqrstuvwxyz123456";\n', "utf-8");

    const terminal = new FakeTerminal((command) => {
      if (command === "npm audit --json") {
        return {
          ...commandResult(command, true),
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 } },
          }),
        };
      }
      return commandResult(command, true);
    });

    const runner = new StrictGateRunner({
      projectRoot,
      terminal: terminal as unknown as any,
      failFast: false,
    });

    const result = await runner.run(["src/secrets.ts"]);
    expect(result.passed).toBe(false);
    expect(result.blockingIssues.some((issue) => issue.includes("Secret scan blocked"))).toBe(true);
  });
});
