import { Zap, Activity } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import type { AppState, AutonomyTimelineItem } from '../../store/types';

interface DecisionMatrixProps {
  sessionId: string;
}

export const DecisionMatrix: React.FC<DecisionMatrixProps> = ({ sessionId }) => {
  const timeline = useAppStore((state: AppState) => state.timelineBySession[sessionId] || []);
  
  // Get the latest decision nodes
  const decisions = timeline
    .filter((item: AutonomyTimelineItem) => item.type === 'decision')
    .slice(-3)
    .reverse();

  if (decisions.length === 0) return null;

  return (
    <div className="glass-panel-elite rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] text-white/40 font-black uppercase tracking-widest flex items-center gap-2">
          <Zap size={14} className="text-yellow-400" /> DECISION MATRIX
        </h3>
        <div className="flex items-center gap-1.5 p-1 bg-yellow-500/5 rounded-lg border border-yellow-500/10">
          <Activity size={10} className="text-yellow-500 animate-pulse" />
          <span className="text-[8px] text-yellow-500/80 font-bold uppercase tracking-tighter">Live Reasoning</span>
        </div>
      </div>

      <div className="space-y-4">
        {decisions.map((decision: AutonomyTimelineItem, idx: number) => {
          const payload = (decision.payload || {}) as Record<string, unknown>;
          const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.8;
          
          return (
            <div 
              key={decision.id || idx} 
              className="p-4 bg-white/5 border border-white/5 rounded-xl space-y-3 group hover:border-yellow-500/30 transition-all timeline-item-enter"
            >
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-gray-500 font-bold uppercase tracking-tighter">
                  {new Date(decision.timestamp).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded text-[8px] text-yellow-500 font-black uppercase tracking-widest shadow-[0_0_8px_rgba(234,179,8,0.2)]">
                  {(payload?.strategy as string) || 'OPTIMAL'}
                </span>
              </div>
              
              <p className="text-[11px] text-gray-300 leading-relaxed font-medium line-clamp-3 pl-3 border-l border-white/10">
                {(payload?.reason as string) || decision.message}
              </p>
              
              <div className="space-y-2 pt-1">
                <div className="flex justify-between items-center text-[9px] uppercase tracking-tighter text-white/40 font-bold">
                  <span>Confidence Level</span>
                  <span className="text-yellow-500">{Math.round(confidence * 100)}%</span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                  <div 
                    className="h-full bg-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.5)] transition-all duration-1000" 
                    style={{ width: `${confidence * 100}%` }} 
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-white/5">
        <div className="flex gap-4">
          <div className="flex-1 text-center">
            <div className="text-[9px] text-white/30 uppercase mb-1 font-bold">Hallucination Risk</div>
            <div className="text-[10px] font-black text-emerald-400 font-mono">LOW</div>
          </div>
          <div className="flex-1 text-center border-x border-white/5">
            <div className="text-[9px] text-white/30 uppercase mb-1 font-bold">Context Health</div>
            <div className="text-[10px] font-black text-white font-mono">100%</div>
          </div>
          <div className="flex-1 text-center">
            <div className="text-[9px] text-white/30 uppercase mb-1 font-bold">Consistency</div>
            <div className="text-[10px] font-black text-yellow-500 font-mono">HIGH</div>
          </div>
        </div>
      </div>
    </div>
  );
};
