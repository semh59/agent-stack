/**
 * MissionLaunchpad — quick-launch panel for creating new pipeline missions.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Plus, Loader2 } from "lucide-react";
import { useAppStore } from "../../store/appStore";

const TEMPLATES = [
  { id: "analyze",  label: "Analiz et",     description: "Verileri veya belgeleri incele" },
  { id: "generate", label: "Uret",          description: "Icerik veya kod olustur" },
  { id: "research", label: "Arastir",       description: "Bir konuyu derinlemesine incele" },
  { id: "automate", label: "Otomatiklestir", description: "Tekrar eden gorevi yonet" },
];

export function MissionLaunchpad() {
  const navigate = useNavigate();
  const { activeAccount } = useAppStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [launching, setLaunching] = useState(false);

  async function handleLaunch() {
    if (!goal.trim()) return;
    setLaunching(true);
    try {
      await new Promise((r) => setTimeout(r, 800));
      navigate("/pipeline/active");
    } finally {
      setLaunching(false);
    }
  }

  if (!activeAccount) {
    return (
      <div className="rounded-2xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] p-6 flex flex-col items-center gap-3 text-center">
        <Zap size={24} className="text-[var(--color-alloy-text-dim)]" />
        <p className="text-[13px] text-[var(--color-alloy-text-sec)]">
          Gorev baslatmak icin once bir hesap baglayin.
        </p>
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="rounded-lg bg-[var(--color-alloy-accent)] px-4 py-2 text-[12px] font-medium text-white hover:bg-[var(--color-alloy-accent-hover)] transition-colors"
        >
          Hesap ekle
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-alloy-border)] px-5 py-4">
        <Zap size={16} className="text-[var(--color-alloy-accent)]" />
        <span className="font-semibold text-[14px] text-[var(--color-alloy-text)]">Yeni Gorev</span>
      </div>

      <div className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id === selected ? null : t.id)}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                selected === t.id
                  ? "border-[var(--color-alloy-accent)] bg-[var(--color-alloy-accent-dim)]"
                  : "border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] hover:border-[var(--color-alloy-accent)] hover:bg-[var(--color-alloy-accent-dim)]"
              }`}
            >
              <span className="text-[12px] font-semibold text-[var(--color-alloy-text)]">{t.label}</span>
              <span className="text-[11px] text-[var(--color-alloy-text-sec)]">{t.description}</span>
            </button>
          ))}
        </div>

        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Gorevi aciklayin..."
          rows={3}
          className="w-full resize-none rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-3 py-2.5 text-[13px] text-[var(--color-alloy-text)] placeholder:text-[var(--color-alloy-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-alloy-accent-ring)] transition-shadow"
        />

        <button
          type="button"
          onClick={() => void handleLaunch()}
          disabled={!goal.trim() || launching}
          className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-alloy-accent)] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[var(--color-alloy-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {launching ? (
            <><Loader2 size={14} className="animate-spin" />Baslatiliyor...</>
          ) : (
            <><Plus size={14} />Gorevi Baslat</>
          )}
        </button>
      </div>
    </div>
  );
}
