/**
 * ProjectsPage — "Ne inşa etmek istiyorsunuz?"
 *
 * Kullanıcıya mevcut projeleri gösterir ve doğal dil açıklamasıyla
 * yeni proje oluşturma akışı sunar.
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Clock, Trash2, Sparkles, ArrowRight,
  Loader2, Code2, Globe, Zap,
} from "lucide-react";
import { projectsApi, type ProjectMeta } from "../services/projects-api";
import { SetupWizard, isSetupDone } from "./SetupWizard";

// ── Yardımcılar ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  const h  = Math.floor(m / 60);
  const d  = Math.floor(h / 24);
  if (d > 0) return `${d} gün önce`;
  if (h > 0) return `${h} saat önce`;
  if (m > 0) return `${m} dk önce`;
  return "Az önce";
}

function stackIcon(stack: string) {
  switch (stack) {
    case "react": return <Code2 size={14} className="text-[#61dafb]" />;
    case "vue":   return <Code2 size={14} className="text-[#42b883]" />;
    case "node":  return <Zap   size={14} className="text-[#68a063]" />;
    default:      return <Globe size={14} className="text-[var(--color-alloy-accent)]" />;
  }
}

function stackLabel(stack: string): string {
  const map: Record<string, string> = { html: "HTML", react: "React", vue: "Vue", node: "Node.js" };
  return map[stack] ?? stack;
}

const EXAMPLES = [
  "Kişisel portföy sitesi — fotoğrafçı için",
  "Ürün tanıtım sayfası — startup landing page",
  "Müşteri kayıt formu — veri toplama",
  "Restoran menüsü — QR kod için",
  "Blog sayfası — yazılar ve kategoriler",
  "Hesap makinesi — bilimsel fonksiyonlu",
];

// ── ProjectCard ────────────────────────────────────────────────────────────────

function ProjectCard({ project, onDelete }: { project: ProjectMeta; onDelete: (id: string) => void }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await projectsApi.delete(project.id);
      onDelete(project.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/project/${project.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/project/${project.id}`)}
      className="group relative flex flex-col gap-3 rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] p-5 cursor-pointer transition-all duration-150 hover:border-[var(--color-alloy-accent)] hover:shadow-md"
    >
      <div className="flex items-center gap-1.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-alloy-surface-hover)]">
          {stackIcon(project.stack)}
        </div>
        <span className="text-[11px] font-medium text-[var(--color-alloy-text-sec)]">
          {stackLabel(project.stack)}
        </span>
      </div>

      <div>
        <h3 className="text-[14px] font-semibold text-[var(--color-alloy-text)] leading-snug line-clamp-1">
          {project.name}
        </h3>
        <p className="mt-1 text-[12px] text-[var(--color-alloy-text-sec)] line-clamp-2 leading-relaxed">
          {project.description}
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1 text-[11px] text-[var(--color-alloy-text-dim)]">
          <Clock size={11} />
          <span>{relativeTime(project.updatedAt)}</span>
          {project.messageCount > 0 && (
            <span className="ml-1">· {project.messageCount} mesaj</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            confirmDelete
              ? "bg-red-50 text-red-600 hover:bg-red-100"
              : "text-[var(--color-alloy-text-dim)] opacity-0 group-hover:opacity-100 hover:bg-[var(--color-alloy-surface-hover)] hover:text-[var(--color-alloy-error)]"
          }`}
        >
          {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
          {confirmDelete && <span>Emin misin?</span>}
        </button>
      </div>

      <ArrowRight
        size={14}
        className="absolute right-4 top-4 text-[var(--color-alloy-accent)] opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
}

// ── CreateModal ────────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (project: ProjectMeta) => void;
}) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  async function handleCreate() {
    const trimmed = description.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const { project } = await projectsApi.create(trimmed);
      onCreate(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Oluşturulamadı");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[var(--color-alloy-border)] px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-alloy-accent-dim)]">
            <Sparkles size={18} className="text-[var(--color-alloy-accent)]" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--color-alloy-text)]">Ne inşa etmek istiyorsunuz?</h2>
            <p className="text-[12px] text-[var(--color-alloy-text-sec)]">Kendi kelimelerinizle anlatın</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && description.trim()) { e.preventDefault(); void handleCreate(); } }}
            placeholder="Örn: Bir fotoğraf galerisi sayfası…"
            rows={4}
            className="w-full resize-none rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-4 py-3 text-sm text-[var(--color-alloy-text)] placeholder:text-[var(--color-alloy-text-dim)] outline-none focus:border-[var(--color-alloy-accent)] transition-colors"
          />
          {error && <p className="text-xs text-[var(--color-alloy-error)]">{error}</p>}

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setDescription(ex)}
                className="rounded-full border border-[var(--color-alloy-border)] px-3 py-1 text-[11px] text-[var(--color-alloy-text-sec)] hover:border-[var(--color-alloy-accent)] hover:text-[var(--color-alloy-accent)] transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--color-alloy-border)] px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors">
            İptal
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!description.trim() || loading}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-alloy-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? "Oluşturuluyor…" : "Oluştur"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── EmptyState ─────────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)] mb-5">
        <Sparkles size={24} />
      </div>
      <h3 className="text-[16px] font-semibold text-[var(--color-alloy-text)]">Henüz proje yok</h3>
      <p className="mt-2 max-w-xs text-[13px] text-[var(--color-alloy-text-sec)] leading-relaxed">
        Yazılım fikrinizi anlatın, Alloy sizin için çalışan bir uygulama inşa etsin.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="mt-6 flex items-center gap-2 rounded-xl bg-[var(--color-alloy-accent)] px-5 py-2.5 text-[13px] font-medium text-white hover:opacity-90 transition-opacity"
      >
        <Sparkles size={15} />
        İlk projeyi oluştur
      </button>
    </div>
  );
}

// ── ProjectsPage ───────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => { void loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true);
    setError("");
    try {
      const { projects } = await projectsApi.list();
      setProjects(projects);
      if (projects.length === 0 && !isSetupDone()) setShowWizard(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Projeler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  function handleCreated(project: ProjectMeta) {
    setShowCreate(false);
    navigate(`/project/${project.id}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sayfa başlığı */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--color-alloy-border)]">
        <div>
          <h1 className="text-[20px] font-bold text-[var(--color-alloy-text)]">Projeler</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-alloy-text-sec)]">
            AI ile uygulama inşa et — kod bilgisi gerekmez
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-[var(--color-alloy-accent)] px-4 py-2.5 text-[13px] font-medium text-white hover:opacity-90 transition-opacity shadow-sm"
        >
          <Plus size={15} />
          Yeni proje
        </button>
      </div>

      {/* İçerik */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[var(--color-alloy-text-dim)]" />
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center py-20 gap-3">
            <p className="text-[13px] text-[var(--color-alloy-error)]">{error}</p>
            <button
              type="button"
              onClick={() => void loadProjects()}
              className="rounded-lg border border-[var(--color-alloy-border)] px-4 py-2 text-[12px] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
            >
              Tekrar dene
            </button>
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <EmptyState onNew={() => setShowCreate(true)} />
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onDelete={(id) => setProjects((prev) => prev.filter((x) => x.id !== id))} />
            ))}
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-alloy-border)] bg-transparent p-8 text-[var(--color-alloy-text-dim)] hover:border-[var(--color-alloy-accent)] hover:text-[var(--color-alloy-accent)] hover:bg-[var(--color-alloy-accent-dim)] transition-all cursor-pointer"
            >
              <Plus size={22} />
              <span className="text-[12px] font-medium">Yeni proje</span>
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />
      )}
      {showWizard && (
        <SetupWizard onDone={() => setShowWizard(false)} />
      )}
    </div>
  );
}
