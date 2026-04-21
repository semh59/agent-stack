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
                  idx === autonomyTimeline.length - 1 ? "bg-white/5 border-l-2 border-[var(--color-alloy-accent)]" : "hover:bg-white/[0.02]"
                )}
              >
                <span className="text-[10px] text-gray-700 shrink-0 select-none">
                  [{new Date(item.timestamp).toLocaleTimeString([], { hour12: false })}]
                </span>
                <div className="shrink-0 mt-0.5">
                  {item.type === 'tool' ? <Terminal size={12} className="text-blue-500/60" /> :
                   item.type === 'success' ? <CheckCircle2 size={12} className="text-[var(--color-alloy-success)]/60" /> :
                   item.type === 'error' ? <AlertCircle size={12} className="text-[var(--color-alloy-error)]/60" /> :
                   <Zap size={12} className="text-[var(--color-alloy-accent)]/80" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    "text-[12px] break-words",
                    item.type === 'error' ? "text-red-400" : 
                    item.type === 'success' ? "text-[var(--color-alloy-success)]" :
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
            <span className="text-[10px] text-[var(--color-alloy-accent)] animate-pulse shrink-0">$</span>
            <div className="flex items-center gap-2">
               <span className="text-[12px] text-gray-500 italic">Analyzing...</span>
               <div className="flex gap-1">
                  <div className="w-1 h-1 bg-[var(--color-alloy-accent)] rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1 h-1 bg-[var(--color-alloy-accent)] rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1 h-1 bg-[var(--color-alloy-accent)] rounded-full animate-bounce" />
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
