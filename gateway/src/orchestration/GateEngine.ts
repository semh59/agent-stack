import path from "node:path";
import * as fs from "node:fs/promises";
import type { 
  AutonomousGate, 
  GateContext,
  GateResult,
  GateCommandResult,
  AuditSummary,
  GateMetadata
} from "./autonomy-types";
import { TerminalExecutor } from "./terminal-executor";

import { log, toUrlString } from "./gateway-utils";

/**
 * GateEngine: Orchestrates multiple quality gates for otonom missions.
 */
export class GateEngine {
  private gates: AutonomousGate[] = [];

  constructor(
    private terminal?: TerminalExecutor,
    private client?: import("./gateway-client").AlloyGatewayClient
  ) {}

  public registerGate(gate: AutonomousGate): void {
    this.gates.push(gate);
  }

  public async run(context: GateContext): Promise<GateResult> {
    return this.runAll(context);
  }

  public async runAll(context: GateContext): Promise<GateResult> {
    const blockingIssues: string[] = [];
    const commandResults: GateCommandResult[] = [];
    let auditSummary = this.emptyAuditSummary();
    const impactedScopes: Array<"root" | "ui" | "vscode-extension"> = [];

    // Phase 4C: Parallel Gate Runner with Timeout
    const GATE_TIMEOUT_MS = 60_000;
    const runGateWithTimeout = async (gate: AutonomousGate) => {
      const timeoutPromise = new Promise<{ passed: boolean, issues: string[], metadata?: GateMetadata }>((_, reject) =>
        setTimeout(() => reject(new Error(`Gate ${gate.name} timed out after ${GATE_TIMEOUT_MS}ms`)), GATE_TIMEOUT_MS)
      );
      try {
        return await Promise.race([gate.run(context), timeoutPromise]);
      } catch (err: any) {
        log.error(`Gate ${gate.name} execution error`, { err });
        return { passed: false, issues: [err.message], metadata: {} as GateMetadata };
      }
    };

    const results = await Promise.allSettled(this.gates.map(gate => runGateWithTimeout(gate)));

    results.forEach((result, index) => {
      const gate = this.gates[index]!;
      if (result.status === "fulfilled") {
        const value = result.value;
        if (!value.passed) {
          blockingIssues.push(...value.issues.map(issue => `[${gate.name}] ${issue}`));
        }
        
        const metadata = value.metadata;
        if (metadata) {
          if (Array.isArray(metadata.commands)) {
            commandResults.push(...metadata.commands);
          }
          if (metadata.audit) {
            const a = metadata.audit;
            auditSummary.critical += a.critical;
            auditSummary.high += a.high;
            auditSummary.moderate += a.moderate;
            auditSummary.low += a.low;
            auditSummary.total += a.total;
          }
          if (Array.isArray(metadata.scopes)) {
            for (const s of metadata.scopes) {
              if (!impactedScopes.includes(s)) impactedScopes.push(s);
            }
          }
        }
      } else {
        blockingIssues.push(`[${gate.name}] Gate crashed: ${result.reason}`);
      }
    });

    return {
      passed: blockingIssues.length === 0,
      strictMode: true,
      impactedScopes: impactedScopes.length > 0 ? impactedScopes : ["root"],
      commands: commandResults,
      blockingIssues,
      auditSummary,
      timestamp: new Date().toISOString()
    };
  }

  private emptyAuditSummary(): AuditSummary {
    return { critical: 0, high: 0, moderate: 0, low: 0, total: 0 };
  }

  /**
   * Factory to create a standard GateEngine with all default gates.
   */
  public static createDefaultGateEngine(
    terminal: TerminalExecutor, 
    client?: import("./gateway-client").AlloyGatewayClient
  ): GateEngine {
    const engine = new GateEngine(terminal, client);
    engine.registerGate(new LintGate(terminal));
    engine.registerGate(new TypeCheckGate(terminal));
    engine.registerGate(new CommandGate(terminal));
    engine.registerGate(new SecurityGate(terminal));
    engine.registerGate(new SecretGate());
    engine.registerGate(new ScopeGate());
    engine.registerGate(new ArchitectGate(client));
    return engine;
  }
}

/**
 * LintGate: Verifies code quality via specific linting rules.
 */
export class LintGate implements AutonomousGate {
  name = "LintGate";
  constructor(private terminal: TerminalExecutor) {}

  async run(context: GateContext) {
    if (context.touchedFiles.length === 0) return { passed: true, issues: [] };
    
    // In a real project, we would target only the touched files
    const cmd = "npm run lint";
    const resp = await this.terminal.run(cmd);
    
    return { 
      passed: resp.success, 
      issues: resp.success ? [] : ["Linting violations found. Run 'npm run lint' to fix."],
      metadata: { commands: [{ command: cmd, success: resp.success, exitCode: resp.exitCode, stdout: resp.stdout, stderr: resp.stderr, durationMs: resp.durationMs }] }
    };
  }
}

/**
 * TypeCheckGate: Verifies TypeScript integrity.
 */
export class TypeCheckGate implements AutonomousGate {
  name = "TypeCheckGate";
  constructor(private terminal: TerminalExecutor) {}

  async run(context: GateContext) {
    if (context.touchedFiles.length === 0) return { passed: true, issues: [] };

    const cmd = "npx tsc --noEmit";
    const resp = await this.terminal.run(cmd);
    
    return { 
      passed: resp.success, 
      issues: resp.success ? [] : ["TypeScript type-check failed."],
      metadata: { commands: [{ command: cmd, success: resp.success, exitCode: resp.exitCode, stdout: resp.stdout, stderr: resp.stderr, durationMs: resp.durationMs }] }
    };
  }
}

/**
 * CommandGate: Executes shell-based quality checks (build, test, etc.).
 */
export class CommandGate implements AutonomousGate {
  name = "CommandGate";
  constructor(private terminal: TerminalExecutor) {}

  async run(context: GateContext) {
    const issues: string[] = [];
    const commands: GateCommandResult[] = [];
    const scopes: Array<"root" | "ui" | "vscode-extension"> = this.collectScopes(context);
    
    const cmdList = this.getCommandsForScopes(scopes);
    for (const cmd of cmdList) {
      const resp = await this.terminal.run(cmd);
      commands.push({
        command: cmd,
        success: resp.success,
        exitCode: resp.exitCode,
        stdout: resp.stdout,
        stderr: resp.stderr,
        durationMs: resp.durationMs
      });
      if (!resp.success) {
        issues.push(`Command failed: ${cmd} (exit ${resp.exitCode})`);
        break; // Fail fast within CommandGate
      }
    }

    return { passed: issues.length === 0, issues, metadata: { commands, scopes } };
  }

  private collectScopes(context: GateContext): Array<"root" | "ui" | "vscode-extension"> {
    const set = new Set<"root" | "ui" | "vscode-extension">();
    for (const f of context.touchedFiles) {
      if (f.startsWith("ui/")) set.add("ui");
      else if (f.startsWith("vscode-extension/")) set.add("vscode-extension");
      else set.add("root");
    }
    return set.size === 0 ? ["root"] : Array.from(set);
  }

  private getCommandsForScopes(scopes: string[]): string[] {
    const cmds: string[] = [];
    if (scopes.includes("root")) cmds.push("npm run build");
    if (scopes.includes("ui")) cmds.push("npm run build --prefix ui");
    if (scopes.includes("vscode-extension")) cmds.push("npm run compile --prefix vscode-extension");
    return cmds;
  }
}

/**
 * SecurityGate: Runs security audits.
 */
export class SecurityGate implements AutonomousGate {
  name = "SecurityGate";
  constructor(private terminal: TerminalExecutor) {}

  async run(context: GateContext) {
    const resp = await this.terminal.run("npm audit --json");
    const issues: string[] = [];
    let audit: AuditSummary = { critical: 0, high: 0, moderate: 0, low: 0, total: 0 };

    try {
      const parsed = JSON.parse(resp.stdout);
      const vuln = parsed?.metadata?.vulnerabilities ?? parsed?.vulnerabilities ?? {};
      audit = {
        critical: vuln.critical ?? 0,
        high: vuln.high ?? 0,
        moderate: vuln.moderate ?? 0,
        low: vuln.low ?? 0,
        total: (vuln.critical ?? 0) + (vuln.high ?? 0) + (vuln.moderate ?? 0) + (vuln.low ?? 0),
      };

      if (audit.critical > 0) issues.push(`${audit.critical} critical vulnerabilities found`);
      if (audit.high > 0) issues.push(`${audit.high} high vulnerabilities found`);
    } catch (err) {
      log.warn('Audit JSON parse failed, using exit code fallback', { err, stdout: resp.stdout });
      // If JSON parse fails, fall back to exit code
      if (!resp.success) {
        issues.push("npm audit failed (non-JSON output)");
      }
    }

    return { 
      passed: issues.length === 0, 
      issues,
      metadata: { 
        audit,
        commands: [{ command: "npm audit --json", success: resp.success, exitCode: resp.exitCode, stdout: resp.stdout, stderr: resp.stderr, durationMs: resp.durationMs }] 
      }
    };
  }
}

/**
 * SecretGate: Scans for hardcoded credentials.
 */
export class SecretGate implements AutonomousGate {
  name = "SecretGate";
  private static readonly PATTERNS = [
    { label: "AWS Key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { label: "OpenAI Key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
    { label: "GitHub PAT", regex: /\b(ghp_|gho_|ghs_|ghr_)[A-Za-z0-9]{20,}\b/g },
    { label: "GCP Service Key", regex: /"type"\s*:\s*"service_account"/g },
    { label: "Stripe Key", regex: /\b(sk_live_|pk_live_|rk_live_)[A-Za-z0-9]{20,}\b/g },
    { label: "Credential", regex: /(?:api[_-]?key|secret|token|password|auth)\b\s*[:=]\s*["'][^"'\r\n]{16,}["']/gi },
    { label: "Private Key", regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g },
    { label: "High Entropy String (Contextual)", regex: /(?:key|secret|token|password|auth|credentials?)[A-Za-z0-9_-]*\s*[:=]\s*["'][A-Za-z0-9+/]{32,}=*["']/gi },
    { label: "Obfuscated via Concatenation", regex: /(?:key|secret|token|password|auth)[A-Za-z0-9_-]*\s*[:=]\s*["'][^"']{4,}["']\s*\+\s*["'][^"']{4,}["']/gi },
    { label: "Environment Variable Leak", regex: /console\.log\s*\(\s*process\.env\.(?:.*KEY|.*SECRET|.*TOKEN|.*PASSWORD)\s*\)/g },
    { label: "Encoded Execute Payload", regex: /\bexecute_encoded\s*\(/gi },
    {
      label: "Decode-and-Execute Chain",
      regex:
        /\b(?:eval|Function|exec|execSync|spawn|spawnSync)\s*\([\s\S]{0,160}(?:Buffer\.from\([\s\S]{0,120}base64[\s\S]{0,80}\)\.toString\(|atob\s*\()/gi,
    },
  ];

  async run(context: GateContext) {
    const issues: string[] = [];
    for (const file of context.touchedFiles) {
      const absPath = path.isAbsolute(file) ? file : path.join(context.projectRoot, file);
      try {
        const content = await fs.readFile(absPath, "utf-8");
        for (const p of SecretGate.PATTERNS) {
          p.regex.lastIndex = 0;
          if (p.regex.test(content)) {
            issues.push(`Secret detected in ${path.basename(file)}: ${p.label}`);
          }
        }
      } catch (err) {
        log.debug('SecretGate file read failed (non-critical)', { err, file });
      }
    }
    return { passed: issues.length === 0, issues };
  }
}

/**
 * ArchitectGate: Uses LLM to verify ARCHITECTURE.md compliance.
 */
export class ArchitectGate implements AutonomousGate {
  name = "ArchitectGate";
  
  constructor(private client?: import("./gateway-client").AlloyGatewayClient) {}

  async run(context: GateContext) {
    if (context.touchedFiles.length === 0) {
      return { 
        passed: true, 
        issues: [], 
        metadata: { skipped: true, reason: "No files touched, architecture check bypassed." } 
      };
    }

    const archPath = path.join(context.projectRoot, "ARCHITECTURE.md");
    let archContent = "";
    try {
      archContent = await fs.readFile(archPath, "utf-8");
    } catch (err) {
      return { 
        passed: false, 
        issues: ["ARCHITECTURE.md is required for ArchitectGate verification but could not be read."] 
      };
    }

    const prompt = await this.buildPrompt(context, archContent);
    const activeClient = context.client || this.client;
    
    if (!activeClient) {
      return { passed: true, issues: [], metadata: { skipped: true, promptLength: prompt.length } };
    }

    try {
      const response = await activeClient.fetch("https://api.Alloy.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet",
          messages: [
            { role: "system", content: "You are the Alloy Architecture Inspector. Your job is to verify if code changes comply with the project's ARCHITECTURE.md rules. Return JSON: { \"passed\": boolean, \"issues\": string[] }" },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`LLM Verification failed with status ${response.status}`);
      }

      const result = await response.json() as { passed: boolean; issues: string[] };
      return { 
        passed: result.passed, 
        issues: result.issues.map(i => `[Architecture Violation] ${i}`),
        metadata: { llmVerified: true, promptLength: prompt.length }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { 
        passed: false, 
        issues: [`Architectural LLM verification error: ${msg}`] 
      };
    }
  }

  private async buildPrompt(context: GateContext, archContent: string): Promise<string> {
    return `Verify architectural compliance for the following changes.
    
    ARCHITECTURE RULES:
    ${archContent}
    
    TOUCHED FILES:
    ${context.touchedFiles.join(", ")}
    
    INSTRUCTIONS:
    1. Check if any "Layered Architecture" rules are violated (e.g., UI directly calling Repository).
    2. Check for PII handling violations.
    3. Verify naming conventions.
    
    Respond strictly in JSON format: { "passed": boolean, "issues": string[] }
    `;
  }
}

/**
 * ScopeGate: Prevents modifications and imports outside the defined task scope.
 */
export class ScopeGate implements AutonomousGate {
  name = "ScopeGate";

  async run(context: GateContext) {
    const issues: string[] = [];
    if (context.scopePaths.length === 0) return { passed: true, issues: [] };

    const normalizedScopes = context.scopePaths.map(s => s.replace(/\\/g, "/").replace(/\/+$/, ""));
    const isWithinScope = (relPath: string) => normalizedScopes.some(s => relPath === s || relPath.startsWith(`${s}/`));

    for (const file of context.touchedFiles) {
      const rel = path.relative(context.projectRoot, file).replace(/\\/g, "/");
      if (!isWithinScope(rel)) {
        issues.push(`File outside scope: ${rel}`);
      }
    }

    return { passed: issues.length === 0, issues };
  }
}
