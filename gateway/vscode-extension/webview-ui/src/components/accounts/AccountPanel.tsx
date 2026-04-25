import { useEffect, useCallback, useState, useRef } from "react";
import { useChatStore, type AccountInfo } from "@/store/chatStore";
import type { OutgoingMessage } from "@/lib/vscode";

interface Props { postMessage: (msg: OutgoingMessage) => void; }

export function AccountPanel({ postMessage }: Props) {
  const { accounts, availableModels, isAddingAccount, setAddingAccount, isConnected, accountError, setAccountError } = useChatStore();
  const [refreshing, setRefreshing] = useState(false);
  const [oauthOpened, setOauthOpened] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Safety timeout + OAuth opened tracking */
  useEffect(() => {
    if (isAddingAccount) {
      setOauthOpened(false);
      timerRef.current = setTimeout(() => {
        setAddingAccount(false);
        setAccountError("Yanıt bekleme süresi doldu. Gateway çalışıyor mu?");
      }, 12_000);
    } else if (timerRef.current) {
      clearTimeout(timerRef.current);
      setOauthOpened(true); // OAuth browser was opened
      setTimeout(() => setOauthOpened(false), 30_000); // hide hint after 30s
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isAddingAccount, setAddingAccount, setAccountError]);

  useEffect(() => {
    postMessage({ type: "getAccounts" });
    postMessage({ type: "getModels" });
  }, [postMessage]);

  const refresh = useCallback(() => {
    setRefreshing(true); setAccountError(null);
    postMessage({ type: "getAccounts" });
    postMessage({ type: "getModels" });
    setTimeout(() => setRefreshing(false), 800);
  }, [postMessage, setAccountError]);

  const addGoogle = useCallback(() => {
    setAccountError(null); setAddingAccount(true);
    postMessage({ type: "addAccount" });
  }, [postMessage, setAddingAccount, setAccountError]);

  const remove = useCallback((email: string) => {
    postMessage({ type: "removeAccount", payload: email });
    setTimeout(() => postMessage({ type: "getAccounts" }), 400);
  }, [postMessage]);

  const googleAccounts     = accounts.filter((a) => a.provider === "google");
  const hasAnthropicModels = availableModels.some((m) => m.provider.toLowerCase().includes("anthropic"));
  const totalActive        = googleAccounts.filter((a) => a.status === "active").length + (hasAnthropicModels ? 1 : 0);

  const row: React.CSSProperties = { display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:6, border:"1px solid var(--a-border)", background:"var(--a-bg2)", marginBottom:4 };
  const icon: React.CSSProperties = { width:28, height:28, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:12, fontWeight:700 };
  const sectionLabel: React.CSSProperties = { fontSize:10, fontWeight:600, color:"var(--a-text3)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"12px 0 6px" };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"var(--a-bg)", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 12px", borderBottom:"1px solid var(--a-border)", flexShrink:0 }}>
        <div>
          <div style={{ fontSize:12, fontWeight:600, color:"var(--a-text)" }}>Hesaplar</div>
          <div style={{ fontSize:10, color:"var(--a-text3)", marginTop:1 }}>
            {totalActive > 0 ? `${totalActive} sağlayıcı aktif` : "Bağlantı yok"}
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          style={{ width:26, height:26, borderRadius:5, border:"1px solid var(--a-border)", background:"none", cursor:"pointer", color:"var(--a-text2)", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}
        >
          {refreshing ? "…" : "↻"}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex:1, minHeight:0, overflowY:"auto", padding:"0 12px 12px" }}>

        {/* Error */}
        {accountError && (
          <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 10px", borderRadius:6, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", margin:"10px 0", fontSize:11, color:"var(--a-error)", lineHeight:1.5 }}>
            <span style={{ flex:1, wordBreak:"break-word" }}>{accountError}</span>
            <button type="button" onClick={() => setAccountError(null)} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--a-error)", fontSize:14, lineHeight:1, flexShrink:0 }}>×</button>
          </div>
        )}

        {/* No gateway */}
        {!isConnected && accounts.length === 0 && !accountError && (
          <div style={{ padding:"8px 10px", borderRadius:6, border:"1px solid var(--a-border)", background:"var(--a-bg2)", fontSize:11, color:"var(--a-text2)", lineHeight:1.6, marginTop:10 }}>
            Gateway bağlantısı yok. <code style={{ fontSize:10, padding:"1px 4px", borderRadius:3, background:"var(--a-bg3)" }}>localhost:51122</code> portunda çalıştığından emin olun.
          </div>
        )}

        {/* Status OK */}
        {totalActive > 0 && (
          <div style={{ padding:"6px 10px", borderRadius:6, background:"rgba(34,197,94,0.07)", border:"1px solid rgba(34,197,94,0.20)", fontSize:11, color:"var(--a-success)", marginTop:10 }}>
            ✓ {totalActive} sağlayıcı hazır
          </div>
        )}

        {/* OAuth opened hint */}
        {oauthOpened && !accountError && (
          <div style={{ padding:"7px 10px", borderRadius:6, background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.25)", fontSize:11, color:"#60a5fa", lineHeight:1.5, marginTop:8 }}>
            Tarayıcıda giriş yapıldıktan sonra otomatik yenilenecek veya ↻ düğmesine basın.
          </div>
        )}

        {/* Google section */}
        <div style={sectionLabel}>Google · Gemini</div>
        {googleAccounts.map((acc) => (
          <AccountRow key={acc.email} account={acc} onRemove={remove} />
        ))}
        <button
          type="button"
          onClick={addGoogle}
          disabled={isAddingAccount}
          style={{ ...row, cursor: isAddingAccount ? "not-allowed" : "pointer", opacity: isAddingAccount ? 0.65 : 1, border:"1px dashed var(--a-border)", background:"transparent", width:"100%" }}
          onMouseEnter={(e) => { if (!isAddingAccount) e.currentTarget.style.borderColor = "var(--a-accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--a-border)"; }}
        >
          <div style={{ ...icon, background:"rgba(66,133,244,0.12)", color:"#4285F4" }}>G</div>
          <div style={{ flex:1, minWidth:0, textAlign:"left" }}>
            <div style={{ fontSize:12, fontWeight:500, color:"var(--a-text)" }}>
              {isAddingAccount ? "Tarayıcıda onaylayın…" : googleAccounts.length > 0 ? "Google hesabı ekle" : "Google ile giriş yap"}
            </div>
            <div style={{ fontSize:10, color:"var(--a-text3)" }}>
              {isAddingAccount ? "Tarayıcı açıldı, bu sekmeye dönün" : "OAuth · tarayıcı açılır"}
            </div>
          </div>
          {!isAddingAccount && <span style={{ color:"var(--a-text3)", fontSize:14 }}>+</span>}
        </button>

        {/* Claude section */}
        <div style={sectionLabel}>Claude · Anthropic</div>
        <div style={{ ...row, cursor:"default" }}>
          <div style={{ ...icon, background:"rgba(217,119,6,0.12)", color:"#d97706" }}>C</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, fontWeight:500, color:"var(--a-text)" }}>Claude</div>
            <div style={{ fontSize:10, color:"var(--a-text3)" }}>
              {hasAnthropicModels ? "API key aktif — gateway üzerinden" : "Ayarlar'dan API key girin"}
            </div>
          </div>
          <span style={{ fontSize:12, color: hasAnthropicModels ? "var(--a-success)" : "var(--a-text3)" }}>
            {hasAnthropicModels ? "✓" : "—"}
          </span>
        </div>

      </div>
    </div>
  );
}

function AccountRow({ account, onRemove }: { account: AccountInfo; onRemove: (e: string) => void }) {
  const isGoogle = account.provider === "google";
  const isActive = account.status === "active";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:6, border:`1px solid ${isActive ? (isGoogle ? "rgba(66,133,244,0.2)" : "rgba(217,119,6,0.2)") : "rgba(239,68,68,0.2)"}`, background:"var(--a-bg2)", marginBottom:4 }}>
      <div style={{ width:28, height:28, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:12, fontWeight:700, background: isGoogle ? "rgba(66,133,244,0.12)" : "rgba(217,119,6,0.12)", color: isGoogle ? "#4285F4" : "#d97706" }}>
        {isGoogle ? "G" : "C"}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:2 }}>
          <span style={{ fontSize:11, fontWeight:600, color: isGoogle ? "#4285F4" : "#d97706" }}>{isGoogle ? "Google" : "Claude"}</span>
          <span style={{ width:6, height:6, borderRadius:"50%", background: isActive ? "var(--a-success)" : "var(--a-error)", flexShrink:0 }} />
        </div>
        <div style={{ fontSize:11, color:"var(--a-text2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{account.email}</div>
        {!isActive && <div style={{ fontSize:10, color:"var(--a-error)", marginTop:1 }}>Oturum süresi doldu</div>}
      </div>
      <button
        type="button"
        onClick={() => onRemove(account.email)}
        style={{ width:22, height:22, borderRadius:4, border:"none", background:"none", cursor:"pointer", color:"var(--a-text3)", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--a-error)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--a-text3)"; e.currentTarget.style.background = "none"; }}
      >
        ×
      </button>
    </div>
  );
}
