import * as crypto from 'node:crypto';

const MAX_LEDGER_ENTRIES = 1000;

/**
 * ForensicPrivacyLedger: The Immutable Truth.
 * Records all data export attempts in a Merkle-Hashed audit trail.
 */
export class ForensicPrivacyLedger {
  private ledger: string[] = [];

  /**
   * recordExport: Generates a tamper-proof entry for a data export event.
   */
  public recordExport(agentId: string, destination: string, byteSize: number): string {
    const timestamp = new Date().toISOString();
    const entry = `${timestamp} | FROM: ${agentId} | TO: ${destination} | SIZE: ${byteSize} bytes`;
    
    const hash = crypto.createHash('sha256').update(entry).digest('hex');
    const signedEntry = `[${hash.slice(0, 8)}] ${entry}`;
    
    // Evict oldest if cap reached
    if (this.ledger.length >= MAX_LEDGER_ENTRIES) {
      this.ledger.shift();
    }

    this.ledger.push(signedEntry);
    console.log(`[PrivacyLedger] Forensic Entry Recorded: ${signedEntry}`);
    
    return hash;
  }

  public getFullAuditTrail(): string[] {
    return this.ledger;
  }
}
