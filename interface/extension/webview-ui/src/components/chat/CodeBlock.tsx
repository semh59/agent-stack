/** Lightweight code block — inline styles only, no Tailwind. */
import { useState, useCallback } from "react";

interface Props { language?: string; code: string; }

export function CodeBlock({ language, code }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div style={{ margin:"6px 0", borderRadius:6, overflow:"hidden", border:"1px solid var(--a-border)", background:"var(--a-bg3)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 10px", borderBottom:"1px solid var(--a-border)" }}>
        <span style={{ fontSize:10, color:"var(--a-text3)", fontFamily:"monospace" }}>{language ?? "code"}</span>
        <button type="button" onClick={copy} style={{ background:"none", border:"none", cursor:"pointer", fontSize:10, color: copied ? "var(--a-success)" : "var(--a-text3)", padding:"2px 4px" }}>
          {copied ? "✓ Kopyalandı" : "Kopyala"}
        </button>
      </div>
      <pre style={{ margin:0, padding:"10px", fontSize:12, fontFamily:"var(--vscode-editor-font-family, monospace)", overflowX:"auto", lineHeight:1.5, color:"var(--a-text)" }}>{code}</pre>
    </div>
  );
}
