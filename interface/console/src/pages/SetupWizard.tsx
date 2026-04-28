/**
 * SetupWizard — ilk kullanım rehberi (teknik olmayan kullanıcılar için).
 * Adımlar: Hoş Geldiniz → Google Hesabı Bağla → Proje Oluştur → Bitti
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, Loader2, ArrowRight, Sparkles, User, FolderPlus } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { projectsApi } from "../services/projects-api";

const SETUP_DONE_KEY = "alloy_setup_done";

export function isSetupDone(): boolean {
  try { return localStorage.getItem(SETUP_DONE_KEY) === "1"; } catch { return false; }
}

function markSetupDone() {
  try { localStorage.setItem(SETUP_DONE_KEY, "1"); } catch { /* ignore */ }
}

type Step = "welcome" | "connect" | "waiting" | "create" | "done";

interface Props { onDone: () => void; }

export function SetupWizard({ onDone }: Props) {
  const [step, setStep]         = useState<Step>("welcome");
  const [desc, setDesc]         = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [projectId, setProjectId]     = useState<string | null>(null);
  const navigate = useNavigate();
  const { accounts, addAccount, isConnecting } = useAppStore();

  useEffect(() => {
    if (step === "waiting" && accounts.length > 0) {
      setTimeout(() => setStep("create"), 600);
    }
  }, [step, accounts]);

  const handleConnect = () => { void addAccount("google"); setStep("waiting"); };

  const handleCreate = async () => {
    const trimmed = desc.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { project } = await projectsApi.create(trimmed);
      setProjectId(project.id);
      setStep("done");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Bir hata oluştu.");
    } finally { setCreating(false); }
  };

  const handleFinish = () => {
    markSetupDone();
    if (projectId) navigate(`/project/${projectId}`);
    else onDone();
  };

  const handleSkip = () => { markSetupDone(); onDone(); };

  const visibleSteps: Step[] = ["welcome", "connect", "create", "done"];
  const progressIdx = step === "waiting" ? 1 : visibleSteps.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] shadow-2xl">
        {step !== "done" && (
          <button onClick={handleSkip} className="absolute right-4 top-4 text-xs text-[var(--color-alloy-text-dim)] hover:text-[var(--color-alloy-text-sec)] transition-colors">
            Atla
          </button>
        )}

        <div className="flex items-center justify-center gap-2 px-8 pt-8 pb-2">
          {visibleSteps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i <= progressIdx ? "bg-[var(--color-alloy-accent)] w-6" : "bg-[var(--color-alloy-border)] w-3"}`} />
          ))}
        </div>

        <div className="px-8 pb-8 pt-4">
          {step === "welcome"  && <WelcomeStep onNext={() => setStep("connect")} />}
          {step === "connect"  && <ConnectStep onConnect={handleConnect} isConnecting={isConnecting} onSkip={() => setStep("create")} />}
          {step === "waiting"  && <WaitingStep accountDetected={accounts.length > 0} />}
          {step === "create"   && <CreateStep desc={desc} onChange={setDesc} onCreate={() => void handleCreate()} creating={creating} error={createError} onSkip={handleSkip} />}
          {step === "done"     && <DoneStep onFinish={handleFinish} />}
        </div>
      </div>
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-5">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]">
        <Sparkles size={32} />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-alloy-text)] mb-2">Alloy'a Hoş Geldiniz!</h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)] leading-relaxed">
          Fikirlerinizi gerçek projelere dönüştürün. Ne yapmak istediğinizi yazın — gerisini Alloy halleder.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full text-left">
        {["Web siteleri ve uygulamalar oluşturun", "Kod yazın ve düzenleyin", "Projelerinizi kolayca yönetin"].map((f) => (
          <div key={f} className="flex items-center gap-2.5 rounded-lg bg-[var(--color-alloy-surface-hover)] px-3 py-2">
            <CheckCircle size={14} className="shrink-0 text-[var(--color-alloy-accent)]" />
            <span className="text-sm text-[var(--color-alloy-text-sec)]">{f}</span>
          </div>
        ))}
      </div>
      <button onClick={onNext} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-alloy-accent)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity">
        Başlayalım <ArrowRight size={16} />
      </button>
    </div>
  );
}

function ConnectStep({ onConnect, isConnecting, onSkip }: { onConnect: () => void; isConnecting: boolean; onSkip: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-5">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]">
        <User size={32} />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-alloy-text)] mb-2">Hesabınızı Bağlayın</h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)] leading-relaxed">
          Google hesabınızla giriş yapın. Bu, Alloy'un sizin adınıza çalışmasını sağlar.
        </p>
      </div>
      <button onClick={onConnect} disabled={isConnecting} className="flex w-full items-center justify-center gap-3 rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface-hover)] px-5 py-3 text-sm font-semibold text-[var(--color-alloy-text)] hover:bg-[var(--color-alloy-border)] transition-colors disabled:opacity-50">
        {isConnecting ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon />}
        {isConnecting ? "Bağlanıyor…" : "Google ile Bağlan"}
      </button>
      <p className="text-xs text-[var(--color-alloy-text-dim)]">Hesabınız güvenli şekilde korunur.</p>
      <button onClick={onSkip} className="text-xs text-[var(--color-alloy-text-dim)] hover:text-[var(--color-alloy-text-sec)] transition-colors">
        Şimdi değil, daha sonra bağla
      </button>
    </div>
  );
}

function WaitingStep({ accountDetected }: { accountDetected: boolean }) {
  return (
    <div className="flex flex-col items-center text-center gap-5 py-4">
      <div className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-500 ${accountDetected ? "bg-emerald-50 text-emerald-600" : "bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]"}`}>
        {accountDetected ? <CheckCircle size={32} /> : <Loader2 size={32} className="animate-spin" />}
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-alloy-text)] mb-2">
          {accountDetected ? "Bağlantı Kuruldu!" : "Bağlantı Bekleniyor…"}
        </h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)] leading-relaxed">
          {accountDetected ? "Harika! Hesabınız başarıyla bağlandı." : "Google hesabınızla giriş yaptıktan sonra otomatik olarak devam edeceğiz."}
        </p>
      </div>
    </div>
  );
}

function CreateStep({ desc, onChange, onCreate, creating, error, onSkip }: {
  desc: string; onChange: (v: string) => void; onCreate: () => void;
  creating: boolean; error: string | null; onSkip: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const examples = ["Kişisel portfolyo sitesi", "Restoran menüsü sayfası", "Basit bir todo uygulaması"];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center text-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)]">
          <FolderPlus size={32} />
        </div>
        <h2 className="text-xl font-semibold text-[var(--color-alloy-text)]">İlk Projenizi Oluşturun</h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)]">Ne yapmak istiyorsunuz? Kısaca anlatın.</p>
      </div>
      <div className="flex flex-col gap-2">
        <textarea
          ref={inputRef}
          value={desc}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && desc.trim()) { e.preventDefault(); onCreate(); } }}
          placeholder="Örn: Bir fotoğraf galerisi sitesi…"
          rows={3}
          className="w-full resize-none rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-4 py-3 text-sm text-[var(--color-alloy-text)] placeholder:text-[var(--color-alloy-text-dim)] outline-none focus:border-[var(--color-alloy-accent)] transition-colors"
        />
        {error && <p className="text-xs text-[var(--color-alloy-error)]">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button key={ex} type="button" onClick={() => onChange(ex)} className="rounded-full border border-[var(--color-alloy-border)] px-3 py-1 text-xs text-[var(--color-alloy-text-sec)] hover:border-[var(--color-alloy-accent)] hover:text-[var(--color-alloy-accent)] transition-colors">
            {ex}
          </button>
        ))}
      </div>
      <button onClick={onCreate} disabled={!desc.trim() || creating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-alloy-accent)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40">
        {creating ? <><Loader2 size={16} className="animate-spin" /> Oluşturuluyor…</> : <><FolderPlus size={16} /> Projeyi Oluştur</>}
      </button>
      <button onClick={onSkip} className="text-xs text-[var(--color-alloy-text-dim)] hover:text-[var(--color-alloy-text-sec)] text-center transition-colors">
        Şimdi değil, projesiz devam et
      </button>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-5 py-2">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-emerald-100 animate-ping opacity-30" />
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle size={36} />
        </div>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-alloy-text)] mb-2">Her Şey Hazır! 🎉</h2>
        <p className="text-sm text-[var(--color-alloy-text-sec)] leading-relaxed">
          Projeniz oluşturuldu. Alloy ile birlikte inşa etmeye başlayabilirsiniz.
        </p>
      </div>
      <button onClick={onFinish} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-alloy-accent)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity">
        Projeye Git <ArrowRight size={16} />
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
