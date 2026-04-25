import { useState } from "react";
import type { ToolApprovalPayload } from "@/lib/vscode";

interface Props {
  approval: ToolApprovalPayload;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
}

export function FileOpCard({ approval, onApprove, onReject }: Props) {
  const [note,     setNote]     = useState("");
  const [expanded, setExpanded] = useState(true);

  const opLabel: Record<string, string> = { read:"Oku", write:"Yaz", execute:"Çalıştır" };

  const card: React.CSSProperties = {
    borderRadius:8, border:"1px solid var(--a-border)",
    background:"var(--a-bg2)", overflow:"hidden", fontSize:12,
  };
  const header: React.CSSProperties = {
    display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
    borderBottom: expanded ? "1px solid var(--a-border)" : "none",
    cursor:"pointer",
  };
  const btnBase: React.CSSProperties = {
    flex:1, padding:"6px", borderRadius:6, border:"1px solid var(--a-border)",
    fontSize:12, fontWeight:500, cursor:"pointer", transition:"background 0.1s, color 0.1s",
  };

  return (
    <div style={card}>
      <div style={header} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize:10, padding:"2px 6px", borderRadius:3, background:"var(--a-bg3)", color:"var(--a-text2)", fontWeight:600 }}>
          {opLabel[approval.operation] ?? approval.operation}
        </span>
        <span style={{ fontWeight:600, color:"var(--a-text)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{approval.tool}</span>
        <span style={{ fontSize:10, color:"var(--a-text3)", flexShrink:0 }}>Onay bekleniyor</span>
        <span style={{ color:"var(--a-text3)", fontSize:12 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <>
          <div style={{ padding:"6px 10px", color:"var(--a-text2)", fontSize:11, fontFamily:"monospace", borderBottom:"1px solid var(--a-border)", wordBreak:"break-all" }}>
            {approval.target}
          </div>

          {(approval.diff || (approval as { content?: string }).content) && (
            <div style={{ maxHeight:180, overflowY:"auto", borderBottom:"1px solid var(--a-border)" }}>
              {approval.diff ? <DiffView diff={approval.diff} /> : (
                <pre style={{ margin:0, padding:10, fontSize:11, fontFamily:"monospace", color:"var(--a-text)", background:"var(--a-bg3)", whiteSpace:"pre-wrap" }}>
                  {(approval as { content?: string }).content}
                </pre>
              )}
            </div>
          )}

          {!approval.autoApproved && (
            <div style={{ padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Not ekle (isteğe bağlı)"
                style={{ width:"100%", padding:"5px 8px", borderRadius:5, border:"1px solid var(--a-border)", background:"var(--a-bg)", color:"var(--a-text)", fontSize:11, outline:"none", boxSizing:"border-box" }}
              />
              <div style={{ display:"flex", gap:6 }}>
                <button
                  type="button"
                  onClick={() => onReject(approval.approvalId)}
                  style={{ ...btnBase, background:"var(--a-bg3)", color:"var(--a-text2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; e.currentTarget.style.color = "var(--a-error)"; e.currentTarget.style.borderColor = "var(--a-error)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--a-bg3)"; e.currentTarget.style.color = "var(--a-text2)"; e.currentTarget.style.borderColor = "var(--a-border)"; }}
                >
                  Reddet
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(approval.approvalId)}
                  style={{ ...btnBase, background:"var(--a-accent)", color:"#000", border:"1px solid var(--a-accent)", fontWeight:600 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--a-orange-h)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--a-accent)"; }}
                >
                  Onayla
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <div style={{ fontFamily:"monospace", fontSize:11 }}>
      {diff.split("\n").map((line, i) => {
        const bg    = line.startsWith("+") ? "rgba(34,197,94,0.08)"  : line.startsWith("-") ? "rgba(239,68,68,0.08)"  : "transparent";
        const color = line.startsWith("+") ? "var(--a-success)"      : line.startsWith("-") ? "var(--a-error)"        : "var(--a-text2)";
        return <div key={i} style={{ padding:"1px 10px", background:bg, color }}>{line}</div>;
      })}
    </div>
  );
}
