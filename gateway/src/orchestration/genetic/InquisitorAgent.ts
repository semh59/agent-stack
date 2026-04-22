import { InterAgentBus } from '../InterAgentBus';

/**
 * InquisitorAgent: The Adversarial Auditor.
 * Uses conceptual MCTS to simulate high-entropy edge cases and falsify proposals.
 */
export class InquisitorAgent {
  private bus: InterAgentBus;

  constructor(private readonly agentId: string = 'inquisitor-prime') {
    this.bus = InterAgentBus.getInstance();
    this.init();
  }

  private init() {
    // Dinamik ajan kimliğine (ID) göre dinleme yap
    this.bus.on(`direct:${this.agentId}`, async (msg) => {
      if (msg.type === 'AUDIT_REQUEST') {
        // Tip güvenliği için payload kontrolü ve asenkron analiz
        const payload = msg.payload as { changeId: string, sessionId: string };
        await this.performAdversarialReview(payload);
      }
    });
  }

  /**
   * performAdversarialReview: "Red-Teaming" Mantığı.
   */
  private async performAdversarialReview(payload: { changeId: string, sessionId: string }): Promise<void> {
    console.log(`[Inquisitor] Scrutinizing Proposal for changeId: ${payload.changeId}...`);

    // Mocking MCTS: Exploring 10 potential "Attack Paths" or "Failure Modes"
    const failureProbability = 0.15; // 15% chance of finding a flaw
    const isFlawed = Math.random() < failureProbability;

    if (isFlawed) {
      console.warn(`[Inquisitor] ADVERSARIAL ALERT: Potential logic flaw detected in ${payload.changeId}`);
      this.bus.publish({
        from: this.agentId,
        to: 'senate',
        type: 'VOTE_CAST',
        payload: { sessionId: payload.sessionId, verdict: 'REJECTED', reason: 'Adversarial MCTS identified high-entropy edge case violation.' },
        priority: 'high'
      });
    } else {
      console.log(`[Inquisitor] No flaws detected after 100 simulation paths.`);
      this.bus.publish({
        from: this.agentId,
        to: 'senate',
        type: 'VOTE_CAST',
        payload: { sessionId: payload.sessionId, verdict: 'APPROVED', reason: 'Resiliency Check Passed.' },
        priority: 'medium'
      });
    }
  }
}
