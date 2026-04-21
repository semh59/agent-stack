import { useState, useCallback, useEffect } from 'react';
import { Bot, ShieldCheck, Terminal, Zap, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { BudgetWidget } from './BudgetWidget';
import { PhaseStatusCard, GearStatusCard } from '../autonomy/StatusCards';

const DEFAULT_SCOPE_PATHS = ['src', 'ui', 'docs', 'vscode-extension'];
const DEFAULT_AUTONOMY_BUDGET = {
  maxCycles: 12,
  maxDurationMs: 45 * 60 * 1000,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 400_000,
  maxTPM: 1_000_000,
  maxRPD: 5_000,
  maxUsd: 0,
};

function resolveAnchorModel(
  selectedMode: 'smart_multi' | 'fast_only' | 'pro_only',
  selectedModelId: string | null,
  models: Array<{ id: string; name: string }>,
): string | null {
  if (selectedMode === 'fast_only') {
    return models.find((model) => model.id.toLowerCase().includes('flash'))?.id ?? selectedModelId ?? models[0]?.id ?? null;
  }
  if (selectedMode === 'pro_only') {
    return (
      models.find((model) => {
        const normalized = model.id.toLowerCase();
        return normalized.includes('opus') || normalized.includes('thinking') || normalized.includes('high');
      })?.id ??
      selectedModelId ??
      models[0]?.id ??
      null
    );
  }
  return selectedModelId ?? models[0]?.id ?? null;
}

export function MissionLaunchpad() {
  const {
    startAutonomySession,
    models,
    activeAccount,
    selectedModelId,
    selectedMode,
    setSelectedModel,
    setSelectedMode,
    setLastError,
  } = useAppStore(
    useShallow((state) => ({
      startAutonomySession: state.startAutonomySession,
      models: state.models,
      activeAccount: state.activeAccount,
      selectedModelId: state.selectedModelId,
      selectedMode: state.selectedMode,
      setSelectedModel: state.setSelectedModel,
      setSelectedMode: state.setSelectedMode,
      setLastError: state.setLastError,
    }))
  );

  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!prompt.trim() || isSubmitting) return;

      if (!activeAccount) {
        setLastError('Active account required to start autonomous session.');
        return;
      }

      const anchorModel = resolveAnchorModel(selectedMode, selectedModelId, models);
      if (!anchorModel) {
        setLastError('At least one model must be selected.');
        return;
      }

      setIsSubmitting(true);
      try {
        await startAutonomySession({
          account: activeAccount,
          anchorModel,
          objective: prompt.trim(),
          scope: { mode: 'selected_only', paths: DEFAULT_SCOPE_PATHS },
          modelPolicy: 'smart_multi',
          startMode: 'immediate',
          reviewAfterPlan: true,
          budget: DEFAULT_AUTONOMY_BUDGET,
        });
        setPrompt('');
      } catch (err) {
        console.error('Pipeline launch error:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeAccount, isSubmitting, models, prompt, selectedMode, selectedModelId, setLastError, startAutonomySession]
  );

  // Keyboard Shortcuts for Launchpad
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
          e.preventDefault();
          if (prompt.trim()) {
            handleSubmit();
          }
        }
      }
      if (e.key === 'Escape') {
        setPrompt('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prompt, handleSubmit]);

  return (
    <div className="w-full max-w-4xl flex flex-col items-center space-y-12 animate-in fade-in zoom-in-95 duration-1000">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[var(--color-alloy-accent)]/5 border border-[var(--color-alloy-accent)]/10 mb-2 group shadow-2xl">
          <Bot size={40} className="text-[var(--color-alloy-accent)] group-hover:scale-110 transition-transform duration-500" />
        </div>
        <h1 className="text-5xl font-bold text-white tracking-tighter glow-accent">MISSION OBJECTIVE</h1>
        <p className="text-[var(--color-alloy-text-sec)] text-sm font-medium uppercase tracking-[0.4em]">Strategic Autonomous Control Center</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--color-alloy-accent)] to-blue-600 rounded-3xl blur opacity-10 group-hover:opacity-25 transition duration-700" />
        <div className="relative glass-card rounded-3xl p-3 shadow-2xl border-white/5 group-hover:border-[var(--color-alloy-accent)]/20 transition-colors duration-500">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 mb-2">
            <div className="flex items-center gap-2 bg-black/40 rounded-xl px-3 py-1.5 border border-white/5">
              <Bot size={14} className="text-[var(--color-alloy-accent)]" />
              <select 
                value={selectedModelId || ''}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent border-none p-0 text-[10px] text-white font-bold uppercase tracking-wider focus:ring-0 cursor-pointer"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id} className="bg-[#0f0f0f]">{m.name}</option>
                ))}
              </select>
            </div>

            <div className="flex bg-black/40 rounded-xl p-1 border border-white/5">
              {(['smart_multi', 'fast_only'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSelectedMode(mode)}
                  className={clsx(
                    "px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                    selectedMode === mode 
                      ? "bg-[var(--color-alloy-accent)] text-black shadow-[0_0_12px_rgba(var(--color-alloy-accent-rgb),0.4)]" 
                      : "text-gray-500 hover:text-gray-300"
                  )}
                >
                  {mode === 'smart_multi' ? 'Strategic' : 'Fast'}
                </button>
              ))}
            </div>
            <BudgetWidget />
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            autoFocus
            placeholder="Enter mission parameters (Code analysis, refactor, test fix...)"
            className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-white/20 p-6 min-h-[160px] text-xl resize-none font-mono leading-relaxed tracking-tight"
          />

          <div className="flex items-center justify-between px-6 pb-4">
            <div className="flex gap-6 text-[10px] text-gray-600 font-black uppercase tracking-[0.2em]">
              <span className="flex items-center gap-2 hover:text-[var(--color-alloy-accent)] transition-colors cursor-default"><ShieldCheck size={14} /> Architect Mode</span>
              <span className="flex items-center gap-2 hover:text-[var(--color-alloy-accent)] transition-colors cursor-default"><Terminal size={14} /> Full Autonomy</span>
            </div>
            <button
              type="submit"
              disabled={!prompt.trim() || isSubmitting}
              className={clsx(
                "group relative flex items-center gap-3 px-8 py-3.5 rounded-2xl font-black uppercase tracking-widest transition-all duration-500 btn-elite",
                prompt.trim() 
                  ? "bg-white text-black hover:bg-[var(--color-alloy-accent)] hover:scale-[1.05] active:scale-95 shadow-2xl glow-on-hover" 
                  : "bg-white/5 text-gray-700 cursor-not-allowed border border-white/5"
              )}
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} className="fill-current" />}
              <span>Execute</span>
            </button>
          </div>
        </div>
      </form>

      <div className="flex gap-4 animate-in fade-in slide-in-from-top-4 duration-1000 delay-500">
        {['Bug Fix', 'Code Analysis', 'Refactor', 'New Feature'].map(tag => (
          <button 
            key={tag}
            onClick={() => setPrompt(`e.g. ${tag} ...`)}
            className="px-4 py-1.5 rounded-full bg-white/5 border border-white/5 text-[9px] text-gray-500 font-bold uppercase tracking-widest hover:border-[var(--color-alloy-accent)]/30 hover:text-white transition-all"
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        <PhaseStatusCard session={null} />
        <GearStatusCard session={null} />
      </div>
    </div>
  );
}
