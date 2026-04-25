import { useCallback, useEffect } from "react";
import { ChatShell }    from "@/components/chat/ChatShell";
import { AccountPanel } from "@/components/accounts/AccountPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { useVSCodeApi }  from "@/hooks/useVSCodeApi";
import { useChatStore, type AccountInfo } from "@/store/chatStore";
import { usePipelineStore } from "@/store/pipelineStore";
import type { IncomingMessage } from "@/lib/vscode";
import { uid } from "@/lib/utils";

const S = {
  root: {
    display: "flex", flexDirection: "column" as const,
    height: "100%", overflow: "hidden",
    background: "var(--a-bg)", color: "var(--a-text)",
  } as React.CSSProperties,
  tabs: {
    display: "flex", flexShrink: 0,
    borderBottom: "1px solid var(--a-border)",
    background: "var(--a-bg2)",
  } as React.CSSProperties,
  content: { flex: 1, minHeight: 0, overflow: "hidden" } as React.CSSProperties,
};

function tab(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "8px 4px", fontSize: 11, fontWeight: 500,
    textAlign: "center", cursor: "pointer", border: "none",
    borderBottom: active ? "2px solid var(--a-accent)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--a-text)" : "var(--a-text3)",
    transition: "color 0.1s, border-color 0.1s",
  };
}

function agentLabel(role: string): string {
  const map: Record<string, string> = {
    researcher:    "Araştırıyor",
    analyzer:      "Analiz ediyor",
    analyser:      "Analiz ediyor",
    planner:       "Plan yapıyor",
    architect:     "Mimari tasarlıyor",
    coder:         "Kod yazıyor",
    implementer:   "Uygulıyor",
    reviewer:      "İnceliyor",
    verifier:      "Doğruluyor",
    tester:        "Test ediyor",
    refactorer:    "Düzenliyor",
    documenter:    "Belgeliyor",
    debugger:      "Hata arıyor",
    optimizer:     "Optimize ediyor",
  };
  const key = role.toLowerCase().replace(/[_-]/g, "");
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k)) return v;
  }
  return role;
}

export default function App() {
  const chatStore     = useChatStore();
  const pipelineStore = usePipelineStore();

  const handleMessage = useCallback((msg: IncomingMessage) => {
    switch (msg.type) {
      case "agentStart":
        pipelineStore.updatePhase({ phase: msg.agent, status: "started", progress: 0 });
        chatStore.addMessage({ id: uid(), sessionId: "", role: "system", content: `⟳ ${agentLabel(msg.agent)}…`, timestamp: new Date().toISOString() });
        break;
      case "agentComplete":
        pipelineStore.updatePhase({ phase: msg.agent, status: "completed", progress: 100 });
        chatStore.addMessage({ id: uid(), sessionId: "", role: "system", content: `✓ ${agentLabel(msg.agent)}`, timestamp: new Date().toISOString() });
        break;
      case "rarvPhase":
        pipelineStore.updatePhase({ phase: msg.phase, status: "started", progress: 50 });
        break;
      case "log":
        break;
      case "system":
        if (chatStore.isAddingAccount) {
          chatStore.setAddingAccount(false);
          chatStore.setAccountError(null);
        } else if (msg.value && msg.value.trim()) {
          chatStore.addMessage({ id: uid(), sessionId: "", role: "system", content: msg.value, timestamp: new Date().toISOString() });
        }
        break;
      case "error":
        chatStore.stopStreaming();
        if (chatStore.isAddingAccount) chatStore.setAccountError(msg.value);
        chatStore.setAddingAccount(false);
        chatStore.addMessage({ id: uid(), sessionId: "", role: "system", content: msg.value, timestamp: new Date().toISOString(), isError: true });
        break;
      case "user":
        break;
      case "approvalRequired":
        chatStore.addApproval({ approvalId: msg.id, tool: "file_operation", operation: "write", target: msg.content, autoApproved: false });
        break;
      case "accounts": {
        const raw = Array.isArray(msg.payload) ? msg.payload : [];
        const mapped: AccountInfo[] = raw.map((a) => ({
          email:     String(a.email ?? ""),
          provider:  (String(a.provider ?? "").toLowerCase().includes("anthropic") || String(a.provider ?? "").toLowerCase().includes("claude")) ? "anthropic" : "google",
          expiresAt: Number(a.expiresAt ?? 0),
          isValid:   Boolean(a.isValid ?? a.status === "active"),
          status:    a.status === "error" ? "error" : "active",
        }));
        chatStore.setAccounts(mapped);
        chatStore.setAddingAccount(false);
        if (mapped.length > 0) chatStore.setConnected(true);
        break;
      }
      case "models":
        if (Array.isArray(msg.payload)) {
          chatStore.setAvailableModels(msg.payload);
          chatStore.setConnected(true);
          if (msg.payload.length > 0 && !chatStore.selectedModel) chatStore.setSelectedModel(msg.payload[0].id);
        }
        break;
      case "pipeline_status":
        if (msg.status !== undefined) pipelineStore.setPipelineStatus({ type: "pipeline_status", status: msg.status });
        break;
      case "authToken":
        chatStore.setConnected(true);
        break;
      case "autonomyEvent":
        pipelineStore.addMissionEvent({ type: msg.eventType ?? "unknown", sessionId: msg.sessionId, data: msg.payload, timestamp: msg.timestamp ?? new Date().toISOString() });
        break;
      case "assistantText":
        chatStore.stopStreaming();
        chatStore.addMessage({ id: uid(), sessionId: "", role: "assistant", content: msg.content, timestamp: new Date().toISOString() });
        break;
      case "chatHistory": {
        const hist = Array.isArray(msg.messages) ? msg.messages : [];
        for (const m of hist) {
          const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : "system";
          chatStore.addMessage({
            id: uid(), sessionId: "",
            role,
            content: String(m.content ?? ""),
            timestamp: String(m.timestamp ?? new Date().toISOString()),
            isError: Boolean(m.isError),
          });
        }
        break;
      }
      case "workspaceFiles":
        if (Array.isArray(msg.files)) chatStore.setWorkspaceFiles(msg.files);
        break;
      case "token_update":
        if ("payload" in msg && msg.payload && typeof msg.payload === "object") {
          const p = msg.payload as { prompt?: number; completion?: number; total?: number; budget?: number };
          chatStore.updateTokenUsage({ prompt: p.prompt ?? 0, completion: p.completion ?? 0, total: p.total ?? 0, budget: p.budget });
        }
        break;
      case "modelSwitchEvent":
      case "gateEvent":
      case "budgetEvent":
      case "queueEvent":
        pipelineStore.addMissionEvent({ type: msg.type, data: "payload" in msg ? msg.payload : undefined, timestamp: new Date().toISOString() });
        break;
    }
  }, [chatStore, pipelineStore]);

  const { postMessage } = useVSCodeApi(handleMessage);

  useEffect(() => {
    postMessage({ type: "getAccounts" });
    postMessage({ type: "getModels" });
    postMessage({ type: "getPipelineStatus" });
  }, [postMessage]);

  const handleSend         = useCallback((text: string) => {
    chatStore.addMessage({ id: uid(), sessionId: "", role: "user", content: text, timestamp: new Date().toISOString() });
    chatStore.startStreaming("");
    postMessage({ type: "sendMessage", value: text });
  }, [chatStore, postMessage]);
  const handleStop         = useCallback(() => chatStore.stopStreaming(), [chatStore]);
  const handleApprove      = useCallback((id: string) => { chatStore.removeApproval(id); postMessage({ type: "approveAction", actionId: id }); }, [chatStore, postMessage]);
  const handleReject       = useCallback((id: string) => { chatStore.removeApproval(id); postMessage({ type: "rejectAction",  actionId: id }); }, [chatStore, postMessage]);
  const handleClear        = useCallback(() => { chatStore.clearMessages(); postMessage({ type: "clearHistory" }); }, [chatStore, postMessage]);
  const handleRequestFiles = useCallback(() => postMessage({ type: "getWorkspaceFiles" }), [postMessage]);

  const { activeView, setActiveView, accounts, accountError } = chatStore;
  const hasAlert = accounts.some((a) => a.status === "error") || !!accountError;

  return (
    <div style={S.root}>
      <div style={S.tabs}>
        <button type="button" style={tab(activeView === "chat")} onClick={() => setActiveView("chat")}>Chat</button>
        <button type="button" style={tab(activeView === "accounts")} onClick={() => setActiveView("accounts")}>
          Hesaplar{hasAlert ? " ●" : ""}
        </button>
        <button type="button" style={tab(activeView === "settings")} onClick={() => setActiveView("settings")}>Ayarlar</button>
      </div>
      <div style={S.content}>
        {activeView === "chat"     && <ChatShell onSend={handleSend} onStop={handleStop} onApprove={handleApprove} onReject={handleReject} onClear={handleClear} onRequestFiles={handleRequestFiles} />}
        {activeView === "accounts" && <AccountPanel postMessage={postMessage} />}
        {activeView === "settings" && <SettingsPanel postMessage={postMessage} />}
      </div>
    </div>
  );
}
