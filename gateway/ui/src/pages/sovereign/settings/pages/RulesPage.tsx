import { useState } from "react";
import { Section, Button } from "../../../../components/sovereign/primitives";
import { Shield, Plus, Trash2 } from "lucide-react";

interface Rule {
  id: string;
  pattern: string;
  action: "block" | "allow" | "log";
}

const ACTION_LABELS: Record<Rule["action"], string> = { block: "Engelle", allow: "Izin ver", log: "Kaydet" };
const ACTION_COLORS: Record<Rule["action"], string> = {
  block: "bg-red-100 text-red-700",
  allow: "bg-green-100 text-green-700",
  log:   "bg-blue-100 text-blue-700",
};

export function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<Rule["action"]>("log");

  function handleAdd() {
    if (!pattern.trim()) return;
    setRules((prev) => [...prev, { id: Date.now().toString(), pattern: pattern.trim(), action }]);
    setPattern("");
  }

  function handleRemove(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Shield size={16} />}
        title="Filtre Kurallari"
        description="Icerik filtresi ve istek kurallari tanimlayin."
      >
        <div className="flex flex-col gap-4 p-4">
          {rules.length > 0 && (
            <div className="flex flex-col divide-y divide-[var(--color-alloy-border)] rounded-xl border border-[var(--color-alloy-border)] overflow-hidden">
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 bg-[var(--color-alloy-bg)]">
                  <span className="flex-1 font-mono text-[12px] text-[var(--color-alloy-text)] truncate">{r.pattern}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ACTION_COLORS[r.action]}`}>
                    {ACTION_LABELS[r.action]}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(r.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-alloy-text-dim)] hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="Kural deseni..."
              className="flex-1 rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-alloy-accent-ring)]"
            />
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as Rule["action"])}
              className="rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-3 py-2 text-[13px] focus:outline-none"
            >
              <option value="log">Kaydet</option>
              <option value="allow">Izin ver</option>
              <option value="block">Engelle</option>
            </select>
            <Button size="sm" onClick={handleAdd} disabled={!pattern.trim()}>
              <Plus size={13} />
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
