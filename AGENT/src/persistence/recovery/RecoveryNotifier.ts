import type { PendingRecoverySummary } from "./RecoveryPrompt";

export interface RecoveryNotifier {
  notifyPendingRecoveries(recoveries: PendingRecoverySummary[], gatewayBaseUrl: string): Promise<void>;
}

export class NoopRecoveryNotifier implements RecoveryNotifier {
  public async notifyPendingRecoveries(): Promise<void> {
    // Intentionally empty.
  }
}
