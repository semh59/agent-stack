import { useMemo } from "react";
import type { ChatMessage } from "@/store/chatStore";

interface Props { message: ChatMessage; }

export function MessageBubble({ message }: Props) {
  const { role, content, isStreaming, timestamp, isError } = message;
  const time = new Date(timestamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

  /* System / error */
  if (role === "system") {
    const color = isError ? "var(--a-error)" : "var(--a-text3)";
    const bg    = isError ? "rgba(239,68,68,0.07)" : "transparent";
    return (
      <div style={{ margin:"2px 12px", padding:"4px 8px", borderRadius:4, background:bg, fontSize:11, color, lineHeight:1.4 }}>
        {content}
      </div>
    );
  }

  /* User */
  if (role === "user") {
    return (
      <div style={{ display:"flex", justifyContent:"flex-end", padding:"3px 12px" }}>
        <div style={{ maxWidth:"85%", display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
          <div style={{ padding:"8px 12px", borderRadius:"12px 12px 2px 12px", background:"var(--a-accent)", color:"#000", fontSize:13, lineHeight:1.5, fontWeight:500 }}>
            {content}
          </div>
          <span style={{ fontSize:10, color:"var(--a-text3)" }}>{time}</span>
        </div>
      </div>
    );
  }

  /* Assistant */
  return (
    <div style={{ display:"flex", gap:8, padding:"6px 12px", alignItems:"flex-start" }}>
      <div style={{ width:22, height:22, borderRadius:6, background:"var(--a-accent)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2, fontSize:11, fontWeight:700, color:"#000" }}>A</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
          <span style={{ fontSize:11, fontWeight:600, color:"var(--a-text2)" }}>Alloy</span>
          <span style={{ fontSize:10, color:"var(--a-text3)" }}>{time}</span>
        </div>
        <div style={{
          fontSize:13, lineHeight:1.6, color:"var(--a-text)",
          borderLeft: isStreaming ? "2px solid var(--a-accent)" : "none",
          paddingLeft: isStreaming ? 8 : 0,
          wordBreak:"break-word", overflowWrap:"anywhere",
        }}>
          <MarkdownContent text={content} />
          {isStreaming && (
            <span style={{ display:"inline-flex", gap:3, marginLeft:4, verticalAlign:"middle" }}>
              {[0,1,2].map((i) => (
                <span key={i} className={`dot-${i+1}`} style={{ display:"inline-block", width:4, height:4, borderRadius:"50%", background:"var(--a-accent)" }} />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <>{blocks}</>;
}

function parseMarkdown(raw: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const parts = raw.split(/(```[\s\S]*?```)/g);

  parts.forEach((part, pi) => {
    if (part.startsWith("```")) {
      const m = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const code = m ? m[2].trimEnd() : part.slice(3, -3);
      const lang = m ? m[1] : "";
      blocks.push(
        <div key={pi} style={{ margin:"6px 0", borderRadius:6, overflow:"hidden", border:"1px solid var(--a-border)", background:"var(--a-bg3)" }}>
          {lang && (
            <div style={{ padding:"3px 10px", fontSize:10, color:"var(--a-text3)", borderBottom:"1px solid var(--a-border)", fontFamily:"monospace" }}>{lang}</div>
          )}
          <pre style={{ margin:0, padding:"10px", fontSize:12, fontFamily:"var(--vscode-editor-font-family, monospace)", overflowX:"auto", lineHeight:1.5, color:"var(--a-text)" }}>{code}</pre>
        </div>
      );
      return;
    }

    part.split("\n").forEach((line, li) => {
      if (!line.trim()) { blocks.push(<div key={`${pi}-${li}`} style={{ height:6 }} />); return; }
      const key = `${pi}-${li}`;
      const h1 = line.match(/^# (.+)/);
      const h2 = line.match(/^## (.+)/);
      const li_ = line.match(/^[-*•] (.+)/);
      const num = line.match(/^(\d+)\. (.+)/);
      if (h1)  { blocks.push(<div key={key} style={{ fontWeight:700, fontSize:14, margin:"4px 0 2px", color:"var(--a-text)" }}>{inline(h1[1])}</div>); return; }
      if (h2)  { blocks.push(<div key={key} style={{ fontWeight:600, fontSize:13, margin:"4px 0 2px", color:"var(--a-text)" }}>{inline(h2[1])}</div>); return; }
      if (li_) { blocks.push(<div key={key} style={{ display:"flex", gap:6, margin:"1px 0" }}><span style={{ color:"var(--a-text3)", marginTop:2 }}>•</span><span>{inline(li_[1])}</span></div>); return; }
      if (num) { blocks.push(<div key={key} style={{ display:"flex", gap:6, margin:"1px 0" }}><span style={{ color:"var(--a-text3)", minWidth:16 }}>{num[1]}.</span><span>{inline(num[2])}</span></div>); return; }
      blocks.push(<div key={key} style={{ margin:"1px 0" }}>{inline(line)}</div>);
    });
  });

  return blocks;
}

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const rx = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("`")) {
      out.push(<code key={k++} style={{ fontFamily:"monospace", fontSize:11, padding:"1px 4px", borderRadius:3, background:"var(--a-bg3)", color:"var(--a-accent)" }}>{s.slice(1,-1)}</code>);
    } else if (s.startsWith("**")) {
      out.push(<strong key={k++}>{s.slice(2,-2)}</strong>);
    } else {
      out.push(<em key={k++}>{s.slice(1,-1)}</em>);
    }
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
