import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAppStore } from '../../store/appStore';
import type { AppState } from '../../store/types';
import { Activity } from 'lucide-react';

interface TokenUsageChartProps {
  sessionId: string;
}

export const TokenUsageChart: React.FC<TokenUsageChartProps> = ({ sessionId }) => {
  const analytics = useAppStore((state: AppState) => state.analyticsBySession[sessionId]);
  const budget = useAppStore((state: AppState) => state.budgetBySession[sessionId]);

  // Transform history for Recharts if available, otherwise show current usage
  const data = useMemo(() => {
    if (!budget) return [];
    
    // In a real scenario, we'd have a history array. 
    // For now, let's show a static-ish view from current usage metrics
    return [
      { name: 'Input', value: budget.usage.inputTokensUsed },
      { name: 'Output', value: budget.usage.outputTokensUsed },
    ];
  }, [budget]);

  if (!budget) return null;

  return (
    <div className="glass-panel-elite rounded-2xl p-6 space-y-4 animate-float">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] flex items-center gap-2">
          <Activity size={14} className="text-[var(--color-alloy-accent)]" /> TOKEN VELOCITY
        </h3>
        <div className="text-[10px] text-white/60 font-mono">
          <span className="text-[var(--color-alloy-accent)] font-black text-xs">{(analytics?.tokenVelocity || 0).toLocaleString()}</span> T/SEC
        </div>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#00f0ff" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis 
              dataKey="name" 
              stroke="#ffffff40" 
              fontSize={10} 
              tickLine={false} 
              axisLine={false} 
            />
            <YAxis 
              stroke="#ffffff40" 
              fontSize={10} 
              tickLine={false} 
              axisLine={false} 
              tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#050505', border: '1px solid #ffffff20', borderRadius: '8px', fontSize: '12px' }}
              itemStyle={{ color: '#00f0ff' }}
            />
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke="#00f0ff" 
              fillOpacity={1} 
              fill="url(#colorTokens)" 
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/[0.08] transition-all group">
          <div className="text-[8px] text-white/30 font-black uppercase tracking-widest mb-1 group-hover:text-[var(--color-alloy-accent)] transition-colors">Current TPM</div>
          <div className="text-sm font-black font-mono text-white">
            {budget.usage.currentTPM.toLocaleString()} / {budget.limits.maxTPM.toLocaleString()}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/[0.08] transition-all group">
          <div className="text-[8px] text-white/30 font-black uppercase tracking-widest mb-1 group-hover:text-amber-300 transition-colors">RPD Window</div>
          <div className="text-sm font-black font-mono text-white">
            {budget.usage.requestsUsed.toLocaleString()} / {budget.limits.maxRPD.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
};
