/**
 * Lightweight message renderer.
 *
 * We deliberately do not pull in a full Markdown parser — chat replies from
 * the optimize bridge follow a constrained shape (headings via **bold**,
 * fenced code blocks, and plain paragraphs). Keeping the renderer local keeps
 * the bundle small and lets us enforce safe escaping.
 *
 * Supported constructs:
 *   ```lang\n…\n```            → <pre><code>
 *   `inline`                    → <code>
 *   **bold**                    → <strong>
 *   blank line                  → paragraph break
 *
 * Untrusted content is HTML-escaped before any tag replacement, so we never
 * hand raw HTML to the DOM.
 */
import { useMemo, type ReactNode } from "react";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Block =
  | { kind: "code"; lang?: string; text: string }
  | { kind: "prose"; text: string };

function parseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  const lines = raw.split("\n");
  let i = 0;
  let buffer: string[] = [];

  const flushProse = () => {
    if (buffer.length === 0) return;
    blocks.push({ kind: "prose", text: buffer.join("\n").trim() });
    buffer = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const fenceMatch = /^```([\w-]*)\s*$/.exec(line.trimStart());
    if (fenceMatch) {
      flushProse();
      const lang = fenceMatch[1] || undefined;
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i]!.trimStart())) {
        code.push(lines[i]!);
        i++;
      }
      // consume closing fence (if any)
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, text: code.join("\n") });
      continue;
    }
    buffer.push(line);
    i++;
  }
  flushProse();
  return blocks;
}

/** Inline transforms inside a prose block. Returns an array of React nodes. */
function renderInline(escaped: string, keyPrefix: string): ReactNode[] {
  // `inline`
  const codeSplit = escaped.split(/(`[^`]+`)/g);
  const withCode: ReactNode[] = codeSplit.map((chunk, idx) => {
    if (chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 1) {
      return (
        <code
          key={`${keyPrefix}-c-${idx}`}
          className="rounded bg-[var(--color-loji-bg)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--color-loji-accent)]"
        >
          {chunk.slice(1, -1)}
        </code>
      );
    }
    // bold inside remaining text
    const boldSplit = chunk.split(/(\*\*[^*]+\*\*)/g);
    return boldSplit.map((piece, j) => {
      if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
        return (
          <strong key={`${keyPrefix}-b-${idx}-${j}`} className="font-semibold text-white">
            {piece.slice(2, -2)}
          </strong>
        );
      }
      return <span key={`${keyPrefix}-t-${idx}-${j}`}>{piece}</span>;
    });
  });
  return withCode;
}

export interface FormattedMessageProps {
  content: string;
  role: "user" | "assistant" | "system";
}

export function FormattedMessage({ content, role }: FormattedMessageProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  if (content.trim().length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-loji-text-sec)]">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-loji-accent)]" />
        <span>thinking…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, idx) => {
        if (block.kind === "code") {
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-xl border border-[var(--color-loji-border)] bg-[var(--color-loji-bg)] px-4 py-3 font-mono text-xs text-[var(--color-loji-text)]"
            >
              {block.lang ? (
                <div className="mb-2 font-ui text-[10px] uppercase tracking-widest text-[var(--color-loji-text-sec)]">
                  {block.lang}
                </div>
              ) : null}
              <code>{block.text}</code>
            </pre>
          );
        }
        const paragraphs = block.text.split(/\n{2,}/g).filter((p) => p.length > 0);
        return (
          <div key={idx} className="space-y-2">
            {paragraphs.map((para, pIdx) => (
              <p
                key={pIdx}
                className={
                  role === "user"
                    ? "whitespace-pre-wrap text-white"
                    : "whitespace-pre-wrap text-[var(--color-loji-text)]"
                }
              >
                {renderInline(escapeHtml(para), `p-${idx}-${pIdx}`)}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
