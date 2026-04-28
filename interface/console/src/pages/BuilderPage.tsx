/**
 * BuilderPage — 3 panel uygulama geliştirici:
 * FileTree (sol) | BuildChat (orta) | PreviewPane (sağ)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Send, Square, RefreshCw, Code2, Monitor,
  ChevronRight, ChevronDown, FileText, Folder,
  ArrowLeft, Loader2, AlertCircle,
} from "lucide-react";
import { projectsApi, type ProjectMeta, type FileNode, type BuildEvent } from "../services/projects-api";

// ── Yardımcılar ────────────────────────────────────────────────────────────────

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "status";
  content: string;
}

function uid() { return Math.random().toString(36).slice(2); }

// ── FileTree ───────────────────────────────────────────────────────────────────

function FileTreeNode({
  node,
  depth = 0,
  selected,
  onSelect,
}: {
  node: FileNode;
  depth?: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.type === "dir") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] rounded transition-colors"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={12} className="text-[var(--color-alloy-accent)] shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={`flex w-full items-center gap-1.5 py-1 text-left text-[12px] rounded transition-colors ${
        selected === node.path
          ? "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]"
          : "text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)]"
      }`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
    >
      <FileText size={12} className="shrink-0 opacity-60" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function FileTree({
  projectId,
  selectedFile,
  onSelect,
}: {
  projectId: string;
  selectedFile: string | null;
  onSelect: (path: string) => void;
}) {
  const [tree, setTree]     = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    projectsApi.files(projectId)
      .then(({ tree }) => setTree(tree))
      .catch(() => { /* sessiz hata */ })
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={16} className="animate-spin text-[var(--color-alloy-text-dim)]" />
    </div>
  );

  return (
    <div className="overflow-y-auto h-full py-2">
      {tree.length === 0
        ? <p className="px-4 text-[11px] text-[var(--color-alloy-text-dim)]">Henüz dosya yok</p>
        : tree.map((node) => (
            <FileTreeNode key={node.path} node={node} selected={selectedFile} onSelect={onSelect} />
          ))
      }
    </div>
  );
}

// ── PreviewPane ────────────────────────────────────────────────────────────────

function PreviewPane({ projectId, selectedFile }: { projectId: string; selectedFile: string | null }) {
  const [mode, setMode]       = useState<"preview" | "code">("preview");
  const [code, setCode]       = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);

  useEffect(() => {
    if (!selectedFile || mode !== "code") return;
    setLoadingCode(true);
    projectsApi.fileContent(projectId, selectedFile)
      .then(setCode)
      .catch(() => setCode("// Dosya okunamadı"))
      .finally(() => setLoadingCode(false));
  }, [projectId, selectedFile, mode]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--color-alloy-border)] shrink-0">
        {(["preview", "code"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
              mode === m
                ? "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]"
                : "text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)]"
            }`}
          >
            {m === "preview" ? <Monitor size={12} /> : <Code2 size={12} />}
            {m === "preview" ? "Önizleme" : "Kod"}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === "preview" ? (
          <iframe
            src={projectsApi.previewUrl(projectId)}
            className="w-full h-full border-0"
            title="Proje önizlemesi"
          />
        ) : loadingCode ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={16} className="animate-spin text-[var(--color-alloy-text-dim)]" />
          </div>
        ) : (
          <pre className="h-full overflow-auto p-4 text-[12px] font-mono text-[var(--color-alloy-text)] bg-[var(--color-alloy-bg)] leading-relaxed whitespace-pre-wrap break-words">
            {code ?? "Bir dosya seçin"}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── BuildChat ──────────────────────────────────────────────────────────────────

function BuildChat({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: uid(), role: "status", content: "Alloy hazır. Ne inşa edelim?" },
  ]);
  const [input, setInput]       = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef                 = useRef<AbortController | null>(null);
  const scrollRef                = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setMessages((prev) => [...prev, { id: uid(), role: "user", content: text }]);
    setStreaming(true);

    const assistantId = uid();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    abortRef.current = new AbortController();

    try {
      await projectsApi.sendMessage(projectId, text, (evt: BuildEvent) => {
        if (evt.event === "status") {
          setMessages((prev) => [...prev, { id: uid(), role: "status", content: evt.text }]);
        } else if (evt.event === "chunk") {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: m.content + evt.text } : m)
          );
        } else if (evt.event === "done") {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: evt.summary } : m)
          );
        } else if (evt.event === "error") {
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, role: "status", content: `⚠ ${evt.text}` } : m)
          );
        }
      }, abortRef.current.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, role: "status", content: `Hata: ${(e as Error).message}` } : m)
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, projectId]);

  const stop = () => { abortRef.current?.abort(); };

  return (
    <div className="flex flex-col h-full">
      {/* Mesajlar */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.role === "status" ? (
              <div className="text-[11px] text-[var(--color-alloy-text-dim)] italic px-2">{m.content}</div>
            ) : (
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-[var(--color-alloy-accent)] text-white"
                  : "bg-[var(--color-alloy-surface-hover)] text-[var(--color-alloy-text)]"
              }`}>
                {m.content || <span className="opacity-40">…</span>}
              </div>
            )}
          </div>
        ))}
        {streaming && (
          <div className="flex gap-2 items-center px-2">
            {[0,1,2].map((i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--color-alloy-accent)] opacity-70 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[var(--color-alloy-border)] p-3">
        <div className="flex items-end gap-2 rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-3 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={streaming ? "Yanıt bekleniyor…" : "Ne yapalım? (@dosya ile dosya ekle)"}
            disabled={streaming}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[13px] text-[var(--color-alloy-text)] placeholder:text-[var(--color-alloy-text-dim)] outline-none min-h-[24px] max-h-[120px]"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          {streaming ? (
            <button type="button" onClick={stop} className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
              <Square size={12} />
            </button>
          ) : (
            <button type="button" onClick={() => void send()} disabled={!input.trim()} className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-alloy-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-30">
              <Send size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── BuilderPage ────────────────────────────────────────────────────────────────

export function BuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject]     = useState<ProjectMeta | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [refreshKey, setRefreshKey]     = useState(0);

  useEffect(() => {
    if (!id) return;
    projectsApi.get(id)
      .then(({ project }) => setProject(project))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (!id) return null;

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 size={24} className="animate-spin text-[var(--color-alloy-text-dim)]" />
    </div>
  );

  if (error) return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <AlertCircle size={24} className="text-[var(--color-alloy-error)]" />
      <p className="text-sm text-[var(--color-alloy-text-sec)]">{error}</p>
      <button onClick={() => navigate("/projects")} className="text-xs text-[var(--color-alloy-accent)] underline">
        Projelere dön
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] px-4">
        <button
          type="button"
          onClick={() => navigate("/projects")}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-[13px] font-semibold text-[var(--color-alloy-text)] truncate">
          {project?.name ?? id}
        </span>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          title="Önizlemeyi yenile"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 3 Panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sol: Dosya ağacı */}
        <div className="w-52 shrink-0 border-r border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] flex flex-col overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-alloy-text-dim)] border-b border-[var(--color-alloy-border)]">
            Dosyalar
          </div>
          <FileTree
            key={refreshKey}
            projectId={id}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
          />
        </div>

        {/* Orta: Chat */}
        <div className="flex-1 min-w-0 border-r border-[var(--color-alloy-border)] flex flex-col overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-alloy-text-dim)] border-b border-[var(--color-alloy-border)]">
            Alloy Builder
          </div>
          <BuildChat projectId={id} />
        </div>

        {/* Sağ: Önizleme */}
        <div className="w-[420px] shrink-0 flex flex-col overflow-hidden">
          <PreviewPane key={refreshKey} projectId={id} selectedFile={selectedFile} />
        </div>
      </div>
    </div>
  );
}
