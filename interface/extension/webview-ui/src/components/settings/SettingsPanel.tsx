/* ═══════════════════════════════════════════════════════════════════
   Alloy SettingsPanel — API keys, gateway config, preferences
   ═══════════════════════════════════════════════════════════════════ */
import { useState, useCallback } from "react";
import { useChatStore } from "@/store/chatStore";
import type { OutgoingMessage } from "@/lib/vscode";

interface Props { postMessage: (msg: OutgoingMessage) => void; }

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
      <span style={{ color: "var(--a-text3)", fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: "var(--a-text3)" }}>
        {title}
      </span>
    </div>
  );
}

function InputRow({
  label, value, onChange, placeholder, type = "text", hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: "text" | "password"; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const inputType = type === "password" && !show ? "password" : "text";

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--a-text2)", marginBottom: 4 }}>
        {label}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%", padding: type === "password" ? "6px 28px 6px 10px" : "6px 10px",
            borderRadius: 5, border: "1px solid var(--a-border)",
            background: "var(--a-bg)", color: "var(--a-text)", fontSize: 12,
            outline: "none", boxSizing: "border-box" as const,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--a-accent)"; }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--a-border)"; }}
        />
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            style={{
              position: "absolute", right: 6, background: "none", border: "none",
              cursor: "pointer", color: "var(--a-text3)", fontSize: 13, padding: 0,
              lineHeight: 1,
            }}
          >
            {show ? "◯" : "●"}
          </button>
        )}
      </div>
      {hint && (
        <p style={{ marginTop: 4, fontSize: 10, color: "var(--a-text3)", lineHeight: 1.5 }}>{hint}</p>
      )}
    </div>
  );
}

export function SettingsPanel({ postMessage }: Props) {
  const { availableModels } = useChatStore();
  const [anthropicKey, setAnthropicKey] = useState("");
  const [gatewayUrl, setGatewayUrl]     = useState("http://127.0.0.1:51122");
  const [saved, setSaved]               = useState(false);
  const [saveError, setSaveError]       = useState("");

  const handleSave = useCallback(() => {
    if (!anthropicKey && !gatewayUrl) return;
    try {
      postMessage({ type: "saveSettings", value: JSON.stringify({ anthropicKey, gatewayUrl }) });
      setSaved(true);
      setSaveError("");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError("Kaydedilemedi — VS Code'u yeniden başlatın.");
    }
  }, [anthropicKey, gatewayUrl, postMessage]);

  const modelCount = availableModels.length;
  const canSave    = !!anthropicKey || gatewayUrl !== "http://127.0.0.1:51122";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--a-bg)", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid var(--a-border)", flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--a-text)" }}>Ayarlar</h2>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 12px 16px" }}>

        {/* Claude / Anthropic */}
        <section style={{ marginBottom: 16 }}>
          <SectionHeader icon="🔑" title="Claude · Anthropic" />
          <div style={{ borderRadius: 6, border: "1px solid var(--a-border)", background: "var(--a-bg2)", padding: "10px 12px" }}>
            <InputRow
              label="API Key"
              value={anthropicKey}
              onChange={setAnthropicKey}
              placeholder="sk-ant-api…"
              type="password"
              hint="VS Code ayarlarına kaydedilir. console.anthropic.com'dan alın."
            />
            <a
              href="https://console.anthropic.com/settings/keys"
              style={{ fontSize: 10, color: "var(--a-accent)", textDecoration: "none" }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
            >
              Anthropic Console'u aç ↗
            </a>
          </div>
        </section>

        {/* Gateway */}
        <section style={{ marginBottom: 16 }}>
          <SectionHeader icon="⚡" title="Gateway Sunucusu" />
          <div style={{ borderRadius: 6, border: "1px solid var(--a-border)", background: "var(--a-bg2)", padding: "10px 12px" }}>
            <InputRow
              label="Gateway URL"
              value={gatewayUrl}
              onChange={setGatewayUrl}
              placeholder="http://127.0.0.1:51122"
              hint="Varsayılan: http://127.0.0.1:51122 — Google bağlanmadan önce başlatın."
            />
            <div style={{ borderRadius: 5, background: "var(--a-bg3)", padding: "6px 8px" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 500, color: "var(--a-text2)" }}>Sunucuyu başlatmak için:</p>
              <code style={{ fontSize: 10, fontFamily: "monospace", color: "var(--a-text3)", display: "block", lineHeight: 1.6 }}>
                cd alloy-core/core/gateway{"\n"}
                npm run dev
              </code>
            </div>
          </div>
        </section>

        {/* Loaded models (when available) */}
        {modelCount > 0 && (
          <section style={{ marginBottom: 16 }}>
            <SectionHeader icon="🤖" title="Yüklü Modeller" />
            <div style={{ borderRadius: 6, border: "1px solid var(--a-border)", background: "var(--a-bg2)", padding: "10px 12px" }}>
              <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--a-text2)" }}>
                {modelCount} model mevcut
              </p>
              <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                {availableModels.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--a-success)", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "var(--a-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.name}</span>
                    <span style={{ fontSize: 10, color: "var(--a-text3)", flexShrink: 0 }}>{m.provider}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Save button */}
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 0", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: canSave ? "pointer" : "not-allowed",
            border: "none", transition: "opacity 0.15s",
            background: saved ? "var(--a-success)" : "var(--a-accent)",
            color: "#fff", opacity: canSave ? 1 : 0.4,
          }}
        >
          {saved ? "✓ Kaydedildi!" : "💾 Kaydet"}
        </button>

        {saveError && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "var(--a-error)" }}>
            ⚠ {saveError}
          </div>
        )}
      </div>
    </div>
  );
}
