import { useCallback } from 'react';
import { Terminal, Activity, Zap, Gauge } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { TerminalTimeline } from '../components/dashboard/TerminalTimeline';
import { MissionLaunchpad } from '../components/dashboard/MissionLaunchpad';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { DecisionMatrix } from '../components/telemetry/DecisionMatrix';
import { GearStatusCard, PhaseStatusCard } from '../components/autonomy/StatusCards';

export function DashboardView() {
  const { 
    pipelineStatus, 
    autonomySession,
    autonomyTimeline,
    activeSessionId,
    stopAutonomySession
  } = useAppStore(useShallow(state => ({
    pipelineStatus: state.pipelineStatus, 
    autonomySession: state.autonomySession,
    autonomyTimeline: state.autonomyTimeline,
    activeSessionId: state.activeSessionId,
    stopAutonomySession: state.stopAutonomySession
  })));

  const isRunning = autonomySession
    ? !['done', 'failed', 'stopped'].includes(autonomySession.state)
    : pipelineStatus?.state?.pipelineStatus === 'running';

  const handleStop = useCallback(() => {
    if (activeSessionId) {
      void stopAutonomySession();
    }
  }, [activeSessionId, stopAutonomySession]);

  const sessionIdStr = activeSessionId || "IDLE";

  return (
    <div className="flex h-full flex-col bg-[var(--color-alloy-bg)] selection:bg-[var(--color-alloy-accent)]/30 overflow-hidden">
      
      <DashboardHeader />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center p-8 overflow-hidden relative">
        
        {/* Command Grid Backdrop */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(var(--color-alloy-accent-rgb),0.02)_0%,transparent_80%)] pointer-events-none" />

        {!autonomySession && !isRunning && autonomyTimeline.length === 0 ? (
          <MissionLaunchpad />
        ) : (
          /* Mission Control - War Room Layout */
          <div className="w-full h-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* Top Stat Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
               <StatCard 
                 label="SESSION_ID" 
                 value={sessionIdStr.slice(0, 8).toUpperCase()} 
                 icon={<Terminal size={14} />} 
               />
               <StatCard 
                 label="AGENT_CYCLES" 
                 value={`${pipelineStatus?.completedCount || 0} / ${pipelineStatus?.totalAgents || "∞"}`} 
                 icon={<Activity size={14} />}
               />
               <StatCard 
                 label="COMPUTE_EFFICIENCY" 
                 value="0.94x" 
                 icon={<Zap size={14} />}
                 pulse
               />
               <StatCard 
                 label="LATENCY_P95" 
                 value="142ms" 
                 icon={<Gauge size={14} />}
               />
            </div>

            {/* Mission Kanban / Timeline Area */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
               {/* Left: Primary Execution Stream (Kanban) */}
               <div className="lg:col-span-8 flex flex-col min-h-0 space-y-4">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-molten animate-pulse shadow-alloy-molten-glow" />
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">LIVE_EXECUTION_STREAM</h3>
                    </div>
                  </div>
                  
                  <div className="flex-1 min-h-0 bg-black/20 border border-white/5 rounded-2xl p-6 overflow-hidden relative overflow-y-auto custom-scrollbar">
                     <TerminalTimeline />
                  </div>
               </div>

               {/* Right: Telemetry & Gear State */}
               <div className="lg:col-span-4 flex flex-col gap-6 min-h-0">
                  <div className="flex-shrink-0">
                    <PhaseStatusCard session={autonomySession} />
                  </div>
                  <div className="flex-shrink-0">
                    <GearStatusCard session={autonomySession} />
                  </div>
                  <div className="flex-1 bg-black/40 border border-white/5 rounded-2xl p-6 overflow-hidden flex flex-col">
                    <div className="flex items-center gap-2 mb-6">
                      <Activity size={14} className="text-[var(--color-alloy-accent)]" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/60">Decision_Matrix</h3>
                    </div>
                    <div className="flex-1 min-h-0">
                      <DecisionMatrix sessionId={sessionIdStr} />
                    </div>
                  </div>
               </div>
            </div>

            {/* Bottom Global Controls */}
            {isRunning && (
              <div className="flex justify-center -mt-2 pb-2">
                <button 
                  onClick={handleStop}
                  className="group flex items-center gap-3 rounded-full border border-red-500/20 bg-red-500/10 px-8 py-3 text-[10px] font-bold tracking-widest text-red-500 transition-all hover:bg-red-500/20 hover:scale-[1.02] active:scale-95 shadow-lg"
                >
                  <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                  ABORT_SESSION (ESC)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, pulse = false }: { label: string, value: string, icon: React.ReactNode, pulse?: boolean }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/5 bg-black/40 p-4 transition-all hover:bg-white/[0.02]">
      <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/20 mb-1">{label}</span>
        <div className="flex items-center gap-2">
          {pulse && <div className="h-1 w-1 rounded-full bg-[var(--color-alloy-accent)] animate-pulse shadow-alloy-glow" />}
          <span className="text-sm font-bold tracking-widest text-white font-mono">{value}</span>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 h-[1px] w-0 bg-gradient-to-r from-transparent via-[var(--color-alloy-accent)]/30 to-transparent group-hover:w-full transition-all duration-700" />
    </div>
  );
}
