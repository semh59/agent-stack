import { useRef, useEffect } from "react";
import { useChatStore } from "@/store/chatStore";
import { MessageBubble } from "./MessageBubble";
import { ChatInput }     from "./ChatInput";
import { FileOpCard }    from "./FileOpCard";

interface Props {
  onSend:         (text: string) => void;
  onStop:         () => void;
  onApprove:      (id: string) => void;
  onReject:       (id: string) => void;
  onClear:        () => void;
  onRequestFiles: () => void;
}

export function ChatShell({ onSend, onStop, onApprove, onReject, onClear, onRequestFiles }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, pendingApprovals, isConnected, accounts, isStreaming } = useChatStore();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const needsSetup = accounts.length === 0 && !isConnected && messages.length === 0;
  const approvals  = Array.from(pendingApprovals.values());

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--a-bg)", overflow: "hidden" }}>
      <style>{`@keyframes dotPulse { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }`}</style>

      {!isConnected && accounts.length > 0 && (
        <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--a-error)", background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.2)" }}>
          Gateway baglantisi kesildi - yeniden baglaniliyor...
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 0" }}>
        {needsSetup ? (
          <SetupState />
        ) : messages.length === 0 ? (
          <EmptyState onSend={onSend} />
        ) : (
          <>
            {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
            {isStreaming && (
              <div style={{ display: "flex", gap: 8, padding: "8px 12px", alignItems: "center" }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--a-accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#000" }}>A</div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--a-accent)", display: "inline-block", opacity: 0.7, animation: "dotPulse 1.2s ease-in-out " + (i * 0.2) + "s infinite" }} />
                  ))}
                </div>
              </div>
            )}
            {approvals.map((a) => (
              <div key={a.approvalId} style={{ margin: "8px 12px" }}>
                <FileOpCard approval={a} onApprove={onApprove} onReject={onReject} />
              </div>
            ))}
          </>
        )}
      </div>

      {!needsSetup && (
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--a-border)" }}>
          {messages.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 12px", background: "var(--a-bg2)" }}>
              <span style={{ fontSize: 10, color: "var(--a-text3)" }}>{messages.length} mesaj</span>
              <button
                type="button"
                onClick={onClear}
                style={{ fontSize: 10, color: "var(--a-text3)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 3 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--a-error)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--a-text3)"; }}
              >
                Temizle
              </button>
            </div>
          )}
          <ChatInput onSend={onSend} onStop={onStop} onRequestFiles={onRequestFiles} />
        </div>
      )}
    </div>
  );
}

function SetupState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "32px 20px", textAlign: "center" }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--a-accent)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, fontSize: 18, fontWeight: 700, color: "#000" }}>A</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--a-text)", marginBottom: 6 }}>Alloy</div>
      <div style={{ fontSize: 12, color: "var(--a-text2)", maxWidth: 200, lineHeight: 1.5 }}>Baslamak icin Hesaplar sekmesinden bir hesap baglayin.</div>
    </div>
  );
}

function EmptyState({ onSend }: { onSend: (t: string) => void }) {
  const actions = [
    { label: "Refactor et",  prompt: "Refactor this code for clarity" },
    { label: "Hata ayikla", prompt: "Help me debug this code" },
    { label: "Test yaz",     prompt: "Write unit tests for the selected code" },
    { label: "Acikla",       prompt: "Explain how this code works" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "24px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--a-text3)", marginBottom: 16 }}>Ne uzerinde calismak istersiniz?</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, width: "100%", maxWidth: 240 }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onSend(a.prompt)}
            style={{ padding: "8px 6px", fontSize: 11, borderRadius: 6, cursor: "pointer", textAlign: "center", background: "var(--a-bg2)", border: "1px solid var(--a-border)", color: "var(--a-text2)", transition: "border-color 0.1s, color 0.1s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--a-accent)"; e.currentTarget.style.color = "var(--a-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--a-border)"; e.currentTarget.style.color = "var(--a-text2)"; }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
