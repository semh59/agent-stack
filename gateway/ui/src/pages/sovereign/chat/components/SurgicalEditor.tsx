/**
 * SurgicalEditor — inline code diff viewer for AI-suggested edits.
 * Shows before/after with a simple accept/reject flow.
 */

import { useState } from "react";
import { Check, X, ChevronDown, ChevronUp, Code2 } from "lucide-react";

interface Edit {
  id: string;
  file: string;
  before: string;
  after: string;
  description?: string;
}

interface SurgicalEditorProps {
  edits: Edit[];
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
}

function DiffLine({ line, type }: { line: string; type: "added" | "removed" | "context" }) {
  const colors = {
    added:   "bg-green-50 text-green-800 border-l-2 border-green-400",
    removed: "bg-red-50 text-red-800 border-l-2 border-red-400",
    context: "text-[var(--color-alloy-text-sec)]",
  };
  const prefix = { added: "+ ", removed: "- ", context: "  " };

  return (
    <div className={`flex px-3 py-0.5 font-mono text-[11px] leading-5 ${colors[type]}`}>
      <span className="w-4 shrink-0 text-[var(--color-alloy-text-dim)] select-none">{prefix[type]}</span>
      <span className="whitespace-pre-wrap break-all">{line}</span>
    </div>
  );
}

function EditCard({ edit, onAccept, onReject }: {
  edit: Edit;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");

  function handleAccept() {
    setStatus("accepted");
    onAccept?.(edit.id);
  }

  function handleReject() {
    setStatus("rejected");
    onReject?.(edit.id);
  }

  const beforeLines = edit.before.split("\n");
  const afterLines = edit.after.split("\n");

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${
      status === "accepted" ? "border-green-200 opacity-60" :
      status === "rejected" ? "border-red-200 opacity-60" :
      "border-[var(--color-alloy-border)]"
    }`}>
      <div className="flex items-center gap-2 bg-[var(--color-alloy-surface-hover)] px-3 py-2">
        <Code2 size={13} className="shrink-0 text-[var(--color-alloy-accent)]" />
        <span className="flex-1 truncate font-mono text-[12px] text-[var(--color-alloy-text)]">{edit.file}</span>
        {edit.description && (
          <span className="text-[11px] text-[var(--color-alloy-text-sec)] truncate max-w-[200px]">{edit.description}</span>
        )}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="ml-1 rounded p-1 text-[var(--color-alloy-text-dim)] hover:bg-[var(--color-alloy-surface)] transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {expanded && (
        <div className="overflow-hidden">
          <div className="bg-[var(--color-alloy-bg)] py-1">
            {beforeLines.map((line, i) => (
              <DiffLine key={`b${i}`} line={line} type="removed" />
            ))}
            {afterLines.map((line, i) => (
              <DiffLine key={`a${i}`} line={line} type="added" />
            ))}
          </div>
        </div>
      )}

      {status === "pending" && (
        <div className="flex gap-2 border-t border-[var(--color-alloy-border)] p-2">
          <button
            type="button"
            onClick={handleReject}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-alloy-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
          >
            <X size={12} />
            Reddet
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-alloy-success)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Check size={12} />
            Uygula
          </button>
        </div>
      )}

      {status !== "pending" && (
        <div className={`border-t px-3 py-2 text-[11px] font-medium ${
          status === "accepted" ? "border-green-200 text-green-600" : "border-red-200 text-red-500"
        }`}>
          {status === "accepted" ? "Uygulandii" : "Reddedildi"}
        </div>
      )}
    </div>
  );
}

export function SurgicalEditor({ edits, onAccept, onReject, onAcceptAll, onRejectAll }: SurgicalEditorProps) {
  if (edits.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-alloy-border)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[var(--color-alloy-text)]">
          {edits.length} degisiklik onerildi
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRejectAll}
            className="rounded-lg border border-[var(--color-alloy-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface-hover)] transition-colors"
          >
            Hepsini reddet
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            className="rounded-lg bg-[var(--color-alloy-success)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 transition-opacity"
          >
            Hepsini uygula
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {edits.map((edit) => (
          <EditCard key={edit.id} edit={edit} onAccept={onAccept} onReject={onReject} />
        ))}
      </div>
    </div>
  );
}
