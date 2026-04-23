import React from 'react';
import { Target, ShieldCheck, Gauge } from 'lucide-react';
import { useAlloyStore } from '../../../../store/alloyStore';
import clsx from 'clsx';

export function AutonomyConsole() {
  const { autonomyLevel, setAutonomyLevel, messages } = useAlloyStore();
  
  const lastModelMsg = [...messages].reverse().find(m => m.role === 'model');
  const reasoning = lastModelMsg?.content.includes('Thought:') 
    ? lastModelMsg.content.split('Thought:')[1]?.split('\n')[0] 
    : "Analyzing project structure and dependency graph...";

  return (
    <div className="flex h-[44px] items-center justify-between border-b border-[var(--color-alloy-border)] bg-black/40 px-6 backdrop-blur-xl z-20">
      <div className="flex items-center gap-4 overflow-hidden flex-1">
        <div className="flex items-center gap-2 px-2 py-0.5 rounded border border-[var(--color-alloy-accent)]/20 bg-[var(--color-alloy-accent)]/5">
          <div className="flex h-1.5 w-1.5 rounded-full bg-molten animate-pulse shadow-alloy-molten-glow" />
          <span className="text-[9px] font-black uppercase tracking-tighter text-[var(--color-alloy-accent)]">AI is coding</span>
        </div>
        <span className="truncate text-[10px] font-mono text-white/50 italic max-w-[600px] border-l border-white/10 pl-4">
          {reasoning}
        </span>
      </div>

      <div className="flex items-center gap-4 ml-6 shrink-0">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/60 p-1 shadow-inner">
          <LevelButton 
            active={autonomyLevel === 'manual'} 
            onClick={() => setAutonomyLevel('manual')}
            label="Manual"
            icon={<Target size={11} />}
          />
          <div className="h-4 w-[1px] bg-white/5 mx-0.5" />
          <LevelButton 
            active={autonomyLevel === 'balanced'} 
            onClick={() => setAutonomyLevel('balanced')}
            label="Supervised"
            icon={<ShieldCheck size={11} />}
          />
          <div className="h-4 w-[1px] bg-white/5 mx-0.5" />
          <LevelButton 
            active={autonomyLevel === 'autonomous'} 
            onClick={() => setAutonomyLevel('autonomous')}
            label="Autonomous"
            icon={<Gauge size={11} />}
          />
        </div>
      </div>
    </div>
  );
}

function LevelButton({ active, onClick, label, icon }: { active: boolean, onClick: () => void, label: string, icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-[9px] font-black tracking-[0.2em] transition-all",
        active 
          ? "bg-[var(--color-alloy-accent)] text-black shadow-alloy-molten-glow scale-[1.02] border border-white/20" 
          : "text-[var(--color-alloy-text-sec)] hover:bg-white/5 hover:text-white border border-transparent"
      )}
    >
      <span className={clsx("transition-opacity", active ? "opacity-100" : "opacity-40")}>{icon}</span>
      {label}
    </button>
  );
}
