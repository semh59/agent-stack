import type { AgentDefinition } from './agents';
import type { TerminalExecutor } from './terminal-executor';

/**
 * Result of verifying a single command.
 */
export interface CommandVerificationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  durationMs: number;
}

/**
 * Result of validating a required output section.
 */
export interface SectionValidationResult {
  section: string;
  found: boolean;
}

/**
 * Complete verification result for an agent.
 */
export interface VerificationResult {
  agentRole: string;
  passed: boolean;
  commands: CommandVerificationResult[];
  outputValidation: SectionValidationResult[];
  haltTriggered: boolean;
  haltReason?: string;
  timestamp: string;
}

/**
 * VerificationEngine: Physically verifies agent outputs via terminal commands,
 * output section validation, and halt condition checking.
 *
 * This is the "Reality Bridge" â€” it converts agent text output into physical proof.
 */
export class VerificationEngine {
  private terminal: TerminalExecutor;

  constructor(terminal: TerminalExecutor) {
    this.terminal = terminal;
  }

  /**
   * Verify an agent's output using its definition's verification rules.
   *
   * Steps:
   * 1. Run all verificationCommands (exit 0 = pass)
   * 2. Validate outputValidation sections exist in output
   * 3. Check haltConditions against command results
   */
  async verify(agent: AgentDefinition, output: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      agentRole: agent.role,
      passed: true,
      commands: [],
      outputValidation: [],
      haltTriggered: false,
      timestamp: new Date().toISOString(),
    };

    const fullStdoutMap = new Map<string, string>();
    const fullStderrMap = new Map<string, string>();

    // 1. Run verification commands
    if (agent.verificationCommands && agent.verificationCommands.length > 0) {
      for (const cmd of agent.verificationCommands) {
        const cmdResult = await this.terminal.run(cmd);
        
        fullStdoutMap.set(cmd, cmdResult.stdout);
        fullStderrMap.set(cmd, cmdResult.stderr);

        const cmdVerification: CommandVerificationResult = {
          command: cmd,
          exitCode: cmdResult.exitCode,
          stdout: cmdResult.stdout.slice(0, 2000),
          stderr: cmdResult.stderr.slice(0, 2000),
          passed: cmdResult.success,
          durationMs: cmdResult.durationMs,
        };
        result.commands.push(cmdVerification);

        if (!cmdResult.success) {
          result.passed = false;
        }
      }
    }

    // 2. Validate output sections
    if (agent.outputValidation && agent.outputValidation.length > 0) {
      result.outputValidation = this.validateOutputSections(output, agent.outputValidation);
      // Missing sections are captured in result.outputValidation and log formatting.
      // Avoid noisy runtime warnings for non-failing heuristic checks.
    }

    // 3. Check halt conditions using FULL command outputs
    if (agent.haltConditions && agent.haltConditions.length > 0) {
      const fullOutputs = result.commands.map(cmd => ({
        ...cmd,
        stdout: fullStdoutMap.get(cmd.command) || cmd.stdout,
        stderr: fullStderrMap.get(cmd.command) || cmd.stderr
      }));

      const haltCheck = VerificationEngine.checkHaltConditions(output, fullOutputs, agent.haltConditions);
      if (haltCheck.halt) {
        result.haltTriggered = true;
        result.haltReason = haltCheck.reason;
        result.passed = false;
      }
    }

    return result;
  }

  /**
   * Validate that required sections exist in the agent's output.
   * Uses case-insensitive search for section headers or keywords.
   */
  private validateOutputSections(
    output: string,
    requiredSections: string[]
  ): SectionValidationResult[] {
    const lowerOutput = output.toLowerCase();

    return requiredSections.map(section => {
      const lowerSection = section.toLowerCase();
      // Check for markdown headers (# Section, ## Section) or plain text
      const found =
        lowerOutput.includes(`# ${lowerSection}`) ||
        lowerOutput.includes(`## ${lowerSection}`) ||
        lowerOutput.includes(`### ${lowerSection}`) ||
        lowerOutput.includes(`**${lowerSection}**`) ||
        lowerOutput.includes(lowerSection);

      return { section, found };
    });
  }

  /**
   * Check if any halt conditions are triggered.
   * Analyzes both the agent output text and command results for indicators.
   */
  public static checkHaltConditions(
    output: string,
    commandResults: CommandVerificationResult[],
    conditions: string[]
  ): { halt: boolean; reason?: string } {
    const lowerOutput = output.toLowerCase();
    const allStderr = commandResults.map(c => c.stderr.toLowerCase()).join('\n');
    const allStdout = commandResults.map(c => c.stdout.toLowerCase()).join('\n');
    const combined = `${lowerOutput}\n${allStderr}\n${allStdout}`;

    for (const condition of conditions) {
      const lowerCondition = condition.toLowerCase();

      // Check for critical/high severity indicators
      if (lowerCondition.includes('critical') && lowerCondition.includes('vulnerability')) {
        const negativePatterns = [
          /no\s+critical\s+vulnerabilit/i,
          /0\s+critical\s+vulnerabilit/i,
          /zero\s+critical\s+vulnerabilit/i,
          /critical\s+vulnerabilit.*not\s+found/i,
          /no\s+vulnerabilities\s+found/i,
          /found\s+0\s+(vulnerability|vulnerabilities)/i,
        ];
        
        const hasNegativeMatch = negativePatterns.some(p => p.test(combined));
        
        if (!hasNegativeMatch && 
            combined.includes('critical') &&
            (combined.includes('vulnerability') || combined.includes('vulnerabilities'))) {
          return { halt: true, reason: condition };
        }
      }

      // Check for secret/API key leak
      if (lowerCondition.includes('secret') || lowerCondition.includes('api key')) {
        const negativePatterns = [
          /no\s+secret\s+found/i,
          /no\s+api\s+key\s+found/i,
          /0\s+secret/i,
        ];

        const hasNegativeMatch = negativePatterns.some(p => p.test(combined));

        if (!hasNegativeMatch && (
            combined.includes('secret') && combined.includes('found') ||
            combined.includes('api key') && combined.includes('detected') ||
            combined.includes('leak') && combined.includes('detected')
        )) {
          return { halt: true, reason: condition };
        }
      }

      // Check for production deployment halt
      if (lowerCondition.includes('production') && lowerCondition.includes('human')) {
        const negativePatterns = [
          /not\s+a\s+production\s+deploy/i,
          /dry-run/i,
        ];

        const hasNegativeMatch = negativePatterns.some(p => p.test(combined));

        if (!hasNegativeMatch && combined.includes('production') && combined.includes('deploy')) {
          return { halt: true, reason: condition };
        }
      }
    }

    return { halt: false };
  }

  /**
   * Format verification result as a human-readable log entry.
   */
  formatAsLog(result: VerificationResult): string {
    const lines: string[] = [
      `=== VERIFICATION: ${result.agentRole} ===`,
      `Status: ${result.passed ? 'âœ… PASSED' : 'âŒ FAILED'}`,
      `Timestamp: ${result.timestamp}`,
    ];

    if (result.commands.length > 0) {
      lines.push('', 'Commands:');
      for (const cmd of result.commands) {
        const icon = cmd.passed ? 'âœ…' : 'âŒ';
        lines.push(`  ${icon} ${cmd.command} (exit ${cmd.exitCode}, ${cmd.durationMs}ms)`);
        if (!cmd.passed && cmd.stderr) {
          lines.push(`     Error: ${cmd.stderr.slice(0, 200)}`);
        }
      }
    }

    if (result.outputValidation.length > 0) {
      lines.push('', 'Output Sections:');
      for (const section of result.outputValidation) {
        const icon = section.found ? 'âœ…' : 'âš ï¸';
        lines.push(`  ${icon} ${section.section}`);
      }
    }

    if (result.haltTriggered) {
      lines.push('', `ğŸ›‘ HALT TRIGGERED: ${result.haltReason}`);
    }

    return lines.join('\n');
  }
}
