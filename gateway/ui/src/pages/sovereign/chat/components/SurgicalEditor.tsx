import { useState } from 'react';
import { Check, X, Code2, AlertTriangle, ChevronRight } from 'lucide-react';
import { useAlloyStore } from '../../../../store/alloyStore';

export function SurgicalEditor() {
  const { pendingInterventions, approveIntervention, rejectIntervention } = useAlloyStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");

  if (pendingInterventions.length === 0) return null;

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
    <div className="fixed inset-x-0 bottom-0 z-50 p-6 pointer-events-none">
      <div className="mx-auto max-w-4xl w-full pointer-events-auto">
        <div className="overflow-hidden rounded-2xl border border-[var(--color-alloy-accent)]/30 bg-[var(--color-alloy-surface)]/95 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-md">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-alloy-border)] px-4 py-3 bg-[var(--color-alloy-accent)]/5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-alloy-accent)]/20 text-[var(--color-alloy-accent)]">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Sovereign Oversight: Action Required</h3>
                <p className="text-[11px] text-[var(--color-alloy-text-sec)]">
                  Policy-driven pause for {current.toolName} {current.filePath ? `on ${current.filePath}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
               <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                 Confidence: {(current.confidence * 100).toFixed(0)}%
               </span>
            </div>
          </div>

          {/* Reason Section */}
          <div className="px-4 py-2 border-b border-[var(--color-alloy-border)] bg-black/20">
             <p className="text-xs text-yellow-200/80 italic">
               "{current.reason || "Manual review required by policy."}"
             </p>
          </div>

          {/* Diff / Editor Area */}
          <div className="max-h-[400px] overflow-y-auto bg-[#0a0a0a] p-4 font-mono text-xs">
            {current.toolName === 'write_to_file' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[var(--color-alloy-text-sec)] mb-2">
                  <Code2 size={14} />
                  <span>Proposed Content</span>
                  {editingId !== current.id && (
                    <button 
                      onClick={handleStartEdit}
                      className="ml-auto rounded border border-white/10 px-2 py-1 hover:bg-white/5 transition-colors"
                    >
                      Edit Symmetrically
                    </button>
                  )}
                </div>
                
                {editingId === current.id ? (
                  <textarea
                    value={editBuffer}
                    onChange={(e) => setEditBuffer(e.target.value)}
                    className="w-full h-64 bg-black/40 border border-[var(--color-alloy-accent)]/30 p-3 text-white rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--color-alloy-accent)]/50"
                  />
                ) : (
                  <pre className="p-3 text-green-400/90 whitespace-pre-wrap rounded-md bg-green-500/5 border border-green-500/10">
                    {current.proposedContent}
                  </pre>
                )}
              </div>
            ) : current.toolName === 'run_command' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[var(--color-alloy-text-sec)]">
                  <ChevronRight size={14} />
                  <span>Proposed Command</span>
                </div>
                <div className="rounded-md bg-blue-500/5 border border-blue-500/10 p-3 text-blue-300">
                  <code>{current.command}</code>
                </div>
              </div>
            ) : (
              <div className="text-[var(--color-alloy-text-sec)] italic">
                Generic tool intervention for {current.toolName}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-[var(--color-alloy-border)] px-4 py-3 bg-[var(--color-alloy-bg)]">
            <button
              onClick={() => void rejectIntervention(current.id)}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X size={14} />
              Reject & Stop
            </button>
            <button
              onClick={handleApprove}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-alloy-accent)] px-6 py-2 text-xs font-bold text-black hover:bg-[var(--color-alloy-accent)]/90 transition-all shadow-[0_0_20px_rgba(var(--color-alloy-accent-rgb),0.3)]"
            >
              <Check size={14} />
              {editingId === current.id ? "Apply Edit & Execute" : "Approve & Execute"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
