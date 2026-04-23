import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Terminal, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';

export function TerminalTimeline() {
  const { autonomyTimeline, pipelineStatus, autonomySession } = useAppStore(
    useShallow((state) => ({
      autonomyTimeline: state.autonomyTimeline,
      pipelineStatus: state.pipelineStatus,
      autonomySession: state.autonomySession,
    }))
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: autonomyTimeline.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 5,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autonomyTimeline, pipelineStatus]);

  const isRunning = autonomySession
    ? !['done', 'failed', 'stopped'].includes(autonomySession.state)
    : pipelineStatus?.state?.pipelineStatus === 'running';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-black/40 border border-white/5 rounded-2xl shadow-alloy-elevated">
      {/* Chrome Style Bar */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-white/[0.03] border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5 opacity-40">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            <div className="w-2 h-2 rounded-full bg-green-500" />
          </div>
          <span className="text-[10px] text-white/20 font-bold tracking-[0.2em] uppercase ml-2">Internal Logs // Output</span>
        </div>
        <div className="flex items-center gap-4 text-[9px] font-mono text-white/10 uppercase tracking-widest">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-[var(--color-alloy-accent)] animate-pulse" />
            Live_Sync
          </span>
          <span>v4.0</span>
        </div>
      </div>

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-5 custom-scrollbar font-mono leading-relaxed relative"
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
                  "flex gap-4 group px-3 py-1.5 rounded transition-all duration-300",
                  idx === autonomyTimeline.length - 1 
                    ? "bg-[var(--color-alloy-accent)]/5 border-l-2 border-[var(--color-alloy-accent)] shadow-[inset_10px_0_20px_-10px_rgba(0,240,255,0.1)]" 
                    : "hover:bg-white/[0.02] border-l-2 border-transparent"
                )}
              >
                <div className="flex flex-col items-center shrink-0 w-12 pt-1 opacity-20 group-hover:opacity-60 transition-opacity">
                   <span className="text-[9px] font-bold text-white tracking-widest leading-none">
                     {new Date(item.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
                   </span>
                </div>
                
                <div className="shrink-0 mt-1">
                  {item.type === 'tool' ? <Terminal size={12} className="text-[var(--color-alloy-accent)] opacity-60" /> :
                   item.type === 'success' ? <CheckCircle2 size={12} className="text-emerald-400 opacity-80" /> :
                   item.type === 'error' ? <AlertCircle size={12} className="text-red-400" /> :
                   <Zap size={12} className="text-[var(--color-alloy-accent)] shadow-alloy-glow" />}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    "text-[11px] break-words tracking-tight leading-[1.4]",
                    item.type === 'error' ? "text-red-400/90" : 
                    item.type === 'success' ? "text-emerald-400/80 font-medium" :
                    "text-white/60"
                  )}>
                    {item.message}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        
        {isRunning && (
          <div className="flex gap-4 px-3 py-4 mt-2 border-t border-white/5 bg-gradient-to-b from-transparent to-[var(--color-alloy-accent)]/[0.02]">
            <span className="text-[10px] text-[var(--color-alloy-accent)] animate-pulse shrink-0 font-bold">$</span>
            <div className="flex items-center gap-3">
               <span className="text-[11px] text-[var(--color-alloy-accent)] opacity-40 font-bold uppercase tracking-widest animate-pulse">Analyzing...</span>
               <div className="flex gap-1.5 pt-0.5">
                  <div className="w-1 h-1 bg-[var(--color-alloy-accent)] rounded-full animate-bounce shadow-alloy-glow [animation-delay:-0.3s]" />
                  <div className="w-1 h-1 bg-[var(--color-alloy-accent)] rounded-full animate-bounce shadow-alloy-glow [animation-delay:-0.15s]" />
                  <div className="w-1 h-1 bg-[var(--color-alloy-accent)] rounded-full animate-bounce shadow-alloy-glow" />
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
