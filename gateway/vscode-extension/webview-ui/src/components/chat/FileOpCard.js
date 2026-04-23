import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy FileOpCard — Human-in-the-Loop file operation approval card
   ═══════════════════════════════════════════════════════════════════ */
import { useState } from "react";
import { FileEdit, FilePlus, Terminal, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Badge } from "@/components/shared";
export function FileOpCard({ approval, onApprove, onReject }) {
    const [expanded, setExpanded] = useState(true);
    const [reason, setReason] = useState("");
    const opIcon = {
        read: _jsx(FileEdit, { className: "w-3.5 h-3.5" }),
        write: _jsx(FilePlus, { className: "w-3.5 h-3.5" }),
        execute: _jsx(Terminal, { className: "w-3.5 h-3.5" }),
    };
    const opVariant = {
        read: "info",
        write: "warning",
        execute: "accent",
    };
    return (_jsxs("div", { className: cn("rounded-xl border overflow-hidden animate-slide-up", "bg-[var(--alloy-bg-secondary)] border-[var(--alloy-border-default)]", "shadow-[var(--alloy-shadow-sm)]"), children: [_jsxs("div", { className: "flex items-center gap-2 px-3 py-2 bg-[var(--alloy-bg-tertiary)] border-b border-[var(--alloy-border-subtle)]", children: [_jsx("div", { className: "text-[var(--alloy-warning)]", children: opIcon[approval.operation] }), _jsx("span", { className: "text-xs font-medium text-[var(--alloy-text-primary)]", children: approval.tool }), _jsx(Badge, { variant: opVariant[approval.operation], size: "xs", children: approval.operation }), _jsx("span", { className: "text-[11px] font-mono text-[var(--alloy-text-secondary)] truncate flex-1", children: approval.target }), _jsx("button", { onClick: () => setExpanded(!expanded), className: "p-0.5 text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)]", children: expanded ? _jsx(ChevronUp, { className: "w-3 h-3" }) : _jsx(ChevronDown, { className: "w-3 h-3" }) })] }), expanded && (_jsxs(_Fragment, { children: [(approval.diff || approval.content) && (_jsx("div", { className: "border-b border-[var(--alloy-border-subtle)]", children: _jsx("div", { className: "max-h-40 overflow-auto", children: approval.diff ? (_jsx(DiffView, { diff: approval.diff })) : approval.content ? (_jsx("pre", { className: "p-3 text-[11px] font-mono text-[var(--alloy-text-primary)] whitespace-pre-wrap", children: approval.content })) : null }) })), !approval.autoApproved && (_jsxs("div", { className: "flex items-center gap-2 px-3 py-2", children: [_jsx("input", { type: "text", value: reason, onChange: (e) => setReason(e.target.value), placeholder: "Rejection reason (optional)...", className: "flex-1 px-2 py-1 text-xs bg-[var(--alloy-bg-primary)] border border-[var(--alloy-border-default)] rounded-md text-[var(--alloy-text-primary)] placeholder:text-[var(--alloy-text-muted)] outline-none focus:border-[var(--alloy-accent)]" }), _jsx(Button, { variant: "danger", size: "xs", icon: _jsx(X, { className: "w-3 h-3" }), onClick: () => onReject(approval.approvalId, reason || undefined), children: "Reject" }), _jsx(Button, { variant: "primary", size: "xs", icon: _jsx(Check, { className: "w-3 h-3" }), onClick: () => onApprove(approval.approvalId), children: "Approve" })] }))] }))] }));
}
/* ── Diff View ────────────────────────────────────────────────────── */
function DiffView({ diff }) {
    const lines = diff.split("\n");
    return (_jsx("div", { className: "font-mono text-[11px]", children: lines.map((line, i) => (_jsx("div", { className: cn("px-3 py-0.5", line.startsWith("+") && "bg-[rgba(16,185,129,0.1)] text-[var(--alloy-success-light)]", line.startsWith("-") && "bg-[rgba(239,68,68,0.1)] text-[var(--alloy-error-light)]", line.startsWith("@@") && "bg-[rgba(59,130,246,0.08)] text-[var(--alloy-info-light)]", !line.startsWith("+") && !line.startsWith("-") && !line.startsWith("@") && "text-[var(--alloy-text-secondary)]"), children: line }, i))) }));
}
