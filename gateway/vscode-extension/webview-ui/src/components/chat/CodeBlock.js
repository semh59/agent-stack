import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy CodeBlock — Syntax-highlighted code with copy & language badge
   ═══════════════════════════════════════════════════════════════════ */
import { useState, useCallback } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
export function CodeBlock({ code, language, className }) {
    const [copied, setCopied] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const lineCount = code.split("\n").length;
    const isLong = lineCount > 15;
    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
        catch {
            // Fallback for webview context
            const textarea = document.createElement("textarea");
            textarea.value = code;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [code]);
    const displayCode = collapsed && isLong
        ? code.split("\n").slice(0, 10).join("\n") + "\n..."
        : code;
    return (_jsxs("div", { className: cn("group rounded-lg overflow-hidden border", "bg-[var(--alloy-code-bg)] border-[var(--alloy-code-border)]", "my-2", className), children: [_jsxs("div", { className: "flex items-center justify-between px-3 py-1.5 bg-[var(--alloy-code-header-bg)] border-b border-[var(--alloy-code-border)]", children: [_jsx("span", { className: "text-[10px] font-mono text-[var(--alloy-text-muted)] uppercase tracking-wider", children: language || "code" }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsxs("span", { className: "text-[10px] text-[var(--alloy-text-muted)] mr-2", children: [lineCount, " lines"] }), isLong && (_jsx("button", { onClick: () => setCollapsed(!collapsed), className: "p-0.5 rounded text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)] hover:bg-[var(--alloy-bg-hover)] transition-colors", children: collapsed ? (_jsx(ChevronDown, { className: "w-3 h-3" })) : (_jsx(ChevronUp, { className: "w-3 h-3" })) })), _jsx("button", { onClick: handleCopy, className: cn("p-0.5 rounded transition-colors", copied
                                    ? "text-[var(--alloy-success)]"
                                    : "text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)] hover:bg-[var(--alloy-bg-hover)]"), children: copied ? _jsx(Check, { className: "w-3 h-3" }) : _jsx(Copy, { className: "w-3 h-3" }) })] })] }), _jsx("div", { className: "overflow-x-auto", children: _jsx("pre", { className: "p-3 text-[12px] leading-[1.6] font-mono", children: _jsx("code", { className: "text-[var(--alloy-text-primary)]", children: displayCode }) }) })] }));
}
