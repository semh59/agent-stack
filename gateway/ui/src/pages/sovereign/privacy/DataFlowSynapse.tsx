import React, { useMemo } from 'react';
import { Shield, ArrowRight, Database, Lock } from 'lucide-react';

interface TransitEvent {
  id: string;
  from: string;
  to: string;
  size: number;
  type: 'SAFE' | 'REDACTED' | 'BLOCKED';
  timestamp: string;
}

/**
 * DataFlowSynapse: The Glass Wall HUD.
 * Visualizes real-time token movement and privacy enforcement across the swarm.
 */
const DataFlowSynapse: React.FC = () => {
  // Mocking real-time events for the visualization
  const events: TransitEvent[] = useMemo(() => [
    { id: '1', from: 'CoderAgent', to: 'Anthropic API', size: 1450, type: 'SAFE', timestamp: '14:40:02' },
    { id: '2', from: 'SharedMemory', to: 'Telemetry Hub', size: 256, type: 'SAFE', timestamp: '14:40:05' },
    { id: '3', from: 'RetinaAgent', to: 'External Site', size: 512, type: 'REDACTED', timestamp: '14:40:10' },
    { id: '4', from: 'MaliciousTool', to: 'Unknown IP', size: 1024, type: 'BLOCKED', timestamp: '14:40:15' }
  ], []);

  return (
    <div className="p-6 bg-[#0a0a0c] text-white rounded-xl border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Shield className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">The Glass Wall</h2>
            <p className="text-xs text-white/40 uppercase tracking-widest">Sovereign Data-Flow Synapse</p>
          </div>
        </div>
        <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs font-medium text-green-400 uppercase">Sanctuary Active</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {events.map((event) => (
          <div 
            key={event.id}
            className={`flex items-center justify-between p-4 rounded-lg border transition-all duration-300 ${
              event.type === 'BLOCKED' ? 'bg-red-500/5 border-red-500/20' : 
              event.type === 'REDACTED' ? 'bg-orange-500/5 border-orange-500/20' : 
              'bg-white/[0.02] border-white/5 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <Database className="w-4 h-4 text-white/40" />
                <span className="text-[10px] text-white/60 font-mono italic">{event.from}</span>
              </div>
              
              <div className="flex flex-col items-center gap-1">
                <div className={`h-[1px] w-12 ${
                  event.type === 'BLOCKED' ? 'bg-red-500' : 'bg-blue-500/40'
                } relative`}>
                  <ArrowRight className={`w-3 h-3 absolute -right-1 -top-[6px] ${
                    event.type === 'BLOCKED' ? 'text-red-500' : 'text-blue-400'
                  }`} />
                </div>
              </div>

              <div className="flex flex-col items-center gap-1">
                <Lock className="w-4 h-4 text-white/40" />
                <span className="text-[10px] text-white/60 font-mono italic">{event.to}</span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-xs font-mono text-white/80">{event.size} tokens</div>
                <div className="text-[10px] text-white/40">{event.timestamp}</div>
              </div>

              <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter ${
                event.type === 'BLOCKED' ? 'bg-red-500/20 text-red-500' : 
                event.type === 'REDACTED' ? 'bg-orange-500/20 text-orange-400' : 
                'bg-blue-500/20 text-blue-400'
              }`}>
                {event.type}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6 border-t border-white/5 grid grid-cols-3 gap-4">
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
          <div className="text-[10px] text-white/40 uppercase font-bold mb-1">Maliyet Verimliliği</div>
          <div className="text-lg font-bold text-blue-400">92% <span className="text-xs font-normal text-white/60">Optimizer</span></div>
        </div>
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
          <div className="text-[10px] text-white/40 uppercase font-bold mb-1">Gizlilik Skoru</div>
          <div className="text-lg font-bold text-green-400">PURE <span className="text-xs font-normal text-white/60">ZKP</span></div>
        </div>
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
          <div className="text-[10px] text-white/40 uppercase font-bold mb-1">Anomali Filtresi</div>
          <div className="text-lg font-bold text-purple-400">AKTİF <span className="text-xs font-normal text-white/60">Bayes</span></div>
        </div>
      </div>
    </div>
  );
};

export default DataFlowSynapse;
