import React from 'react';
import { Target, Brain, ShieldCheck, Gauge } from 'lucide-react';
import { useAlloyStore } from '../../../../store/alloyStore';
import clsx from 'clsx';

export function AutonomyConsole() {
  const { autonomyLevel, setAutonomyLevel, messages } = useAlloyStore();
  
  // Extract reasoning from the last model message if available
  const lastModelMsg = [...messages].reverse().find(m => m.role === 'model');
  const reasoning = lastModelMsg?.content.includes('Thought:') 
    ? lastModelMsg.content.split('Thought:')[1]?.split('\n')[0] 
    : "Analyzing project structure and dependency graph...";

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)]/80 px-6 py-2 backdrop-blur-md">
      {/* Reasoning Trace */}
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-[var(--color-alloy-accent)]/10 text-[var(--color-alloy-accent)]">
          <Brain size={12} />
        </div>
        <div className="flex flex-col truncate">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-alloy-text-sec)]">Reasoning Trace</span>
          <span className="truncate text-[11px] text-white/90 italic">
            {reasoning}
          </span>
        </div>
      </div>

      {/* Autonomy Level Gear */}
      <div className="flex items-center gap-4 ml-4 shrink-0">
        <div className="flex items-center gap-1.5 rounded-full border border-white/5 bg-white/5 p-1 px-2">
          <LevelButton 
            active={autonomyLevel === 'manual'} 
            onClick={() => setAutonomyLevel('manual')}
            label="Manual"
            icon={<Target size={12} />}
          />
          <LevelButton 
            active={autonomyLevel === 'balanced'} 
            onClick={() => setAutonomyLevel('balanced')}
            label="Balanced"
            icon={<ShieldCheck size={12} />}
          />
          <LevelButton 
            active={autonomyLevel === 'autonomous'} 
            onClick={() => setAutonomyLevel('autonomous')}
            label="Full Auto"
            icon={<Gauge size={12} />}
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
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-medium transition-all",
        active 
          ? "bg-[var(--color-alloy-accent)] text-black shadow-[0_0_15px_rgba(var(--color-alloy-accent-rgb),0.2)]" 
          : "text-[var(--color-alloy-text-sec)] hover:bg-white/5 hover:text-white"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
