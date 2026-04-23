/**
 * Composer — the send-message input row.
 *
 * Auto-grows between 1 and 8 lines, sends on ⌘⏎ / Ctrl⏎, and shifts into a
 * disabled state while the bridge is streaming. The model picker lives in the
 * footer so switching models is a one-click operation without leaving the page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2, Send, Square, Sparkles, Database, Zap } from "lucide-react";
import clsx from "clsx";
import { useAlloyStore } from "../../../../store/alloyStore";
import { ModelPicker } from "./ModelPicker";

const MAX_ROWS = 8;
const MIN_ROWS = 1;

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20");
  const max = lineHeight * MAX_ROWS + 16;
  const min = lineHeight * MIN_ROWS + 16;
  el.style.height = `${Math.max(min, Math.min(max, el.scrollHeight))}px`;
}

export function Composer() {
  const { isGenerating, error: sendError, sendMessage } = useAlloyStore();
  const [value, setValue] = useState("");
  const [model, setModel] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text || isGenerating) return;
    setValue("");
    try {
      await sendMessage(text, model);
    } catch {
      /* errors surface through store */
    }
  }, [value, model, isGenerating, sendMessage]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="border-t border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/60 backdrop-blur-xl">
      <div className="mx-auto max-w-4xl px-8 py-6">
        {sendError ? (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[11px] font-medium text-red-200">
            ERR // {sendError}
          </div>
        ) : null}

        <div className="mb-3 flex items-center gap-2 overflow-x-auto alloy-scroll pb-1">
          <ContextChip icon={<Sparkles size={10} />} label="AGENT_ORCHESTRATOR" active />
          <ContextChip icon={<Database size={10} />} label="REPO_CONTEXT" />
          <ContextChip icon={<Zap size={10} />} label="OPTIMIZE_PIPELINE" />
        </div>

        <div
          className={clsx(
            "relative rounded-xl border bg-black/40 shadow-alloy-elevated transition-all duration-500",
            isGenerating
              ? "border-[var(--color-alloy-accent)] ring-1 ring-[var(--color-alloy-accent)]/20"
              : "border-white/5 focus-within:border-[var(--color-alloy-accent)]/30 focus-within:ring-1 focus-within:ring-[var(--color-alloy-accent)]/10",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Alloy anything — Forge will optimize context first..."
            disabled={isGenerating}
            rows={MIN_ROWS}
            className="block w-full resize-none bg-transparent px-4 pt-4 pb-3 font-body text-sm text-white placeholder:text-white/20 focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2 border-t border-white/5 px-4 py-3">
            <div className="flex items-center gap-3">
              <ModelPicker value={model} onChange={setModel} />
              <div className="h-4 w-[1px] bg-white/5" />
              <span className="hidden text-[10px] font-bold tracking-widest text-white/20 md:inline uppercase">
                <CornerDownLeft size={10} className="inline mr-1 opacity-50" /> ⌘ ENTER
              </span>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={isGenerating || value.trim().length === 0}
              className={clsx(
                "inline-flex h-9 items-center gap-2 rounded-lg px-6 text-[11px] font-bold tracking-widest transition-all disabled:cursor-not-allowed disabled:opacity-50",
                isGenerating 
                  ? "bg-white/10 text-white/40" 
                  : "bg-molten text-black shadow-alloy-molten-glow hover:scale-[1.02] active:scale-95",
              )}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  FORGING...
                </>
              ) : (
                <>
                  <Send size={14} />
                  FORGE
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextChip({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button className={clsx(
      "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[9px] font-bold tracking-[0.1em] transition-all",
      active 
        ? "border-[var(--color-alloy-accent)]/30 bg-[var(--color-alloy-accent-dim)] text-[var(--color-alloy-accent)] shadow-[0_0_8px_rgba(0,240,255,0.1)]"
        : "border-white/5 bg-white/[0.02] text-white/30 hover:border-white/10 hover:text-white/50"
    )}>
      {icon}
      {label}
    </button>
  );
}

/**
 * Small inline icon for "stop streaming". Exported so the shell can offer a
 * cancel button later when we wire true streaming transport.
 */
export function StopIcon({ size = 14 }: { size?: number }) {
  return <Square size={size} />;
}
