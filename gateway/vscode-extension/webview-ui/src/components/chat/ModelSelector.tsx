import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/store/chatStore";
import type { ModelInfo } from "@/lib/vscode";

type Tier = "Hızlı" | "Akıllı" | "Dengeli" | "Güçlü";
interface ModelMeta { tier: Tier; cost: string; dotColor: string; tierColor: string }

function getModelMeta(model: ModelInfo): ModelMeta {
  const id = model.id.toLowerCase();
  const p  = model.provider.toLowerCase();

  let dotColor = "var(--a-accent)";
  if (p.includes("openai"))    dotColor = "#4ade80";
  if (p.includes("anthropic")) dotColor = "var(--a-accent)";
  if (p.includes("google"))    dotColor = "#60a5fa";
  if (p.includes("meta"))      dotColor = "#c084fc";
  if (p.includes("mistral"))   dotColor = "#22d3ee";

  if (id.includes("opus") || id.includes("ultra") || id.includes("gpt-4o"))
    return { tier: "Güçlü",   cost: "$$$", dotColor, tierColor: "#a78bfa" };
  if (id.includes("haiku") || id.includes("flash") || id.includes("mini") || id.includes("nano"))
    return { tier: "Hızlı",   cost: "$",   dotColor, tierColor: "var(--a-success)" };
  if (id.includes("sonnet") || id.includes("pro") || id.includes("gpt-4"))
    return { tier: "Akıllı",  cost: "$$",  dotColor, tierColor: "var(--a-accent)" };
  return   { tier: "Dengeli", cost: "$$",  dotColor, tierColor: "var(--a-text2)" };
}

const tierIcon: Record<Tier, string> = {
  "Güçlü":   "✦",
  "Akıllı":  "⚡",
  "Hızlı":   "⚡",
  "Dengeli": "◎",
};

export function ModelSelector() {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const ref      = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { availableModels, selectedModel, setSelectedModel } = useChatStore();
  const currentModel = availableModels.find((m) => m.id === selectedModel);
  const currentMeta  = currentModel ? getModelMeta(currentModel) : null;

  const filtered = availableModels.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.provider.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0 }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "4px 8px", borderRadius: 6, cursor: "pointer",
          border: `1px solid ${open ? "var(--a-accent)" : "var(--a-border)"}`,
          background: open ? "var(--a-accent-s)" : "var(--a-bg2)",
          color: "var(--a-text)", fontSize: 11, fontWeight: 500,
          maxWidth: 140,
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: currentMeta ? currentMeta.dotColor : "var(--a-text3)",
        }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {currentModel?.name ?? "Model seç"}
        </span>
        <span style={{ flexShrink: 0, color: "var(--a-text3)", transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: 6,
          zIndex: 50, minWidth: 220, maxWidth: "min(280px, calc(100vw - 24px))",
          background: "var(--a-bg2)", border: "1px solid var(--a-border)",
          borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden",
        }}>
          {/* Search */}
          <div style={{ padding: 8, borderBottom: "1px solid var(--a-border)" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 10px", background: "var(--a-bg)", border: "1px solid var(--a-border)",
              borderRadius: 6,
            }}>
              <span style={{ color: "var(--a-text3)", fontSize: 11 }}>🔍</span>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Model ara…"
                style={{
                  flex: 1, minWidth: 0, background: "transparent",
                  border: "none", outline: "none", fontSize: 12,
                  color: "var(--a-text)",
                }}
              />
            </div>
          </div>

          {/* List */}
          <div style={{ maxHeight: 208, overflowY: "auto", padding: 6 }}>
            {Object.entries(grouped).map(([provider, models]) => (
              <div key={provider} style={{ marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px" }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: getModelMeta(models[0]).dotColor,
                  }} />
                  <span style={{ fontSize: 9, fontWeight: 600, color: "var(--a-text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{provider}</span>
                </div>

                {models.map((model) => {
                  const meta = getModelMeta(model);
                  const selected = model.id === selectedModel;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => { setSelectedModel(model.id); setOpen(false); setSearch(""); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 8px", borderRadius: 6, textAlign: "left",
                        border: "none", cursor: "pointer",
                        background: selected ? "var(--a-accent-s)" : "transparent",
                      }}
                    >
                      <div style={{
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: selected ? "var(--a-accent)" : "var(--a-bg3)",
                        color: selected ? "white" : "var(--a-text3)", fontSize: 11,
                      }}>
                        {tierIcon[meta.tier]}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                          <span style={{
                            fontSize: 12, fontWeight: 500,
                            color: selected ? "var(--a-accent)" : "var(--a-text)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {model.name}
                          </span>
                          <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--a-text3)", flexShrink: 0 }}>{meta.cost}</span>
                        </div>
                        <span style={{ fontSize: 10, color: meta.tierColor }}>{meta.tier}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}

            {filtered.length === 0 && (
              <div style={{ padding: "24px 0", textAlign: "center", fontSize: 11, color: "var(--a-text3)" }}>
                {availableModels.length === 0 ? "Bağlantı bekleniyor…" : "Model bulunamadı"}
              </div>
            )}
          </div>

          {/* Footer */}
          {availableModels.length > 0 && (
            <div style={{ padding: "4px 12px", borderTop: "1px solid var(--a-border)", background: "var(--a-bg2)" }}>
              <span style={{ fontSize: 9, color: "var(--a-text3)" }}>{availableModels.length} model mevcut</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
