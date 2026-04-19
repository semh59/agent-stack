import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Zap, Bot, ShieldCheck, Terminal, CheckCircle2, AlertCircle, Loader2, Cpu, Activity, Database, Globe } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { clsx } from 'clsx';
import { TokenUsageChart } from '../components/dashboard/TokenUsageChart';
import { DecisionMatrix } from '../components/telemetry/DecisionMatrix';
import { GearStatusCard, PhaseStatusCard } from '../components/autonomy/StatusCards';
import { BudgetWidget } from '../components/dashboard/BudgetWidget';
import { WidgetErrorBoundary } from '../components/WidgetErrorBoundary';

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

export function DashboardView() {
  const { 
    startAutonomySession,
    pipelineStatus, 
    autonomySession,
    autonomyTimeline,
    models,
    activeAccount,
    selectedModelId,
    selectedMode,
    activeSessionId,
    fetchQuota,
    fetchModels,
    setSelectedModel,
    setSelectedMode,
    setLastError,
    stopAutonomySession
  } = useAppStore(useShallow(state => ({
    startAutonomySession: state.startAutonomySession,
    pipelineStatus: state.pipelineStatus, 
    autonomySession: state.autonomySession,
    autonomyTimeline: state.autonomyTimeline,
    models: state.models,
    activeAccount: state.activeAccount,
    selectedModelId: state.selectedModelId,
    selectedMode: state.selectedMode,
    activeSessionId: state.activeSessionId,
    fetchQuota: state.fetchQuota,
    fetchModels: state.fetchModels,
    setSelectedModel: state.setSelectedModel,
    setSelectedMode: state.setSelectedMode,
    setLastError: state.setLastError,
    stopAutonomySession: state.stopAutonomySession
  })));
  const navigate = useNavigate();
  
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: autonomyTimeline.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36, // yaklasik satir yuksekligi
    overscan: 5,
  });

  // Initial data fetch and Visibility-Aware Polling
  useEffect(() => {
    fetchModels();
    fetchQuota();
    
    let interval: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (!interval) {
        interval = setInterval(fetchQuota, 30000);
      }
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchQuota(); // fetch immediately on return
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Start initially if visible
    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchModels, fetchQuota, activeAccount]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autonomyTimeline, pipelineStatus]);

  const isRunning = autonomySession
    ? !['done', 'failed', 'stopped'].includes(autonomySession.state)
    : pipelineStatus?.state?.pipelineStatus === 'running';
  
  // Reset isStopping when running status changes
  useEffect(() => {
    if (!isRunning) setIsStopping(false);
  }, [isRunning]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || isSubmitting) return;

    if (!activeAccount) {
      setLastError('Aktif hesap olmadan otonom oturum baslatilamaz.');
      return;
    }

    const anchorModel = resolveAnchorModel(selectedMode, selectedModelId, models);
    if (!anchorModel) {
      setLastError('Baslatmak icin en az bir model secili olmali.');
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
      console.error("Pipeline başlatma hatası:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeAccount, isSubmitting, models, prompt, selectedMode, selectedModelId, setLastError, startAutonomySession]);

  const handleStop = useCallback(async () => {
    if (!isRunning || isStopping) return;
    setIsStopping(true);
    try {
      await stopAutonomySession("User requested stop via UI shortcut");
    } catch (err) {
      console.error("Stop error:", err);
      setIsStopping(false);
    }
  }, [isRunning, isStopping, stopAutonomySession]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Enter or Ctrl+Enter to submit
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
          e.preventDefault();
          if (prompt.trim() && !isRunning) {
            handleSubmit();
          }
        }
      }
      // Esc to Stop or Clear
      if (e.key === 'Escape') {
        if (isRunning) {
          handleStop();
        } else {
          setPrompt('');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prompt, isRunning, handleSubmit, handleStop]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-loji-bg)] font-mono selection:bg-[var(--color-loji-accent)]/30">
      
      {/* Header Area - High Density Telemetry */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-[var(--color-loji-border)] bg-[var(--color-loji-surface)]/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[var(--color-loji-accent)] shadow-[0_0_8px_var(--color-loji-accent)]" />
            <span className="text-[11px] font-bold text-white uppercase tracking-[0.3em] glow-accent">LOJINEXT ELITE</span>
          </div>
          <div className="h-4 w-[1px] bg-white/10" />
          <div className="flex items-center gap-3 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
            <span className="flex items-center gap-1.5 opacity-50 cursor-help" title="Simulation Mode">
              <Cpu size={12} className="text-[var(--color-loji-accent)]" /> 
              <span className="text-[8px] bg-white/5 px-1 rounded mr-1 text-gray-600">DEMO</span>
              CPU: OPTIMAL
            </span>
            <span className="flex items-center gap-1.5 opacity-50 cursor-help" title="Simulation Mode">
              <Database size={12} className="text-[var(--color-loji-success)]" /> 
              <span className="text-[8px] bg-white/5 px-1 rounded mr-1 text-gray-600">DEMO</span>
              DB: SYNCED
            </span>
            <span className="flex items-center gap-1.5 opacity-50 cursor-help" title="Simulation Mode">
              <Globe size={12} className="text-blue-400" /> 
              <span className="text-[8px] bg-white/5 px-1 rounded mr-1 text-gray-600">DEMO</span>
              API: 12ms
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1 bg-[var(--color-loji-accent)]/5 border border-[var(--color-loji-accent)]/20 rounded-md">
            <Activity size={12} className="text-[var(--color-loji-accent)] animate-pulse" />
            <span className="text-[9px] text-[var(--color-loji-accent)] font-bold uppercase tracking-widest">Otonom Çekirdek Aktif</span>
          </div>
          <div className="text-[10px] text-gray-600 font-mono tracking-tighter">
            PROJ: ANTIGRAVITY v1.9.4
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-hidden relative">
        
        {/* Elite Ambient Effects */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-[var(--color-loji-accent)]/40 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(var(--color-loji-accent-rgb),0.03)_0%,transparent_70%)] pointer-events-none" />

        {!autonomySession && !isRunning && autonomyTimeline.length === 0 ? (
          /* Magic Box 2.0 - Empty State */
          <div className="w-full max-w-4xl flex flex-col items-center space-y-12 animate-in fade-in zoom-in-95 duration-1000">
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[var(--color-loji-accent)]/5 border border-[var(--color-loji-accent)]/10 mb-2 group shadow-2xl">
                <Bot size={40} className="text-[var(--color-loji-accent)] group-hover:scale-110 transition-transform duration-500" />
              </div>
              <h1 className="text-5xl font-bold text-white tracking-tighter glow-accent">NE YAPALIM?</h1>
              <p className="text-[var(--color-loji-text-sec)] text-sm font-medium uppercase tracking-[0.4em]">Stratejik Otonom İşlem Merkezi</p>
            </div>

            <form onSubmit={handleSubmit} className="w-full relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--color-loji-accent)] to-blue-600 rounded-3xl blur opacity-10 group-hover:opacity-25 transition duration-700" />
              <div className="relative glass-card rounded-3xl p-3 shadow-2xl border-white/5 group-hover:border-[var(--color-loji-accent)]/20 transition-colors duration-500">
                
                {/* Elite Magic Toolbar */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 mb-2">
                  <div className="flex items-center gap-2 bg-black/40 rounded-xl px-3 py-1.5 border border-white/5">
                    <Bot size={14} className="text-[var(--color-loji-accent)]" />
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
                            ? "bg-[var(--color-loji-accent)] text-black shadow-[0_0_12px_rgba(var(--color-loji-accent-rgb),0.4)]" 
                            : "text-gray-500 hover:text-gray-300"
                        )}
                      >
                        {mode === 'smart_multi' ? 'Stratejik' : 'Hızlı'}
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
                  placeholder="Görev parametrelerini girin (Kod analizi, refactor, test fix...)"
                  className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-white/20 p-6 min-h-[160px] text-xl resize-none font-mono leading-relaxed tracking-tight"
                />

                <div className="flex items-center justify-between px-6 pb-4">
                  <div className="flex gap-6 text-[10px] text-gray-600 font-black uppercase tracking-[0.2em]">
                    <span className="flex items-center gap-2 hover:text-[var(--color-loji-accent)] transition-colors cursor-default"><ShieldCheck size={14} /> Architect Mode</span>
                    <span className="flex items-center gap-2 hover:text-[var(--color-loji-accent)] transition-colors cursor-default"><Terminal size={14} /> Full Autonomy</span>
                  </div>
                  <button
                    type="submit"
                    disabled={!prompt.trim() || isSubmitting}
                    className={clsx(
                      "group relative flex items-center gap-3 px-8 py-3.5 rounded-2xl font-black uppercase tracking-widest transition-all duration-500 btn-elite",
                      prompt.trim() 
                        ? "bg-white text-black hover:bg-[var(--color-loji-accent)] hover:scale-[1.05] active:scale-95 shadow-2xl glow-on-hover" 
                        : "bg-white/5 text-gray-700 cursor-not-allowed border border-white/5"
                    )}
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} className="fill-current" />}
                    <span>Göreceğiz</span>
                  </button>
                </div>
              </div>
            </form>

            <div className="flex gap-4 animate-in fade-in slide-in-from-top-4 duration-1000 delay-500">
              {['Bug Fix', 'Kod Analizi', 'Refactor', 'Yeni Fonksiyon'].map(tag => (
                <button 
                  key={tag}
                  onClick={() => setPrompt(`Örn: ${tag} yap...`)}
                  className="px-4 py-1.5 rounded-full bg-white/5 border border-white/5 text-[9px] text-gray-500 font-bold uppercase tracking-widest hover:border-[var(--color-loji-accent)]/30 hover:text-white transition-all"
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
        ) : (
          /* Active State - Terminal Flow 2.0 */
          <div className="w-full h-full flex gap-6 animate-in fade-in duration-700">
            {/* Left Column: Terminal & Mission Control */}
            <div className="flex-1 flex flex-col space-y-6 min-w-0">
              {autonomySession?.reviewStatus === 'plan_pending' ? (
                <button
                  type="button"
                  onClick={() => navigate(`/pipeline/${autonomySession.id}/plan`)}
                  className="flex items-center justify-between rounded-2xl border border-amber-400/20 bg-amber-500/5 px-5 py-4 text-left shadow-lg transition-colors hover:bg-amber-500/10"
                >
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">Plan Onayi Bekliyor</div>
                    <p className="mt-2 text-sm font-semibold text-white">Plan checkpoint aktif. Inceleme ekranina gec ve approve/reject karari ver.</p>
                  </div>
                  <span className="rounded-full border border-amber-400/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-300">
                    Incele
                  </span>
                </button>
              ) : null}
              {/* Mission Control Panel */}
            <div className="glass-card rounded-2xl p-6 flex items-center justify-between shadow-2xl border-white/5 border-t-[var(--color-loji-accent)]/20 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-2 opacity-5">
                <Terminal size={120} />
              </div>

              <div className="flex items-center gap-5 relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-[var(--color-loji-accent)]/10 flex items-center justify-center border border-[var(--color-loji-accent)]/20 shadow-inner group-hover:scale-110 transition-transform duration-500">
                  <Activity size={28} className="text-[var(--color-loji-accent)]" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-[var(--color-loji-accent)]/10 border border-[var(--color-loji-accent)]/20 rounded text-[9px] text-[var(--color-loji-accent)] font-black uppercase">Aktif İstasyon</span>
                    <h3 className="text-white font-bold text-lg tracking-tight">OPERASYON: {activeSessionId?.slice(0, 8).toUpperCase()}</h3>
                  </div>
                  <p className="text-[var(--color-loji-text-sec)] text-xs font-mono tracking-tight line-clamp-1 border-l-2 border-[var(--color-loji-accent)]/30 pl-3">
                    {autonomySession?.objective || pipelineStatus?.state?.userTask || "Sistem hedefleri dogrultusunda otonom surec devam ediyor."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-3 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[9px] text-gray-600 font-black uppercase tracking-[0.2em] mb-1">Döngü Verimliliği</div>
                    <div className="text-sm font-bold text-white font-mono tracking-widest">
                      {pipelineStatus?.completedCount || 0}/{pipelineStatus?.totalAgents || "∞"}
                    </div>
                  </div>
                  <div className="w-48 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                    <div 
                      className="h-full bg-gradient-to-r from-[var(--color-loji-accent)] via-blue-500 to-[var(--color-loji-accent)] transition-all duration-1000 shadow-[0_0_15px_rgba(var(--color-loji-accent-rgb),0.6)] animate-pulse" 
                      style={{ width: `${Math.round(((pipelineStatus?.completedCount || 0) / Math.max(pipelineStatus?.totalAgents || 1, 1)) * 100)}%` }} 
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* High Density Terminal Timeline */}
            <div className="flex-1 flex flex-col min-h-0 bg-black/40 border border-white/5 rounded-2xl shadow-inner overflow-hidden">
               <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
                 <div className="flex items-center gap-2">
                   <div className="flex gap-1.5">
                     <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
                     <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" />
                     <div className="w-2.5 h-2.5 rounded-full bg-green-500/20" />
                   </div>
                   <span className="text-[9px] text-gray-500 font-black tracking-widest uppercase ml-2">Session_Stdout.log</span>
                 </div>
                 <div className="text-[9px] text-gray-600 font-mono">
                   UTF-8 | TS_ORCHESTRATOR
                 </div>
               </div>

               <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 custom-scrollbar font-mono leading-tight relative"
               >
                 <div
                   style={{
                     height: `${rowVirtualizer.getTotalSize()}px`,
                     width: '100%',
                     position: 'relative',
                   }}
                 >
                   {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                     const idx = virtualItem.index;
                     const item = autonomyTimeline[idx];
                     return (
                      <div 
                        key={item.id || idx} 
                        ref={rowVirtualizer.measureElement}
                        data-index={idx}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                        className={clsx(
                          "flex gap-3 group px-2 py-1 rounded transition-colors timeline-item-enter",
                          idx === autonomyTimeline.length - 1 ? "bg-white/5 border-l-2 border-[var(--color-loji-accent)]" : "hover:bg-white/[0.02]"
                        )}
                      >
                        <span className="text-[10px] text-gray-700 shrink-0 select-none">
                          [{new Date(item.timestamp).toLocaleTimeString([], { hour12: false })}]
                        </span>
                        <div className="shrink-0 mt-0.5">
                          {item.type === 'tool' ? <Terminal size={12} className="text-blue-500/60" /> :
                           item.type === 'success' ? <CheckCircle2 size={12} className="text-[var(--color-loji-success)]/60" /> :
                           item.type === 'error' ? <AlertCircle size={12} className="text-[var(--color-loji-error)]/60" /> :
                           <Zap size={12} className="text-[var(--color-loji-accent)]/80" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={clsx(
                            "text-[12px] break-words",
                            item.type === 'error' ? "text-red-400" : 
                            item.type === 'success' ? "text-[var(--color-loji-success)]" :
                            "text-gray-300"
                          )}>
                            {item.message}
                          </p>
                        </div>
                      </div>
                     );
                   })}
                 </div>
                
                {isRunning && (
                  <div className="flex gap-3 px-2 py-2 mt-4">
                    <span className="text-[10px] text-[var(--color-loji-accent)] animate-pulse shrink-0">$</span>
                    <div className="flex items-center gap-2">
                       <span className="text-[12px] text-gray-500 italic">Analiz ediliyor...</span>
                       <div className="flex gap-1">
                          <div className="w-1 h-1 bg-[var(--color-loji-accent)] rounded-full animate-bounce [animation-delay:-0.3s]" />
                          <div className="w-1 h-1 bg-[var(--color-loji-accent)] rounded-full animate-bounce [animation-delay:-0.15s]" />
                          <div className="w-1 h-1 bg-[var(--color-loji-accent)] rounded-full animate-bounce" />
                       </div>
                    </div>
                  </div>
                )}
               </div>
            </div>

            {/* Interaction Layer */}
            <div className="flex gap-4 p-2">
               <div className="flex-1 relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 transition-colors group-focus-within:text-[var(--color-loji-accent)]">
                    <Terminal size={16} />
                  </div>
                  <input 
                    type="text"
                    placeholder="Ek talimat veya kod parçası gönder..."
                    className="w-full bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-sm text-white focus:outline-none focus:border-[var(--color-loji-accent)]/30 focus:bg-white/[0.08] transition-all font-mono placeholder-gray-700 shadow-2xl"
                  />
               </div>
                <button 
                  onClick={handleStop}
                  disabled={isStopping}
                  className={clsx(
                    "px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all active:scale-95 shadow-lg group flex items-center gap-3 btn-elite",
                    isStopping 
                      ? "bg-gray-500/10 border-gray-500/20 text-gray-500 cursor-wait" 
                      : "bg-red-500/5 border-red-500/20 text-red-500 hover:bg-red-500/20 hover:text-red-400"
                  )}
                >
                  {isStopping ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  )}
                  {isStopping ? 'Durduruluyor...' : 'Durdur (ESC)'}
                </button>
               </div>
            </div>

            {/* Right Column: Analytics & Insights */}
            <div className="w-80 flex flex-col space-y-6 shrink-0">
              <PhaseStatusCard session={autonomySession} />
              <GearStatusCard session={autonomySession} />
              {activeSessionId && (
                <>
                  <WidgetErrorBoundary widgetName="Token Usage">
                    <TokenUsageChart sessionId={activeSessionId} />
                  </WidgetErrorBoundary>
                  <WidgetErrorBoundary widgetName="Decision Matrix">
                    <DecisionMatrix sessionId={activeSessionId} />
                  </WidgetErrorBoundary>
                </>
              )}
              
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                 <div className="text-[10px] text-emerald-500 font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                   <ShieldCheck size={12} /> System Health
                 </div>
                 <div className="space-y-2">
                   <div className="flex justify-between text-[11px]">
                     <span className="text-white/40">Integrity</span>
                     <span className="text-emerald-400 font-mono">100%</span>
                   </div>
                   <div className="flex justify-between text-[11px]">
                     <span className="text-white/40">Uptime</span>
                     <span className="text-emerald-400 font-mono">99.9%</span>
                   </div>
                 </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
