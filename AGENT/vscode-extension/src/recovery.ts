import * as vscode from "vscode";
import { BridgeManager } from "./BridgeManager";

interface RecoverySummary {
  missionId: string;
  message: string;
}

const DEFAULT_GATEWAY_BASE = "http://127.0.0.1:51122";
let activeRecoveryRun: Promise<void> | null = null;

async function fetchPendingRecoveries(
  gatewayBaseUrl: string,
  authToken: string,
): Promise<RecoverySummary[]> {
  const response = await fetch(`${gatewayBaseUrl}/api/autonomy/recovery/pending`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { data?: RecoverySummary[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

async function postDecision(
  gatewayBaseUrl: string,
  authToken: string,
  missionId: string,
  action: "resume" | "cancel",
): Promise<void> {
  await fetch(`${gatewayBaseUrl}/api/autonomy/recovery/${encodeURIComponent(missionId)}/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
}

export function runStartupRecoveryFlow(
  authToken: string | null | undefined,
  bridgeManager?: BridgeManager,
  gatewayBaseUrl = DEFAULT_GATEWAY_BASE,
): Promise<void> {
  if (!authToken) {
    return Promise.resolve();
  }

  if (activeRecoveryRun) {
    return activeRecoveryRun;
  }

  activeRecoveryRun = (async () => {
    try {
      // Phase 1: Bridge Health (Axis 7 integration)
      if (bridgeManager) {
        const bridgeOk = await bridgeManager.checkHealth();
        if (!bridgeOk) {
          const choice = await vscode.window.showWarningMessage(
            "Optimization bridge is not responding. Token savings will be disabled.",
            "Start Bridge",
            "Continue Without"
          );
          if (choice === "Start Bridge") {
            await bridgeManager.start();
          }
        }
      }

      // Phase 2: Gateway / Autonomy Recovery
      const recoveries = await fetchPendingRecoveries(gatewayBaseUrl, authToken);
      for (const recovery of recoveries) {
        const choice = await vscode.window.showWarningMessage(
          recovery.message,
          { modal: true },
          "Devam Et",
          "Iptal Et",
        );

        if (choice === "Devam Et") {
          await postDecision(gatewayBaseUrl, authToken, recovery.missionId, "resume");
        } else if (choice === "Iptal Et") {
          await postDecision(gatewayBaseUrl, authToken, recovery.missionId, "cancel");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`LojiNext recovery check failed: ${message}`);
    } finally {
      activeRecoveryRun = null;
    }
  })();

  return activeRecoveryRun;
}
