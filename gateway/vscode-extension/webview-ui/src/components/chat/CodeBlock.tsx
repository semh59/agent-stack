/* ═══════════════════════════════════════════════════════════════════
   Alloy CodeBlock — Syntax-highlighted code with copy & language badge
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useCallback } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const lineCount = code.split("\n").length;
  const isLong = lineCount > 15;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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

  return (
    <div
      className={cn(
        "group rounded-lg overflow-hidden border",
        "bg-[var(--alloy-code-bg)] border-[var(--alloy-code-border)]",
        "my-2",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--alloy-code-header-bg)] border-b border-[var(--alloy-code-border)]">
        <span className="text-[10px] font-mono text-[var(--alloy-text-muted)] uppercase tracking-wider">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--alloy-text-muted)] mr-2">
            {lineCount} lines
          </span>
          {isLong && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-0.5 rounded text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)] hover:bg-[var(--alloy-bg-hover)] transition-colors"
            >
              {collapsed ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronUp className="w-3 h-3" />
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className={cn(
              "p-0.5 rounded transition-colors",
              copied
                ? "text-[var(--alloy-success)]"
                : "text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-primary)] hover:bg-[var(--alloy-bg-hover)]"
            )}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Code Content */}
      <div className="overflow-x-auto">
        <pre className="p-3 text-[12px] leading-[1.6] font-mono">
          <code className="text-[var(--alloy-text-primary)]">{displayCode}</code>
        </pre>
      </div>
    </div>
  );
}