import { Activity, Globe } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';

export function DashboardHeader() {
  const { models } = useAppStore(
    useShallow((state) => ({
      models: state.models,
    }))
  );

  return (
    <div className="flex items-center justify-between px-6 h-12 border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/80 backdrop-blur-md z-20">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--color-alloy-accent)] shadow-[0_0_8px_var(--color-alloy-accent)]" />
          <span className="text-[11px] font-bold text-white uppercase tracking-[0.3em] glow-accent">SOVEREIGN ELITE</span>
        </div>
        <div className="h-4 w-[1px] bg-white/10" />
        <div className="flex items-center gap-3 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
          {models.length > 0 ? (
            <span className="flex items-center gap-1.5 opacity-80 cursor-help" title="Gateway Connected">
              <Globe size={12} className="text-blue-400" /> 
              GATEWAY ONLINE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 opacity-80 cursor-help" title="Gateway Disconnected">
              <Globe size={12} className="text-red-400" /> 
              OFFLINE
            </span>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 px-3 py-1 bg-[var(--color-alloy-accent)]/5 border border-[var(--color-alloy-accent)]/20 rounded-md">
          <Activity size={12} className="text-[var(--color-alloy-accent)] animate-pulse" />
          <span className="text-[9px] text-[var(--color-alloy-accent)] font-bold uppercase tracking-widest">Autonomous Core Active</span>
        </div>
        <div className="text-[10px] text-gray-600 font-mono tracking-tighter">
          PROJ: SOVEREIGN v1.9.4
        </div>
      </div>
    </div>
  );
}
