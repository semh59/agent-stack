import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy MessageBubble — Polished chat display
   • User    → right-aligned pill bubble
   • Assistant → left, no background, flowing markdown
   • System  → compact single-line inline notification
   • Error   → red inline bar
   ═══════════════════════════════════════════════════════════════════ */
import { useMemo } from "react";
import { Bot, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { Badge } from "@/components/shared";
export function MessageBubble({ message }) {
    const { role, content, isStreaming, timestamp } = message;
    const ext = message;
    const model = ext.model;
    const tokens = ext.tokens;
    const artifacts = ext.artifacts;
    const isError = message.isError;
    const time = new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
    /* ── System / Error: compact inline notification ──────────────── */
    if (role === "system") {
        return _jsx(SystemNotification, { content: content, isError: !!isError, time: time });
    }
    /* ── User message ─────────────────────────────────────────────── */
    if (role === "user") {
        return (_jsx("div", { className: "flex justify-end animate-fade-in px-1", children: _jsxs("div", { className: "max-w-[85%] flex flex-col items-end gap-1", children: [_jsx("div", { className: cn("px-3.5 py-2 rounded-2xl rounded-tr-sm", "bg-[var(--alloy-accent)] text-white", "text-[13px] leading-relaxed"), children: content }), _jsx("span", { className: "text-[10px] text-[var(--alloy-text-muted)] pr-1", children: time })] }) }));
    }
    /* ── Assistant message ────────────────────────────────────────── */
    const parsedContent = useMemo(() => parseMarkdown(content), [content]);
    return (_jsxs("div", { className: "flex items-start gap-2.5 animate-fade-in px-1 group", children: [_jsx("div", { className: cn("mt-0.5 w-6 h-6 rounded-lg shrink-0", "bg-gradient-to-br from-[var(--alloy-accent)] to-[rgba(232,149,26,0.55)]", "flex items-center justify-center shadow-sm"), children: _jsx(Bot, { className: "w-3.5 h-3.5 text-white" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1.5", children: [_jsx("span", { className: "text-[11px] font-semibold text-[var(--alloy-text-secondary)]", children: model ?? "Alloy" }), _jsx("span", { className: "text-[10px] text-[var(--alloy-text-muted)]", children: time }), tokens?.total !== undefined && (_jsxs(Badge, { variant: "accent", size: "xs", children: [tokens.total, " tok"] }))] }), _jsxs("div", { className: "text-[13px] leading-relaxed text-[var(--alloy-text-primary)] space-y-1", children: [parsedContent, isStreaming && (_jsxs("span", { className: "inline-flex gap-1 ml-1", children: [_jsx("span", { className: "alloy-typing-dot" }), _jsx("span", { className: "alloy-typing-dot" }), _jsx("span", { className: "alloy-typing-dot" })] }))] }), artifacts && artifacts.length > 0 && (_jsx("div", { className: "mt-2 flex flex-wrap gap-1", children: artifacts.map((artifact, i) => (_jsx(ArtifactChip, { artifact: artifact }, i))) }))] })] }));
}
/* ── System notification (compact inline bar) ─────────────────────── */
function SystemNotification({ content, isError, time, }) {
    const isSuccess = !isError &&
        (content.toLowerCase().includes("ready") ||
            content.toLowerCase().includes("connected") ||
            content.toLowerCase().includes("completed") ||
            content.startsWith("✓") ||
            content.startsWith("▶"));
    const isWarning = !isError &&
        (content.toLowerCase().includes("warning") ||
            content.toLowerCase().includes("missing") ||
            content.toLowerCase().includes("⚠") ||
            content.toLowerCase().includes("token missing"));
    const icon = isError ? (_jsx(AlertTriangle, { className: "w-3 h-3 shrink-0 text-[var(--alloy-error)]" })) : isSuccess ? (_jsx(CheckCircle2, { className: "w-3 h-3 shrink-0 text-[var(--alloy-success)]" })) : isWarning ? (_jsx(AlertTriangle, { className: "w-3 h-3 shrink-0 text-[var(--alloy-warning)]" })) : (_jsx(Info, { className: "w-3 h-3 shrink-0 text-[var(--alloy-info)]" }));
    const textColor = isError
        ? "text-[var(--alloy-error)]"
        : isSuccess
            ? "text-[var(--alloy-success)]"
            : isWarning
                ? "text-[var(--alloy-warning)]"
                : "text-[var(--alloy-text-muted)]";
    const borderColor = isError
        ? "border-[rgba(239,68,68,0.15)]"
        : isSuccess
            ? "border-[rgba(16,185,129,0.15)]"
            : isWarning
                ? "border-[rgba(245,158,11,0.15)]"
                : "border-transparent";
    // Strip icon prefixes — we render our own
    const displayContent = content
        .replace(/^⚠️?\s*/, "")
        .replace(/^✓\s*/, "")
        .replace(/^▶\s*/, "");
    return (_jsxs("div", { className: cn("flex items-center gap-2 mx-1 px-2.5 py-1 rounded-md border animate-fade-in", borderColor), children: [icon, _jsx("span", { className: cn("flex-1 text-[11px] leading-snug truncate", textColor), children: displayContent }), _jsx("span", { className: "text-[10px] text-[var(--alloy-text-muted)] shrink-0 opacity-50 ml-1", children: time })] }));
}
/* ── Markdown Parser ──────────────────────────────────────────────── */
function parseMarkdown(raw) {
    const blocks = [];
    const parts = raw.split(/(```[\s\S]*?```)/g);
    parts.forEach((part, idx) => {
        if (part.startsWith("```")) {
            const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
            if (match) {
                blocks.push(_jsx(CodeBlock, { code: match[2].trimEnd(), language: match[1] || undefined }, idx));
            }
        }
        else {
            const lines = part.split("\n");
            lines.forEach((line, lineIdx) => {
                if (!line.trim()) {
                    if (lineIdx > 0 && lineIdx < lines.length - 1) {
                        blocks.push(_jsx("div", { className: "h-1.5" }, `${idx}-${lineIdx}`));
                    }
                    return;
                }
                const h3 = line.match(/^### (.+)/);
                const h2 = line.match(/^## (.+)/);
                const h1 = line.match(/^# (.+)/);
                if (h1) {
                    blocks.push(_jsx("p", { className: "text-[14px] font-bold text-[var(--alloy-text-primary)] mb-1", children: formatInline(h1[1]) }, `${idx}-${lineIdx}`));
                }
                else if (h2) {
                    blocks.push(_jsx("p", { className: "text-[13px] font-semibold text-[var(--alloy-text-primary)] mb-1", children: formatInline(h2[1]) }, `${idx}-${lineIdx}`));
                }
                else if (h3) {
                    blocks.push(_jsx("p", { className: "text-[12px] font-semibold text-[var(--alloy-text-secondary)] mb-0.5", children: formatInline(h3[1]) }, `${idx}-${lineIdx}`));
                }
                else if (line.match(/^[-*•]\s+/)) {
                    blocks.push(_jsxs("div", { className: "flex items-start gap-1.5", children: [_jsx("span", { className: "mt-[6px] w-1.5 h-1.5 rounded-full bg-[var(--alloy-accent)] shrink-0" }), _jsx("span", { children: formatInline(line.replace(/^[-*•]\s+/, "")) })] }, `${idx}-${lineIdx}`));
                }
                else if (line.match(/^\d+\.\s+/)) {
                    const num = line.match(/^(\d+)\.\s+(.*)/);
                    if (num) {
                        blocks.push(_jsxs("div", { className: "flex items-start gap-1.5", children: [_jsxs("span", { className: "mt-0.5 min-w-[1.1rem] text-[11px] font-semibold text-[var(--alloy-accent)]", children: [num[1], "."] }), _jsx("span", { children: formatInline(num[2]) })] }, `${idx}-${lineIdx}`));
                    }
                }
                else {
                    blocks.push(_jsx("p", { className: "leading-relaxed", children: formatInline(line) }, `${idx}-${lineIdx}`));
                }
            });
        }
    });
    return blocks;
}
function formatInline(text) {
    const nodes = [];
    const regex = /(?:`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(text.slice(lastIndex, match.index));
        }
        if (match[1]) {
            nodes.push(_jsx("code", { className: "px-1 py-0.5 rounded bg-[var(--alloy-code-bg)] text-[11px] font-mono text-[var(--alloy-accent)]", children: match[1] }, key++));
        }
        else if (match[2]) {
            nodes.push(_jsx("strong", { className: "font-semibold text-[var(--alloy-text-primary)]", children: match[2] }, key++));
        }
        else if (match[3]) {
            nodes.push(_jsx("em", { className: "italic text-[var(--alloy-text-secondary)]", children: match[3] }, key++));
        }
        else if (match[4] && match[5]) {
            nodes.push(_jsx("span", { className: "text-[var(--alloy-accent)] underline cursor-pointer hover:text-[var(--alloy-accent-hover)] transition-colors", children: match[4] }, key++));
        }
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
    }
    return nodes;
}
/* ── Artifact chip ────────────────────────────────────────────────── */
function ArtifactChip({ artifact, }) {
    return (_jsxs("div", { className: "inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--alloy-bg-tertiary)] border border-[var(--alloy-border-subtle)] text-[11px]", children: [_jsx("span", { className: "text-[var(--alloy-text-muted)]", children: artifact.type }), artifact.path && (_jsx("span", { className: "font-mono text-[var(--alloy-text-secondary)] truncate max-w-[180px]", children: artifact.path })), artifact.language && _jsx(Badge, { variant: "default", size: "xs", children: artifact.language })] }));
}
