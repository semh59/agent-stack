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
import type { ChatMessage } from "@/store/chatStore";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content, isStreaming, timestamp } = message;
  const ext = message as unknown as {
    model?: string;
    tokens?: { total?: number };
    artifacts?: Array<{ type: string; path?: string; language?: string }>;
  };
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
    return <SystemNotification content={content} isError={!!isError} time={time} />;
  }

  /* ── User message ─────────────────────────────────────────────── */
  if (role === "user") {
    return (
      <div className="flex justify-end animate-fade-in px-1">
        <div className="max-w-[85%] flex flex-col items-end gap-1">
          <div
            className={cn(
              "px-3.5 py-2 rounded-2xl rounded-tr-sm",
              "bg-[var(--alloy-accent)] text-white",
              "text-[13px] leading-relaxed"
            )}
          >
            {content}
          </div>
          <span className="text-[10px] text-[var(--alloy-text-muted)] pr-1">{time}</span>
        </div>
      </div>
    );
  }

  /* ── Assistant message ────────────────────────────────────────── */
  const parsedContent = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="flex items-start gap-2.5 animate-fade-in px-1 group">
      {/* Avatar */}
      <div
        className={cn(
          "mt-0.5 w-6 h-6 rounded-lg shrink-0",
          "bg-gradient-to-br from-[var(--alloy-accent)] to-[rgba(232,149,26,0.55)]",
          "flex items-center justify-center shadow-sm"
        )}
      >
        <Bot className="w-3.5 h-3.5 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-semibold text-[var(--alloy-text-secondary)]">
            {model ?? "Alloy"}
          </span>
          <span className="text-[10px] text-[var(--alloy-text-muted)]">{time}</span>
          {tokens?.total !== undefined && (
            <Badge variant="accent" size="xs">{tokens.total} tok</Badge>
          )}
        </div>

        {/* Content */}
        <div className="text-[13px] leading-relaxed text-[var(--alloy-text-primary)] space-y-1">
          {parsedContent}
          {isStreaming && (
            <span className="inline-flex gap-1 ml-1">
              <span className="alloy-typing-dot" />
              <span className="alloy-typing-dot" />
              <span className="alloy-typing-dot" />
            </span>
          )}
        </div>

        {/* Artifacts */}
        {artifacts && artifacts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {artifacts.map((artifact, i) => (
              <ArtifactChip key={i} artifact={artifact} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── System notification (compact inline bar) ─────────────────────── */

function SystemNotification({
  content,
  isError,
  time,
}: {
  content: string;
  isError: boolean;
  time: string;
}) {
  const isSuccess =
    !isError &&
    (content.toLowerCase().includes("ready") ||
      content.toLowerCase().includes("connected") ||
      content.toLowerCase().includes("completed") ||
      content.startsWith("✓") ||
      content.startsWith("▶"));

  const isWarning =
    !isError &&
    (content.toLowerCase().includes("warning") ||
      content.toLowerCase().includes("missing") ||
      content.toLowerCase().includes("⚠") ||
      content.toLowerCase().includes("token missing"));

  const icon = isError ? (
    <AlertTriangle className="w-3 h-3 shrink-0 text-[var(--alloy-error)]" />
  ) : isSuccess ? (
    <CheckCircle2 className="w-3 h-3 shrink-0 text-[var(--alloy-success)]" />
  ) : isWarning ? (
    <AlertTriangle className="w-3 h-3 shrink-0 text-[var(--alloy-warning)]" />
  ) : (
    <Info className="w-3 h-3 shrink-0 text-[var(--alloy-info)]" />
  );

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

  return (
    <div
      className={cn(
        "flex items-center gap-2 mx-1 px-2.5 py-1 rounded-md border animate-fade-in",
        borderColor
      )}
    >
      {icon}
      <span className={cn("flex-1 text-[11px] leading-snug truncate", textColor)}>
        {displayContent}
      </span>
      <span className="text-[10px] text-[var(--alloy-text-muted)] shrink-0 opacity-50 ml-1">
        {time}
      </span>
    </div>
  );
}

/* ── Markdown Parser ──────────────────────────────────────────────── */

function parseMarkdown(raw: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const parts = raw.split(/(```[\s\S]*?```)/g);

  parts.forEach((part, idx) => {
    if (part.startsWith("```")) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (match) {
        blocks.push(
          <CodeBlock key={idx} code={match[2].trimEnd()} language={match[1] || undefined} />
        );
      }
    } else {
      const lines = part.split("\n");
      lines.forEach((line, lineIdx) => {
        if (!line.trim()) {
          if (lineIdx > 0 && lineIdx < lines.length - 1) {
            blocks.push(<div key={`${idx}-${lineIdx}`} className="h-1.5" />);
          }
          return;
        }

        const h3 = line.match(/^### (.+)/);
        const h2 = line.match(/^## (.+)/);
        const h1 = line.match(/^# (.+)/);

        if (h1) {
          blocks.push(
            <p key={`${idx}-${lineIdx}`} className="text-[14px] font-bold text-[var(--alloy-text-primary)] mb-1">
              {formatInline(h1[1])}
            </p>
          );
        } else if (h2) {
          blocks.push(
            <p key={`${idx}-${lineIdx}`} className="text-[13px] font-semibold text-[var(--alloy-text-primary)] mb-1">
              {formatInline(h2[1])}
            </p>
          );
        } else if (h3) {
          blocks.push(
            <p key={`${idx}-${lineIdx}`} className="text-[12px] font-semibold text-[var(--alloy-text-secondary)] mb-0.5">
              {formatInline(h3[1])}
            </p>
          );
        } else if (line.match(/^[-*•]\s+/)) {
          blocks.push(
            <div key={`${idx}-${lineIdx}`} className="flex items-start gap-1.5">
              <span className="mt-[6px] w-1.5 h-1.5 rounded-full bg-[var(--alloy-accent)] shrink-0" />
              <span>{formatInline(line.replace(/^[-*•]\s+/, ""))}</span>
            </div>
          );
        } else if (line.match(/^\d+\.\s+/)) {
          const num = line.match(/^(\d+)\.\s+(.*)/);
          if (num) {
            blocks.push(
              <div key={`${idx}-${lineIdx}`} className="flex items-start gap-1.5">
                <span className="mt-0.5 min-w-[1.1rem] text-[11px] font-semibold text-[var(--alloy-accent)]">
                  {num[1]}.
                </span>
                <span>{formatInline(num[2])}</span>
              </div>
            );
          }
        } else {
          blocks.push(
            <p key={`${idx}-${lineIdx}`} className="leading-relaxed">
              {formatInline(line)}
            </p>
          );
        }
      });
    }
  });

  return blocks;
}

function formatInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(?:`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      nodes.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-[var(--alloy-code-bg)] text-[11px] font-mono text-[var(--alloy-accent)]"
        >
          {match[1]}
        </code>
      );
    } else if (match[2]) {
      nodes.push(
        <strong key={key++} className="font-semibold text-[var(--alloy-text-primary)]">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      nodes.push(
        <em key={key++} className="italic text-[var(--alloy-text-secondary)]">
          {match[3]}
        </em>
      );
    } else if (match[4] && match[5]) {
      nodes.push(
        <span
          key={key++}
          className="text-[var(--alloy-accent)] underline cursor-pointer hover:text-[var(--alloy-accent-hover)] transition-colors"
        >
          {match[4]}
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/* ── Artifact chip ────────────────────────────────────────────────── */

function ArtifactChip({
  artifact,
}: {
  artifact: { type: string; path?: string; language?: string };
}) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--alloy-bg-tertiary)] border border-[var(--alloy-border-subtle)] text-[11px]">
      <span className="text-[var(--alloy-text-muted)]">{artifact.type}</span>
      {artifact.path && (
        <span className="font-mono text-[var(--alloy-text-secondary)] truncate max-w-[180px]">
          {artifact.path}
        </span>
      )}
      {artifact.language && <Badge variant="default" size="xs">{artifact.language}</Badge>}
    </div>
  );
}
