import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal, Loader2, Activity } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { clsx } from 'clsx';
import { TokenUsageChart } from '../components/dashboard/TokenUsageChart';
import { TerminalTimeline } from '../components/dashboard/TerminalTimeline';
import { MissionLaunchpad } from '../components/dashboard/MissionLaunchpad';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { DecisionMatrix } from '../components/telemetry/DecisionMatrix';
import { GearStatusCard, PhaseStatusCard } from '../components/autonomy/StatusCards';
import { WidgetErrorBoundary } from '../components/WidgetErrorBoundary';



export function DashboardView() {
  const { 
    pipelineStatus, 
    autonomySession,
    autonomyTimeline,
    activeAccount,
    activeSessionId,
    fetchQuota,
    fetchModels,
    stopAutonomySession
  } = useAppStore(useShallow(state => ({
    pipelineStatus: state.pipelineStatus, 
    autonomySession: state.autonomySession,
    autonomyTimeline: state.autonomyTimeline,
    activeAccount: state.activeAccount,
    activeSessionId: state.activeSessionId,
    fetchQuota: state.fetchQuota,
    fetchModels: state.fetchModels,
    stopAutonomySession: state.stopAutonomySession
  })));
  const navigate = useNavigate();
  
  const [inputVal, setInputVal] = useState('');
  const [isStopping, setIsStopping] = useState(false);

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

  const isRunning = autonomySession
    ? !['done', 'failed', 'stopped'].includes(autonomySession.state)
    : pipelineStatus?.state?.pipelineStatus === 'running';
  
  // Reset isStopping when running status changes
  useEffect(() => {
    if (!isRunning && isStopping) {
      setTimeout(() => setIsStopping(false), 0);
    }
  }, [isRunning, isStopping]);



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

  // Keyboard Shortcuts (only map esc for global stop since prompt is moved)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isRunning) {
        handleStop();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRunning, handleStop]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-alloy-bg)] font-mono selection:bg-[var(--color-alloy-accent)]/30">
      
      <DashboardHeader />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-hidden relative">
        
        {/* Elite Ambient Effects */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-[var(--color-alloy-accent)]/40 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(var(--color-alloy-accent-rgb),0.03)_0%,transparent_70%)] pointer-events-none" />

        {!autonomySession && !isRunning && autonomyTimeline.length === 0 ? (
          <MissionLaunchpad />
        ) : (
          /* Active State - Terminal Flow */
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
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">Plan Review Pending</div>
                    <p className="mt-2 text-sm font-semibold text-white">Plan checkpoint active. Review the plan and approve or reject.</p>
                  </div>
                  <span className="rounded-full border border-amber-400/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-300">
                    Incele
                  </span>
                </button>
              ) : null}
              {/* Mission Control Panel */}
            <div className="glass-card rounded-2xl p-6 flex items-center justify-between shadow-2xl border-white/5 border-t-[var(--color-alloy-accent)]/20 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-2 opacity-5">
                <Terminal size={120} />
              </div>

              <div className="flex items-center gap-5 relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-[var(--color-alloy-accent)]/10 flex items-center justify-center border border-[var(--color-alloy-accent)]/20 shadow-inner group-hover:scale-110 transition-transform duration-500">
                  <Activity size={28} className="text-[var(--color-alloy-accent)]" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-[var(--color-alloy-accent)]/10 border border-[var(--color-alloy-accent)]/20 rounded text-[9px] text-[var(--color-alloy-accent)] font-black uppercase">Active Mission</span>
                    <h3 className="text-white font-bold text-lg tracking-tight">OPERASYON: {activeSessionId?.slice(0, 8).toUpperCase()}</h3>
                  </div>
                  <p className="text-[var(--color-alloy-text-sec)] text-xs font-mono tracking-tight line-clamp-1 border-l-2 border-[var(--color-alloy-accent)]/30 pl-3">
                    {autonomySession?.objective || pipelineStatus?.state?.userTask || "Autonomous process operating towards system objectives."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-3 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[9px] text-gray-600 font-black uppercase tracking-[0.2em] mb-1">Cycle Efficiency</div>
                    <div className="text-sm font-bold text-white font-mono tracking-widest">
                      {pipelineStatus?.completedCount || 0}/{pipelineStatus?.totalAgents || "∞"}
                    </div>
                  </div>
                  <div className="w-48 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                    <div 
                      className="h-full bg-gradient-to-r from-[var(--color-alloy-accent)] via-blue-500 to-[var(--color-alloy-accent)] transition-all duration-1000 shadow-[0_0_15px_rgba(var(--color-alloy-accent-rgb),0.6)] animate-pulse" 
                      style={{ width: `${Math.round(((pipelineStatus?.completedCount || 0) / Math.max(pipelineStatus?.totalAgents || 1, 1)) * 100)}%` }} 
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* High Density Terminal Timeline */}
            <TerminalTimeline />

            {/* Interaction Layer */}
            <div className="flex gap-4 p-2">
               <div className="flex-1 relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 transition-colors group-focus-within:text-[var(--color-alloy-accent)]">
                    <Terminal size={16} />
                  </div>
                  <input 
                    type="text"
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    placeholder="Send additional instructions or code snippet..."
                    className="w-full bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-sm text-white focus:outline-none focus:border-[var(--color-alloy-accent)]/30 focus:bg-white/[0.08] transition-all font-mono placeholder-gray-700 shadow-2xl"
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
                  {isStopping ? 'Stopping...' : 'Stop (ESC)'}
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
