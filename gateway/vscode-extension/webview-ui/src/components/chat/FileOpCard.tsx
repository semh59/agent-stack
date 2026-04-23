/* ═══════════════════════════════════════════════════════════════════
   Alloy FileOpCard — Human-in-the-Loop file operation approval card
   ═══════════════════════════════════════════════════════════════════ */

import { useState } from "react";
import { FileEdit, FilePlus, Trash2, Terminal, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Badge } from "@/components/shared";
import type { ToolApprovalPayload } from "@/lib/vscode";

interface FileOpCardProps {
  approval: ToolApprovalPayload;
  onApprove: (approvalId: string, modified?: string) => void;
  onReject: (approvalId: string, reason?: string) => void;
}

export function FileOpCard({ approval, onApprove, onReject }: FileOpCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [reason, setReason] = useState("");

  const opIcon: Record<string, React.ReactNode> = {
    read: <FileEdit className="w-3.5 h-3.5" />,
    write: <FilePlus className="w-3.5 h-3.5" />,
    execute: <Terminal className="w-3.5 h-3.5" />,
  };

  const opVariant: Record<string, "info" | "warning" | "accent"> = {
    read: "info",
    write: "warning",
    execute: "accent",
  };

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden animate-slide-up",
        "bg-[var(--alloy-bg-secondary)] border-[var(--alloy-border-default)]",
        "shadow-[var(--alloy-shadow-sm)]"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--alloy-bg-tertiary)] border-b border-[var(--alloy-border-subtle)]">
        <div className="text-[var(--alloy-warning)]">
          {opIcon[approval.operation]}
        </div>
        <span className="text-xs font-medium text-[var(--alloy-text-primary)]">
          {approval.tool}
        </span>
        <Badge variant={opVariant[approval.operation]} size="xs">
          {approval.operation}
        </Badge>
        <span className="text-[11px] font-mono text-[var(--alloy-text-secondary)] truncate flex-1">
          {approval.target}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-0.5 text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)]"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Content */}
      {expanded && (
        <>
          {(approval.diff || (approval as { content?: string }).content) && (
            <div className="border-b border-[var(--alloy-border-subtle)]">
              <div className="max-h-40 overflow-auto">
                {approval.diff ? (
                  <DiffView diff={approval.diff} />
                ) : (approval as { content?: string }).content ? (
                  <pre className="p-3 text-[11px] font-mono text-[var(--alloy-text-primary)] whitespace-pre-wrap">
                    {(approval as { content?: string }).content}
                  </pre>
                ) : null}
              </div>
            </div>
          )}

          {/* Actions */}
          {!approval.autoApproved && (
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Rejection reason (optional)..."
                className="flex-1 px-2 py-1 text-xs bg-[var(--alloy-bg-primary)] border border-[var(--alloy-border-default)] rounded-md text-[var(--alloy-text-primary)] placeholder:text-[var(--alloy-text-muted)] outline-none focus:border-[var(--alloy-accent)]"
              />
              <Button
                variant="danger"
                size="xs"
                icon={<X className="w-3 h-3" />}
                onClick={() => onReject(approval.approvalId, reason || undefined)}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="xs"
                icon={<Check className="w-3 h-3" />}
                onClick={() => onApprove(approval.approvalId)}
              >
                Approve
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Diff View ────────────────────────────────────────────────────── */

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");

  return (
    <div className="font-mono text-[11px]">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "px-3 py-0.5",
            line.startsWith("+") && "bg-[rgba(16,185,129,0.1)] text-[var(--alloy-success-light)]",
            line.startsWith("-") && "bg-[rgba(239,68,68,0.1)] text-[var(--alloy-error-light)]",
            line.startsWith("@@") && "bg-[rgba(59,130,246,0.08)] text-[var(--alloy-info-light)]",
            !line.startsWith("+") && !line.startsWith("-") && !line.startsWith("@") && "text-[var(--alloy-text-secondary)]"
          )}
        >
          {line}
        </div>
      ))}
    </div>
  );
}