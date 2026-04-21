import type { RecoveryNotifier } from "./RecoveryNotifier";
import type { PendingRecoverySummary } from "./RecoveryPrompt";

function encodeMessage(recoveries: PendingRecoverySummary[], gatewayBaseUrl: string): string {
  const lines = ["Alloy startup recovery pending:"];
  for (const recovery of recoveries) {
    lines.push(`- ${recovery.prompt}`);
    lines.push(`  id: ${recovery.missionId}`);
    lines.push(`  state: ${recovery.state} / phase: ${recovery.currentPhase ?? "unknown"}`);
    lines.push(`  resume: ${gatewayBaseUrl}/api/autonomy/recovery/${recovery.missionId}/resume`);
    lines.push(`  cancel: ${gatewayBaseUrl}/api/autonomy/recovery/${recovery.missionId}/cancel`);
  }
  return lines.join("\n");
}

export class TelegramRecoveryNotifier implements RecoveryNotifier {
  public constructor(
    private readonly botToken = process.env.ALLOY_TELEGRAM_BOT_TOKEN ?? "",
    private readonly chatId = process.env.ALLOY_TELEGRAM_CHAT_ID ?? "",
  ) {}

  public async notifyPendingRecoveries(
    recoveries: PendingRecoverySummary[],
    gatewayBaseUrl: string,
  ): Promise<void> {
    if (!this.botToken || !this.chatId || recoveries.length === 0) {
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: encodeMessage(recoveries, gatewayBaseUrl),
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram recovery notifier failed (${response.status})`);
    }
  }
}
