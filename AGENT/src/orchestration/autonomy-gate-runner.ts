import path from "node:path";
import * as fs from "node:fs/promises";
import { TerminalExecutor } from "./terminal-executor";
import { GateValidatorProcess } from "./autonomy-gate-validator";
import type { AuditSummary, GateCommandResult, GateResult } from "./autonomy-types";

type ImpactedScope = "root" | "ui" | "vscode-extension";

interface AuditJsonShape {
  metadata?: {
    vulnerabilities?: {
      critical?: number;
      high?: number;
      moderate?: number;
      low?: number;
      total?: number;
    };
  };
}

interface StrictGateRunnerOptions {
  projectRoot: string;
  terminal?: TerminalExecutor;
  validator?: GateValidatorProcess;
  strictMode?: boolean;
  blockHigh?: boolean;
  blockCritical?: boolean;
  failFast?: boolean;
}

const ROOT_COMMANDS = [
  "npm run typecheck",
  "npx vitest run", // BUG-5: Expanded Test Gate
  "npm run build",
];
const UI_COMMANDS = ["npm run lint --prefix ui", "npm run build --prefix ui"];
const EXTENSION_COMMANDS = [
  "npm run compile --prefix vscode-extension",
  "npm run lint --prefix vscode-extension",
  "npm run build --prefix vscode-extension",
];
const SECURITY_SCAN_COMMAND = "npm run security:scan"; // BUG-5: Expanded Security Gate
const AUDIT_COMMAND = "npm audit --json";

const SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "OpenAI-style token", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  {
    label: "Hardcoded credential assignment",
    regex: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\r\n]{16,}["']/gi,
  },
];

function normalizeRelative(projectRoot: string, filePath: string): string {
  if (!filePath.trim()) return "";
  const normalized = filePath.replace(/\\/g, "/");
  if (!path.isAbsolute(filePath)) return normalized.replace(/^\.\/+/, "");
  return path.relative(projectRoot, filePath).replace(/\\/g, "/");
}

function emptyAuditSummary(): AuditSummary {
  return {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    total: 0,
  };
}

/**
 * Strict gate evaluator used by Autonomous Mode.
 */
export class StrictGateRunner {
  private readonly terminal: TerminalExecutor;
  private readonly validator: GateValidatorProcess;
  private readonly projectRoot: string;
  private readonly strictMode: boolean;
  private readonly blockHigh: boolean;
  private readonly blockCritical: boolean;
  private readonly failFast: boolean;
  private readonly useExternalValidator: boolean;

  constructor(options: StrictGateRunnerOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.terminal = options.terminal ?? new TerminalExecutor(this.projectRoot);
    this.validator = options.validator ?? new GateValidatorProcess(this.getImmutableAllowedCommands());
    this.strictMode = options.strictMode ?? true;
    this.blockHigh = options.blockHigh ?? true;
    this.blockCritical = options.blockCritical ?? true;
    this.failFast = options.failFast ?? true;
    this.useExternalValidator = !options.terminal;
  }

  public collectImpactedScopes(touchedFiles: string[]): ImpactedScope[] {
    const scopes = new Set<ImpactedScope>();

    for (const filePath of touchedFiles) {
      const rel = normalizeRelative(this.projectRoot, filePath);
      if (!rel) continue;

      if (rel.startsWith("ui/")) {
        scopes.add("ui");
        continue;
      }
      if (rel.startsWith("vscode-extension/")) {
        scopes.add("vscode-extension");
        continue;
      }

      if (rel.startsWith("src/") || !rel.includes("/")) {
        scopes.add("root");
        continue;
      }

      // Any top-level project file should trigger root gates.
      if (!rel.startsWith(".agent/")) {
        scopes.add("root");
      }
    }

    if (scopes.size === 0) {
      scopes.add("root");
    }

    return [...scopes];
  }

  public async run(touchedFiles: string[], scopePaths: string[] = []): Promise<GateResult> {
    const impactedScopes = this.collectImpactedScopes(touchedFiles);
    const commandsToRun = this.buildCommandList(impactedScopes);
    const commandResults: GateCommandResult[] = [];
    const blockingIssues: string[] = [];
    let auditSummary = emptyAuditSummary();

    for (const command of commandsToRun) {
      const result = this.useExternalValidator
        ? await this.validator.run(this.projectRoot, command, 300_000)
        : await this.terminal.run(command, {
            profile: "gate",
            allowedCommands: this.getImmutableAllowedCommands(),
          });
      const gateResult: GateCommandResult = {
        command,
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
      commandResults.push(gateResult);

      if (!result.success) {
        blockingIssues.push(`Command failed: ${command} (exit ${result.exitCode})`);
        if (this.failFast) {
          const remaining = commandsToRun.length - commandResults.length;
          if (remaining > 0) {
            blockingIssues.push(`Fail-fast active: skipped ${remaining} remaining gate command(s)`);
          }
          break;
        }
      }

      if (command === AUDIT_COMMAND) {
        const parsed = this.parseAuditOutput(result.stdout, result.stderr);
        if (parsed) {
          auditSummary = parsed;
          this.appendAuditBlockingIssues(auditSummary, blockingIssues);
        } else if (this.strictMode) {
          blockingIssues.push("npm audit output could not be parsed as JSON");
        }
      }
    }

    const secretFindings = await this.scanForSecrets(touchedFiles);
    for (const finding of secretFindings) {
      blockingIssues.push(`Secret scan blocked: ${finding}`);
    }
    const scopeFindings = await this.scanForScopeLeaks(touchedFiles, scopePaths);
    for (const finding of scopeFindings) {
      blockingIssues.push(`Scope gate blocked: ${finding}`);
    }

    return {
      passed: blockingIssues.length === 0,
      strictMode: this.strictMode,
      impactedScopes,
      commands: commandResults,
      blockingIssues,
      auditSummary,
      timestamp: new Date().toISOString(),
    };
  }

  private async scanForSecrets(touchedFiles: string[]): Promise<string[]> {
    const findings: string[] = [];
    for (const filePath of touchedFiles) {
      const relative = normalizeRelative(this.projectRoot, filePath);
      if (!relative) continue;
      const absolute = path.resolve(this.projectRoot, relative);

      let content: string;
      try {
        content = await fs.readFile(absolute, "utf-8");
      } catch {
        continue;
      }

      for (const pattern of SECRET_PATTERNS) {
        pattern.regex.lastIndex = 0;
        if (pattern.regex.test(content)) {
          findings.push(`${relative} matched ${pattern.label}`);
          break;
        }
      }
    }
    return findings;
  }

  private appendAuditBlockingIssues(summary: AuditSummary, blockingIssues: string[]): void {
    if (this.blockCritical && summary.critical > 0) {
      blockingIssues.push(`Security gate blocked: critical=${summary.critical}`);
    }
    if (this.blockHigh && summary.high > 0) {
      blockingIssues.push(`Security gate blocked: high=${summary.high}`);
    }
  }

  private parseAuditOutput(stdout: string, stderr: string): AuditSummary | null {
    const payload = stdout.trim().length > 0 ? stdout : stderr;
    if (!payload.trim()) return null;
    try {
      const parsed = JSON.parse(payload) as AuditJsonShape;
      const vulnerabilities = parsed.metadata?.vulnerabilities;
      if (!vulnerabilities) return emptyAuditSummary();
      return {
        critical: vulnerabilities.critical ?? 0,
        high: vulnerabilities.high ?? 0,
        moderate: vulnerabilities.moderate ?? 0,
        low: vulnerabilities.low ?? 0,
        total: vulnerabilities.total ?? 0,
      };
    } catch {
      return null;
    }
  }

  private buildCommandList(impactedScopes: ImpactedScope[]): string[] {
    const commands = new Set<string>();

    if (impactedScopes.includes("root")) {
      for (const command of ROOT_COMMANDS) commands.add(command);
    }
    if (impactedScopes.includes("ui")) {
      for (const command of UI_COMMANDS) commands.add(command);
    }
    if (impactedScopes.includes("vscode-extension")) {
      for (const command of EXTENSION_COMMANDS) commands.add(command);
    }

    commands.add(SECURITY_SCAN_COMMAND);
    commands.add(AUDIT_COMMAND);
    return [...commands];
  }

  private getImmutableAllowedCommands(): string[] {
    return [
      ...ROOT_COMMANDS,
      ...UI_COMMANDS,
      ...EXTENSION_COMMANDS,
      SECURITY_SCAN_COMMAND,
      AUDIT_COMMAND,
    ];
  }

  private async scanForScopeLeaks(touchedFiles: string[], scopePaths: string[]): Promise<string[]> {
    const findings: string[] = [];
    if (scopePaths.length === 0) return findings;

    const normalizedScopes = scopePaths
      .map((scope) => scope.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, ""))
      .filter((scope) => scope.length > 0);

    const isWithinScope = (relPath: string): boolean =>
      normalizedScopes.some((scope) => relPath === scope || relPath.startsWith(`${scope}/`));

    const highImpactConfig = [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "vite.config.ts",
      "vite.config.js",
      ".eslintrc",
      ".eslintrc.cjs",
      ".eslintrc.js",
    ];

    for (const filePath of touchedFiles) {
      const relative = normalizeRelative(this.projectRoot, filePath);
      if (!relative) continue;

      if (!isWithinScope(relative)) {
        findings.push(`${relative} is outside selected scope`);
        continue;
      }

      if (highImpactConfig.includes(relative) && !normalizedScopes.includes(".")) {
        findings.push(`${relative} modifies project-wide configuration outside selected-only contract`);
      }

      const absolute = path.resolve(this.projectRoot, relative);
      let content: string;
      try {
        content = await fs.readFile(absolute, "utf-8");
      } catch {
        continue;
      }

      const importRegex = /(?:import\s+[^'"]*from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const target = match[1];
        if (!target || !target.startsWith(".")) continue;
        const resolved = path
          .resolve(path.dirname(absolute), target)
          .replace(/\\/g, "/");
        const resolvedRelative = path.relative(this.projectRoot, resolved).replace(/\\/g, "/");
        if (!isWithinScope(resolvedRelative)) {
          findings.push(`${relative} imports ${target} -> ${resolvedRelative} (outside scope)`);
          break;
        }
      }
    }

    return findings;
  }
}
