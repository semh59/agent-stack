import { useState } from 'react';
import { Check, X, Code2, AlertTriangle } from 'lucide-react';
import { useAlloyStore } from '../../../../store/alloyStore';

export function SurgicalEditor() {
  const { pendingInterventions, approveIntervention, rejectIntervention } = useAlloyStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");

  if (pendingInterventions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-12 text-center">
        <div className="relative mb-8">
           <Code2 size={48} className="text-white/5" />
           <div className="absolute top-0 right-0 h-2 w-2 rounded-full bg-white/10" />
        </div>
        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20">System Running Smoothly</h3>
        <p className="mt-4 text-[9px] text-white/10 leading-relaxed max-w-[240px] uppercase font-bold tracking-widest">
          The AI engine is working on your task. No approvals are required at this time.
        </p>
      </div>
    );
  }

  const current = pendingInterventions[0]!;

  const handleStartEdit = () => {
    setEditingId(current.id);
    setEditBuffer(current.proposedContent || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditBuffer("");
  };

  const handleApprove = () => {
    void approveIntervention(current.id, editingId === current.id ? editBuffer : undefined);
    handleCancelEdit();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-black/40">
      {/* Header */}
      <div className="flex flex-col border-b border-white/5 bg-red-500/5 px-8 py-8">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
            <AlertTriangle size={24} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black uppercase tracking-[0.2em] text-white">Approval Required</h3>
            <div className="flex items-center gap-2 text-[9px] font-black text-red-500/60 uppercase tracking-[0.1em]">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              The AI needs your review
            </div>
          </div>
        </div>
        
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-white/5 bg-black/40 p-4">
            <span className="block text-[8px] font-black uppercase tracking-[0.3em] text-white/20 mb-2 font-mono">Target File //</span>
            <span className="text-[11px] font-mono font-bold text-white/80 break-all">{current.filePath || current.toolName}</span>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-4">
            <span className="block text-[8px] font-black uppercase tracking-[0.3em] text-white/20 mb-2 font-mono">Reason //</span>
            <span className="text-[11px] font-medium text-red-400/80 leading-relaxed uppercase tracking-tight">
              {current.reason || "The AI is about to make a significant change and needs your confirmation."}
            </span>
          </div>
        </div>
      </div>

      {/* Control Surface */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-white/40 uppercase">
             <Code2 size={12} /> Trace // Proposal
          </div>
          {current.toolName === 'write_to_file' && editingId !== current.id && (
            <button 
              onClick={handleStartEdit}
              className="text-[9px] font-bold text-[var(--color-alloy-accent)] hover:underline"
            >
              Edit Proposal
            </button>
          )}
        </div>

        {current.toolName === 'write_to_file' ? (
          <div className="space-y-4">
            {editingId === current.id ? (
              <textarea
                value={editBuffer}
                onChange={(e) => setEditBuffer(e.target.value)}
                className="w-full h-96 bg-black/60 border border-[var(--color-alloy-accent)]/30 p-4 font-mono text-[11px] text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--color-alloy-accent)]/50"
              />
            ) : (
              <pre className="rounded-lg border border-white/5 bg-black/60 p-4 font-mono text-[11px] text-[var(--color-alloy-accent)]/80 overflow-x-auto">
                {current.proposedContent}
              </pre>
            )}
          </div>
        ) : current.toolName === 'run_command' ? (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 font-mono text-[11px] text-blue-300 break-all">
            <span className="text-white/20 select-none mr-2">$</span>
            {current.command}
          </div>
        ) : (
          <div className="text-[10px] text-white/40 italic">
            Generic tool intervention payload for {current.toolName}
          </div>
        )}
      </div>

      {/* Action Bay */}
      <div className="grid grid-cols-2 gap-3 border-t border-white/5 bg-black/40 p-6">
        <button
          onClick={() => void rejectIntervention(current.id)}
          className="flex items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 py-3 text-[10px] font-bold tracking-widest text-red-400 transition-all hover:bg-red-500/10 active:scale-95"
        >
          <X size={14} />
          Reject
        </button>
        <button
          onClick={handleApprove}
          className="flex items-center justify-center gap-2 rounded-lg bg-molten py-3 text-[10px] font-bold tracking-widest text-black transition-all hover:scale-[1.02] active:scale-95 shadow-alloy-molten-glow"
        >
          <Check size={14} />
          Approve
        </button>
      </div>
    </div>
  );
}
