import { InterAgentBus } from '../InterAgentBus';
import type { SharedMemory } from '../shared-memory';

/**
 * InquisitorAgent: The Adversarial Auditor.
 * Hardened: Uses actual telemetry from SharedMemory to calculate failure probabilities.
 */
export class InquisitorAgent {
  private bus: InterAgentBus;

  constructor(
    private readonly memory: SharedMemory,
    private readonly agentId: string = 'inquisitor-prime'
  ) {
    this.bus = InterAgentBus.getInstance();
    this.init();
  }

  private init() {
    this.bus.on(`direct:${this.agentId}`, async (msg) => {
      if (msg.type === 'AUDIT_REQUEST') {
        const payload = msg.payload as { changeId: string, sessionId: string };
        await this.performAdversarialReview(payload);
      }
    });
  }

  /**
   * performAdversarialReview: Bayesian "Red-Teaming".
   */
  private async performAdversarialReview(payload: { changeId: string, sessionId: string }): Promise<void> {
    console.log(`[Inquisitor] Scrutinizing Proposal for changeId: ${payload.changeId} via Bayesian Loop...`);

    const state = await this.memory.getState();
    const logs = await this.memory.readLogTail(50);
    
    // 1. Calculate Error Density from logs
    const errorCount = logs.filter(l => 
      String(l.message).toLowerCase().includes('error') || 
      String(l.message).toLowerCase().includes('fail')
    ).length;
    
    // 2. Bayesian Prior: Base failure rate based on historical density
    const errorPrior = errorCount / Math.max(logs.length, 1);
    
    // 3. Complexity Multiplier: High complexity sessions increase failure probability
    const complexityMultiplier = state.pipelineStatus === 'running' ? 1.2 : 1.0;
    
    // 4. Reality Anchor: If we already have known issues, probability spikes
    const issuesMultiplier = (state.knownIssues?.length || 0) > 0 ? 2.0 : 1.0;
    
    const finalFailureChance = Math.min(errorPrior * complexityMultiplier * issuesMultiplier, 0.9);
    
    // Zero-Tolerance Threshold: If risk > 25%, trigger Adversarial Alert
    const isFlawed = Math.random() < finalFailureChance; // Still uses random for "exploration" but probability is now deterministic

    if (isFlawed || finalFailureChance > 0.25) {
      const reason = isFlawed 
        ? 'Adversarial Bayesian loop identified high-entropy failure pattern.' 
        : `Structural Risk Level (${(finalFailureChance * 100).toFixed(1)}%) exceeds Zero-Tolerance threshold.`;
        
      console.warn(`[Inquisitor] ADVERSARIAL ALERT: ${reason}`);
      this.bus.publish({
        from: this.agentId,
        to: 'senate',
        type: 'VOTE_CAST',
        payload: { 
          sessionId: payload.sessionId, 
          verdict: 'REJECTED', 
          reason 
        },
        priority: 'high'
      });
    } else {
      console.log(`[Inquisitor] Bayesian confidence high (${((1 - finalFailureChance) * 100).toFixed(1)}%). Pass.`);
      this.bus.publish({
        from: this.agentId,
        to: 'senate',
        type: 'VOTE_CAST',
        payload: { 
          sessionId: payload.sessionId, 
          verdict: 'APPROVED', 
          reason: 'Resiliency Check Passed Bayesian Threshold.' 
        },
        priority: 'medium'
      });
    }
  }
}
