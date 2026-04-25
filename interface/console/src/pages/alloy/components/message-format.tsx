/**
 * message-format.tsx — renders AI message content with basic markdown-lite support.
 * Handles code blocks, inline code, bold, and plain text.
 */

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-[var(--color-alloy-border)]">
      <div className="flex items-center justify-between bg-[var(--color-alloy-surface-hover)] px-3 py-1.5">
        <span className="text-[11px] font-mono text-[var(--color-alloy-text-dim)]">{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[var(--color-alloy-text-sec)] hover:bg-[var(--color-alloy-surface)] transition-colors"
        >
          {copied ? <Check size={11} className="text-[var(--color-alloy-success)]" /> : <Copy size={11} />}
          {copied ? "Kopyalandi" : "Kopyala"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-[var(--color-alloy-bg)] p-4 text-[12px] font-mono text-[var(--color-alloy-text)] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface Segment {
  type: "text" | "code" | "codeblock";
  content: string;
  lang?: string;
}

function parseContent(text: string): Segment[] {
  const segments: Segment[] = [];
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  const inlineCodeRe = /`([^`]+)`/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Replace code blocks first
  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "codeblock", content: match[2].trim(), lang: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  if (remaining) {
    // Handle inline code in remaining text
    let li = 0;
    while ((match = inlineCodeRe.exec(remaining)) !== null) {
      if (match.index > li) {
        segments.push({ type: "text", content: remaining.slice(li, match.index) });
      }
      segments.push({ type: "code", content: match[1] });
      li = match.index + match[0].length;
    }
    if (li < remaining.length) {
      segments.push({ type: "text", content: remaining.slice(li) });
    }
  }

  return segments.length > 0 ? segments : [{ type: "text", content: text }];
}

function renderText(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

interface FormattedMessageProps {
  content: string;
  className?: string;
}

export function FormattedMessage({ content, className = "" }: FormattedMessageProps) {
  const segments = parseContent(content);

  return (
    <div className={`text-[13px] leading-relaxed ${className}`}>
      {segments.map((seg, i) => {
        if (seg.type === "codeblock") {
          return <CodeBlock key={i} code={seg.content} lang={seg.lang} />;
        }
        if (seg.type === "code") {
          return (
            <code key={i} className="rounded bg-[var(--color-alloy-surface-hover)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-alloy-accent)]">
              {seg.content}
            </code>
          );
        }
        return (
          <span key={i}>
            {seg.content.split("\n").map((line, j, arr) => (
              <span key={j}>
                {renderText(line)}
                {j < arr.length - 1 && <br />}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}
