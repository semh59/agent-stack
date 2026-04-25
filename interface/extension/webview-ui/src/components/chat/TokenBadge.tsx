/** Token usage badge — inline styles, no Tailwind. */
import { useChatStore } from "@/store/chatStore";

function fmt(n: number): string { return n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n); }

export function TokenBadge() {
  const { tokenUsage } = useChatStore();
  if (!tokenUsage.total) return null;
  return (
    <span style={{ fontSize:10, fontFamily:"monospace", color:"var(--a-accent)", padding:"1px 5px", borderRadius:4, background:"var(--a-accent-s)", border:"1px solid var(--a-border)" }}>
      {fmt(tokenUsage.total)} tok
    </span>
  );
}
