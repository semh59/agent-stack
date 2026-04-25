import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore } from "@/store/chatStore";

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  onRequestFiles: () => void;
}

function getAtQuery(text: string, pos: number): string | null {
  const before = text.slice(0, pos);
  const m = before.match(/@([\w./\\-]*)$/);
  return m ? m[1] : null;
}

export function ChatInput({ onSend, onStop, onRequestFiles }: Props) {
  const [text, setText]       = useState("");
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const ref     = useRef<HTMLTextAreaElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const { isStreaming, selectedModel, availableModels, workspaceFiles } = useChatStore();
  const model = availableModels.find((m) => m.id === selectedModel);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  const filtered = atQuery != null
    ? workspaceFiles.filter((f) => f.toLowerCase().includes(atQuery.toLowerCase())).slice(0, 10)
    : [];

  useEffect(() => { setActiveIdx(0); }, [atQuery]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? val.length;
    setText(val);
    const q = getAtQuery(val, pos);
    if (q !== null) {
      setAtQuery(q);
      if (workspaceFiles.length === 0) onRequestFiles();
    } else {
      setAtQuery(null);
    }
  }, [workspaceFiles.length, onRequestFiles]);

  const insertFile = useCallback((file: string) => {
    const ta  = ref.current;
    const pos = ta?.selectionStart ?? text.length;
    const before = text.slice(0, pos).replace(/@[\w./\\-]*$/, "@" + file + " ");
    const after  = text.slice(pos);
    const next = before + after;
    setText(next);
    setAtQuery(null);
    requestAnimationFrame(() => {
      if (ta) { ta.focus(); ta.setSelectionRange(before.length, before.length); }
    });
  }, [text]);

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || isStreaming) return;
    onSend(t);
    setText("");
    setAtQuery(null);
    if (ref.current) ref.current.style.height = "auto";
  }, [text, isStreaming, onSend]);

  const onKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (atQuery !== null && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); insertFile(filtered[activeIdx] ?? ""); return; }
      if (e.key === "Escape") { e.preventDefault(); setAtQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }, [atQuery, filtered, activeIdx, insertFile, send]);

  const wrapStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column",
    margin: "8px", borderRadius: 8,
    border: "1px solid " + (isStreaming ? "var(--a-error)" : "var(--a-border)"),
    background: "var(--a-bg2)", overflow: "visible",
    transition: "border-color 0.15s", position: "relative",
  };

  const taStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", fontSize: 13, lineHeight: 1.5,
    background: "transparent", border: "none", outline: "none", resize: "none",
    color: "var(--a-text)", minHeight: 40, maxHeight: 160, overflowY: "auto",
    fontFamily: "inherit",
  };

  const barStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "4px 8px", borderTop: "1px solid var(--a-border)",
  };

  const btnStyle = (primary: boolean, danger?: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28, borderRadius: 6, border: "none", cursor: "pointer",
    background: danger ? "var(--a-error)" : primary ? "var(--a-accent)" : "transparent",
    color: (primary || danger) ? "#000" : "var(--a-text2)",
    fontSize: 13, fontWeight: 700, flexShrink: 0,
    opacity: (!isStreaming && !text.trim()) ? 0.4 : 1,
    transition: "opacity 0.15s",
  });

  return (
    <div style={wrapStyle}>
      {atQuery !== null && filtered.length > 0 && (
        <div ref={dropRef} style={{
          position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4,
          background: "var(--a-bg2)", border: "1px solid var(--a-border)",
          borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          maxHeight: 200, overflowY: "auto", zIndex: 100,
        }}>
          <div style={{ padding: "4px 8px 2px", fontSize: 9, color: "var(--a-text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Dosya — Tab / Enter ile ekle
          </div>
          {filtered.map((file, i) => {
            const parts = file.replace(/\\/g, "/").split("/");
            const name  = parts[parts.length - 1] ?? file;
            const dir   = parts.slice(0, -1).join("/");
            return (
              <div
                key={file}
                onMouseDown={(e) => { e.preventDefault(); insertFile(file); }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  padding: "5px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  background: i === activeIdx ? "var(--a-accent-s)" : "transparent",
                  borderLeft: i === activeIdx ? "2px solid var(--a-accent)" : "2px solid transparent",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--a-text)", fontFamily: "monospace", flexShrink: 0 }}>{name}</span>
                {dir && <span style={{ fontSize: 10, color: "var(--a-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir}</span>}
              </div>
            );
          })}
        </div>
      )}

      <textarea
        ref={ref}
        value={text}
        onChange={handleChange}
        onKeyDown={onKey}
        placeholder={isStreaming ? "Yanit bekleniyor..." : "Mesaj yazin... (@dosya ile dosya ekle)"}
        disabled={isStreaming}
        rows={1}
        style={taStyle}
      />
      <div style={barStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "var(--a-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
            {model ? model.name : "-"}
          </span>
          <span
            title="Dosya ekle (@)"
            onClick={() => {
              if (!ref.current) return;
              const pos = ref.current.selectionStart;
              const next = text.slice(0, pos) + "@" + text.slice(pos);
              setText(next);
              setAtQuery("");
              if (workspaceFiles.length === 0) onRequestFiles();
              requestAnimationFrame(() => {
                if (ref.current) { ref.current.focus(); ref.current.setSelectionRange(pos + 1, pos + 1); }
              });
            }}
            style={{ fontSize: 11, color: "var(--a-text3)", cursor: "pointer", userSelect: "none", padding: "1px 4px", borderRadius: 3 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--a-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--a-text3)"; }}
          >
            @
          </span>
        </div>
        {isStreaming ? (
          <button type="button" onClick={onStop} style={btnStyle(false, true)} title="Durdur">&#9632;</button>
        ) : (
          <button type="button" onClick={send} disabled={!text.trim()} style={btnStyle(true)} title="Gonder">&#8593;</button>
        )}
      </div>
    </div>
  );
}
