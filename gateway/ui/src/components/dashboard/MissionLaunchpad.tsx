import { useState, useCallback, useEffect } from 'react';
import { ShieldCheck, Zap, Loader2, Fingerprint, Lock, ShieldAlert, Cpu, Activity } from 'lucide-react';
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
        console.error('[Launchpad] Execution failure:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeAccount, isSubmitting, models, prompt, selectedMode, selectedModelId, setLastError, startAutonomySession]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
          e.preventDefault();
          if (prompt.trim()) handleSubmit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prompt, handleSubmit]);

  return (
    <div className="w-full max-w-6xl flex flex-col items-center space-y-10 animate-in fade-in duration-1000">
      
      {/* Header Area */}
      <div className="w-full flex items-end justify-between px-4">
        <div>
           <div className="flex items-center gap-2 mb-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-alloy-accent)] animate-pulse shadow-alloy-glow" />
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[var(--color-alloy-accent)]">System Ready</span>
           </div>
           <h1 className="text-4xl font-black text-white tracking-tighter uppercase italic">Start New Task</h1>
        </div>
        <div className="text-right">
           <span className="block text-[10px] font-bold text-white/20 uppercase tracking-widest">SYSTEM_STATUS</span>
           <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">READY_FOR_DEPLOYMENT</span>
        </div>
      </div>

      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* Left: Security & Identity Pane */}
        <div className="lg:col-span-4 flex flex-col space-y-6">
           <div className={clsx(
             "flex-1 rounded-2xl border p-6 flex flex-col transition-all duration-500",
             activeAccount ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20 shadow-[0_0_40px_rgba(239,68,68,0.05)]"
           )}>
              <div className="flex items-center justify-between mb-8">
                 <div className="flex items-center gap-3">
                    <Fingerprint size={20} className={activeAccount ? "text-emerald-400" : "text-red-400"} />
                    <span className="text-xs font-bold uppercase tracking-widest text-white">Security_Clearance</span>
                 </div>
                 {activeAccount ? (
                   <ShieldCheck size={18} className="text-emerald-400" />
                 ) : (
                   <Lock size={18} className="text-red-400" />
                 )}
              </div>

              <div className="flex-1 space-y-4">
                 {activeAccount ? (
                   <div className="p-4 bg-black/40 border border-emerald-500/10 rounded-xl">
                      <span className="block text-[9px] font-bold text-white/20 uppercase mb-2">AUTHORIZED_PRINCIPAL</span>
                      <span className="block text-xs font-mono font-bold text-emerald-400 truncate">{activeAccount}</span>
                      <div className="mt-4 h-1 w-full bg-emerald-500/10 rounded-full overflow-hidden">
                         <div className="h-full w-full bg-emerald-500 animate-[shimmer_2s_infinite]" />
                      </div>
                   </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-center relative overflow-hidden group/alert">
                         <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.1)_0%,transparent_70%)] opacity-0 group-hover/alert:opacity-100 transition-opacity duration-700" />
                         <ShieldAlert size={32} className="mx-auto mb-4 text-red-500/60 animate-pulse" />
                         <span className="block text-xs font-black text-red-400 uppercase tracking-[0.3em] mb-2">Connection Required</span>
                         <p className="text-[10px] text-white/40 font-medium uppercase leading-relaxed max-w-[200px] mx-auto">
                           Please connect an AI provider to start a coding task.
                         </p>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-3">
                        <button
                          type="button"
                          onClick={() => useAppStore.getState().addAccount('google')}
                          className="w-full relative overflow-hidden flex items-center justify-between px-5 py-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all duration-300 group/btn"
                        >
                          <div className="absolute inset-0 bg-blue-500/5 translate-x-[-100%] group-hover/btn:translate-x-0 transition-transform duration-500" />
                          <div className="flex items-center gap-4 relative z-10">
                             <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 group-hover/btn:border-blue-500/40 group-hover/btn:bg-blue-500/20 transition-all">
                                <Activity size={18} className="text-blue-400 group-hover/btn:scale-110 transition-transform" />
                             </div>
                             <div className="text-left">
                               <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-white/80 group-hover/btn:text-white">Sign in with Google</span>
                               <span className="block text-[8px] font-bold text-white/20 uppercase">Authorized OAuth</span>
                             </div>
                          </div>
                          <Zap size={14} className="text-white/10 group-hover/btn:text-blue-400 group-hover/btn:translate-x-1 transition-all" />
                        </button>

                        <button
                          type="button"
                          onClick={() => useAppStore.getState().addAccount('claude')}
                          className="w-full relative overflow-hidden flex items-center justify-between px-5 py-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-orange-500/40 hover:bg-orange-500/10 transition-all duration-300 group/btn"
                        >
                          <div className="absolute inset-0 bg-orange-500/5 translate-x-[-100%] group-hover/btn:translate-x-0 transition-transform duration-500" />
                          <div className="flex items-center gap-4 relative z-10">
                             <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 group-hover/btn:border-orange-500/40 group-hover/btn:bg-orange-500/20 transition-all">
                                <Cpu size={18} className="text-orange-400 group-hover/btn:scale-110 transition-transform" />
                             </div>
                             <div className="text-left">
                               <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-white/80 group-hover/btn:text-white">Connect Anthropic</span>
                               <span className="block text-[8px] font-bold text-white/20 uppercase">Claude 3.5 Sonnet</span>
                             </div>
                          </div>
                          <Zap size={14} className="text-white/10 group-hover/btn:text-orange-400 group-hover/btn:translate-x-1 transition-all" />
                        </button>
                      </div>
                    </div>
                  )}
              </div>

              <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                 <div className="flex gap-1.5">
                    <div className="h-1 w-4 rounded-full bg-white/10" />
                    <div className="h-1 w-8 rounded-full bg-white/20" />
                    <div className="h-1 w-4 rounded-full bg-white/10" />
                 </div>
                 <span className="text-[8px] font-bold text-white/10 uppercase tracking-[0.3em]">SECURE_LINK_ACTIVE</span>
              </div>
           </div>
        </div>

        {/* Right: Command Input Pane */}
        <div className="lg:col-span-8 flex flex-col space-y-6">
           <form onSubmit={handleSubmit} className="flex-1 flex flex-col bg-black/40 border border-white/5 rounded-3xl overflow-hidden relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-alloy-accent)]/5 to-transparent opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
              
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02] relative z-10">
                 <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                       <Cpu size={14} className="text-[var(--color-alloy-accent)]/60" />
                       <select 
                        value={selectedModelId || ''}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="bg-transparent border-none p-0 text-[10px] text-white font-black uppercase tracking-widest focus:ring-0 cursor-pointer"
                      >
                        {models.map(m => (
                          <option key={m.id} value={m.id} className="bg-[#0b0b0b]">{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="h-3 w-px bg-white/10" />
                    <div className="flex gap-2">
                      {(['smart_multi', 'fast_only'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setSelectedMode(mode)}
                          className={clsx(
                            "px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                            selectedMode === mode 
                              ? "bg-[var(--color-alloy-accent)]/20 text-[var(--color-alloy-accent)] border border-[var(--color-alloy-accent)]/20" 
                              : "text-white/20 hover:text-white/40"
                          )}
                        >
                          {mode === 'smart_multi' ? 'Strategic Model' : 'Fast Response'}
                        </button>
                      ))}
                    </div>
                 </div>
                 <BudgetWidget />
              </div>

              <div className="flex-1 min-h-0 relative z-10">
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
                  placeholder="How can I help you today? Describe your task..."
                  className="w-full h-full bg-transparent border-none focus:ring-0 text-white placeholder-white/5 p-8 text-xl resize-none font-mono leading-relaxed selection:bg-[var(--color-alloy-accent)]/20"
                />
              </div>

              <div className="px-6 py-4 flex items-center justify-between border-t border-white/5 bg-white/[0.02] relative z-10">
                 <div className="flex gap-3">
                   {['Bug Fix', 'Code Analysis', 'Redactor', 'Unit Tests'].map(tag => (
                      <button 
                        key={tag}
                        type="button"
                        onClick={() => setPrompt(`e.g. ${tag} ...`)}
                        className="text-[9px] font-bold text-white/20 hover:text-white transition-colors uppercase tracking-widest"
                      >
                        {tag}
                      </button>
                   ))}
                 </div>

                 <button
                    type="submit"
                    disabled={!prompt.trim() || isSubmitting || !activeAccount}
                    className={clsx(
                      "flex items-center gap-3 px-10 py-3 rounded-xl font-black uppercase tracking-[0.2em] transition-all active:scale-95 text-[11px]",
                      prompt.trim() && activeAccount
                        ? "bg-white text-black hover:bg-[var(--color-alloy-accent)] shadow-alloy-glow" 
                        : "bg-white/5 text-white/10 cursor-not-allowed border border-white/5"
                    )}
                  >
                    {isSubmitting ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      <Activity size={16} className={prompt.trim() && activeAccount ? "animate-pulse" : ""} />
                    )}
                    <span>Run AI Engine</span>
                  </button>
              </div>
           </form>
        </div>
      </div>

      {/* Bottom Telemetry Mini-Preview */}
      <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 opacity-40 hover:opacity-100 transition-opacity duration-700">
         <div className="p-4 rounded-2xl border border-white/5 bg-black/20">
            <PhaseStatusCard session={null} />
         </div>
         <div className="p-4 rounded-2xl border border-white/5 bg-black/20">
            <GearStatusCard session={null} />
         </div>
         <div className="hidden lg:flex p-4 rounded-2xl border border-white/5 bg-black/20 flex-col justify-center items-center text-center">
            <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-1">LATENCY_P50</span>
            <span className="text-lg font-black text-white font-mono">--ms</span>
         </div>
         <div className="hidden lg:flex p-4 rounded-2xl border border-white/5 bg-black/20 flex-col justify-center items-center text-center">
            <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-1">NETWORK_THRPT</span>
            <span className="text-lg font-black text-emerald-400 font-mono">GIGABIT</span>
         </div>
      </div>
    </div>
  );
}
