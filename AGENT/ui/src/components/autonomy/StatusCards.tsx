import type { AutonomySessionSummary } from "../../store/types";

const PHASE_LABELS: Record<string, string> = {
  queued: "Kuyruk",
  init: "Hazirlaniyor",
  plan: "Planlama",
  execute: "Uygulama",
  verify: "Dogrulama",
  reflect: "Degerlendirme",
  retry: "Kurtarma",
  paused: "Beklemede",
  done: "Tamamlandi",
  failed: "Basarisiz",
  stopped: "Durduruldu",
};

const PHASE_NOTES: Record<string, string> = {
  queued: "Oturum scheduler sirasi bekliyor.",
  init: "Oturum ortami ve git baglami kuruluyor.",
  plan: "Plan artifact ve model karari uretiliyor.",
  execute: "Onayli adimlar aktif olarak uygulaniyor.",
  verify: "Gate ve kalite kontrolleri calisiyor.",
  reflect: "Sonuc ve sonraki adim degerlendiriliyor.",
  retry: "Kurtarma dongusu bir sonraki denemeyi hazirliyor.",
  paused: "Akis dis bir karar ya da kontrol noktasi bekliyor.",
  done: "Mission basariyla tamamlandi.",
  failed: "Mission terminal hata ile sonlandi.",
  stopped: "Mission operator karariyla durduruldu.",
};

function formatGear(gear: AutonomySessionSummary["currentGear"]): string {
  switch (gear) {
    case "fast":
      return "Fast";
    case "elite":
      return "Elite";
    case "standard":
    default:
      return "Standard";
  }
}

function cardClasses(): string {
  return "rounded-2xl border border-white/10 bg-black/30 p-4 shadow-xl backdrop-blur-sm";
}

export function PhaseStatusCard({ session }: { session: AutonomySessionSummary | null }) {
  const label = session ? PHASE_LABELS[session.state] ?? session.state : "Hazirlaniyor";
  const note = session ? PHASE_NOTES[session.state] ?? "Mission durumu guncelleniyor." : "Aktif session verisi bekleniyor.";

  return (
    <section className={cardClasses()} aria-label="Faz gostergesi karti">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--color-loji-text-sec)]">
          Faz Gostergesi
        </span>
        <span className="rounded-full border border-[var(--color-loji-accent)]/30 bg-[var(--color-loji-accent)]/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[var(--color-loji-accent)]">
          {label}
        </span>
      </div>
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-loji-text-sec)]">{note}</p>
    </section>
  );
}

export function GearStatusCard({ session }: { session: AutonomySessionSummary | null }) {
  const gear = formatGear(session?.currentGear ?? null);
  const model = session?.currentModel ?? "Model bekleniyor";

  return (
    <section className={cardClasses()} aria-label="Disli durumu karti">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--color-loji-text-sec)]">
          Disli Durumu
        </span>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
          {gear}
        </span>
      </div>
      <p className="text-sm font-semibold text-white">{gear}</p>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-loji-text-sec)]">{model}</p>
    </section>
  );
}
