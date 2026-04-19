import type { MissionModel } from "../../models/mission.model";

export interface PendingRecoverySummary {
  missionId: string;
  prompt: string;
  state: MissionModel["state"];
  currentPhase: MissionModel["currentPhase"];
  currentGear: MissionModel["currentGear"];
  interruptedAt: string;
  touchedFiles: string[];
  reviewStatus: MissionModel["reviewStatus"];
  message: string;
}

function phaseLabel(phase: MissionModel["currentPhase"]): string {
  switch (phase) {
    case "queued":
      return "Kuyruk";
    case "init":
      return "Hazirlaniyor";
    case "plan":
      return "Planlama";
    case "execute":
      return "Uygulama";
    case "verify":
      return "Dogrulama";
    case "reflect":
      return "Degerlendirme";
    case "retry":
      return "Kurtarma";
    case "paused":
      return "Beklemede";
    case "done":
      return "Tamamlandi";
    case "failed":
      return "Basarisiz";
    case "stopped":
      return "Durduruldu";
    case null:
      return "Bilinmiyor";
  }
}

function gearLabel(gear: MissionModel["currentGear"]): string {
  if (!gear) {
    return "gear bilinmiyor";
  }
  return gear;
}

export function buildPendingRecoverySummary(mission: MissionModel): PendingRecoverySummary {
  const touchedFiles = mission.touchedFiles.slice(0, 5);
  const message = [
    "Yarim kalan mission bulundu:",
    "",
    `Mission: "${mission.prompt}"`,
    `Son durum: ${phaseLabel(mission.currentPhase)} - ${gearLabel(mission.currentGear)}`,
    `Kesilme zamani: ${mission.updatedAt}`,
    `Dokunulan dosyalar: ${touchedFiles.length > 0 ? touchedFiles.join(", ") : "Yok"}`,
  ].join("\n");

  return {
    missionId: mission.id,
    prompt: mission.prompt,
    state: mission.state,
    currentPhase: mission.currentPhase,
    currentGear: mission.currentGear,
    interruptedAt: mission.updatedAt,
    touchedFiles: [...mission.touchedFiles],
    reviewStatus: mission.reviewStatus,
    message,
  };
}

export function formatRecoveryPrompt(mission: MissionModel): string {
  return buildPendingRecoverySummary(mission).message;
}
