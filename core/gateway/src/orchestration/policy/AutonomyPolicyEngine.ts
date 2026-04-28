export type PolicyAction = 'ALLOW' | 'PAUSE' | 'BLOCK';

export interface PolicyViolation {
  ruleId: string;
  action: PolicyAction;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface PolicyContext {
  toolName: string;
  args: Record<string, unknown>;
  confidence: number;
  filePath?: string;
  command?: string;
}

export interface AutonomyPolicy {
  id: string;
  name: string;
  evaluate(context: PolicyContext): PolicyViolation | null;
}

/**
 * AutonomyPolicyEngine: The high-fidelity safety and oversight controller.
 * Manages a set of rules that trigger "Session Freeze" or "Surgical Intervention".
 */
export class AutonomyPolicyEngine {
  private readonly policies: AutonomyPolicy[] = [];

  constructor() {
    this.registerDefaultPolicies();
  }

  public registerPolicy(policy: AutonomyPolicy): void {
    this.policies.push(policy);
  }

  public evaluate(context: PolicyContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    for (const policy of this.policies) {
      const violation = policy.evaluate(context);
      if (violation) {
        violations.push(violation);
      }
    }
    return violations;
  }

  private registerDefaultPolicies(): void {
    // 1. Destructive Command Policy
    this.registerPolicy({
      id: 'block-destructive',
      name: 'Destructive Command Guard',
      evaluate: (ctx) => {
        if (ctx.toolName === 'run_command' && ctx.command) {
          const dangerousTerms = ['rm ', 'del ', 'rf ', 'reset --hard', 'drop table'];
          const lowerCmd = ctx.command.toLowerCase();
          if (dangerousTerms.some(term => lowerCmd.includes(term))) {
            return {
              ruleId: 'block-destructive',
              action: 'PAUSE',
              reason: `Potentially destructive command detected: "${ctx.command}"`,
              severity: 'high'
            };
          }
        }
        return null;
      }
    });

    // 2. Protected Path Policy
    this.registerPolicy({
      id: 'protected-paths',
      name: 'Protected Filesystem Guard',
      evaluate: (ctx) => {
        if (ctx.filePath) {
          const protectedPatterns = ['.env', 'package-lock.json', 'node_modules', '.git', 'gateway/src/core'];
          if (protectedPatterns.some(p => ctx.filePath!.includes(p))) {
            return {
              ruleId: 'protected-paths',
              action: 'PAUSE',
              reason: `Modification of protected path requested: ${ctx.filePath}`,
              severity: 'medium'
            };
          }
        }
        return null;
      }
    });

    // 3. Confidence Threshold Policy
    this.registerPolicy({
      id: 'confidence-gate',
      name: 'Reasoning Confidence Gate',
      evaluate: (ctx) => {
        if (ctx.confidence < 0.85) {
          return {
            ruleId: 'confidence-gate',
            action: 'PAUSE',
            reason: `Agent confidence score (${(ctx.confidence * 100).toFixed(1)}%) is below safety threshold (85%).`,
            severity: 'medium'
          };
        }
        return null;
      }
    });

    // 4. [NEW] Semantic Intent Guard
    this.registerPolicy({
      id: 'intent-alignment',
      name: 'Semantic Objective Alignment',
      evaluate: (ctx) => {
        // This is a placeholder for the Shadow Validator.
        // It will be triggered by SequentialPipeline if Semantic Verification is enabled.
        if (ctx.args._semanticViolation) {
          return {
            ruleId: 'intent-alignment',
            action: 'BLOCK',
            reason: `Semantic Mismatch: Proposed action deviates from high-level project goals.`,
            severity: 'high'
          };
        }
        return null;
      }
    });
  }

  /**
   * Performs an asynchronous shadow check using an LLM to verify intent.
   * This is the "Above Vision" deep oversight layer.
   */
  public async verifySemanticIntent(
    reasoning: string, 
    proposedAction: string, 
    userGoal: string,
    evaluator: (prompt: string) => Promise<string>
  ): Promise<PolicyViolation | null> {
    const prompt = `
      [SHADOW VALIDATOR]
      User Goal: ${userGoal}
      Agent Reasoning: ${reasoning}
      Proposed Action: ${proposedAction}
      
      Verify if the action follows the goal and doesn't introduce unrequested changes.
      Respond with "PASS" or "FAIL: [reason]".
    `;
    
    const result = await evaluator(prompt);
    if (result.startsWith('FAIL')) {
      return {
        ruleId: 'intent-alignment',
        action: 'BLOCK',
        reason: result.split(':')[1]?.trim() || 'Semantic validation failed',
        severity: 'high'
      };
    }
    return null;
  }
}

export const autonomyPolicyEngine = new AutonomyPolicyEngine();
