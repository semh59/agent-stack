import { spawn } from "node:child_process";
import type { CommandResult } from "./terminal-executor";

function parseCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((entry) => entry.length > 0);
}

/**
 * Runs gate commands in an isolated child process to avoid in-loop command tampering.
 */
export class GateValidatorProcess {
  private readonly allowedCommands: Set<string>;

  constructor(allowedCommands: string[]) {
    this.allowedCommands = new Set(allowedCommands);
  }

  public async run(projectRoot: string, command: string, timeoutMs: number): Promise<CommandResult> {
    if (!this.allowedCommands.has(command)) {
      return {
        success: false,
        command,
        exitCode: -1,
        stdout: "",
        stderr: `[GateValidator] BLOCKED: command not in immutable allowlist: ${command}`,
        durationMs: 0,
      };
    }

    const args = parseCommand(command);
    const executable = args.shift();
    if (!executable) {
      return {
        success: false,
        command,
        exitCode: -1,
        stdout: "",
        stderr: "[GateValidator] BLOCKED: empty command",
        durationMs: 0,
      };
    }

    const start = Date.now();
    return new Promise((resolve) => {
      const child = spawn(executable, args, {
        cwd: projectRoot,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          command,
          exitCode: -1,
          stdout,
          stderr: error.message,
          durationMs: Date.now() - start,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          stderr = `[GateValidator] command timed out (${timeoutMs}ms)\n${stderr}`;
        }
        resolve({
          success: !timedOut && code === 0,
          command,
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}
