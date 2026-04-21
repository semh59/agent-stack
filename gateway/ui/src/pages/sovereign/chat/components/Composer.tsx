/**
 * Composer — the send-message input row.
 *
 * Auto-grows between 1 and 8 lines, sends on ⌘⏎ / Ctrl⏎, and shifts into a
 * disabled state while the bridge is streaming. The model picker lives in the
 * footer so switching models is a one-click operation without leaving the page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2, Send, Square } from "lucide-react";
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
  const { sendingMessage, sendError, sendMessage } = useAlloyStore();
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
    if (!text || sendingMessage) return;
    setValue("");
    try {
      await sendMessage(text, { model });
    } catch {
      /* errors surface through store */
    }
  }, [value, model, sendingMessage, sendMessage]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="border-t border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)]/60 backdrop-blur-sm">
      <div className="mx-auto max-w-3xl px-6 py-4">
        {sendError ? (
          <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {sendError}
          </div>
        ) : null}

        <div
          className={clsx(
            "relative rounded-2xl border bg-[var(--color-alloy-bg)] shadow-[0_10px_40px_-20px_rgba(0,0,0,0.8)] transition-colors",
            sendingMessage
              ? "border-[var(--color-alloy-accent)]/40"
              : "border-[var(--color-alloy-border)] focus-within:border-[var(--color-alloy-accent)]/40",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Alloy anything — it will route through the optimization pipeline first."
            disabled={sendingMessage}
            rows={MIN_ROWS}
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 font-body text-sm text-white placeholder:text-[var(--color-alloy-text-sec)] focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-alloy-border)]/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <ModelPicker value={model} onChange={setModel} />
              <span className="hidden text-[11px] text-[var(--color-alloy-text-sec)] md:inline">
                <CornerDownLeft size={10} className="inline" /> ⌘⏎ to send
              </span>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={sendingMessage || value.trim().length === 0}
              className={clsx(
                "inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                "bg-[var(--color-alloy-accent)] text-black hover:bg-[var(--color-alloy-accent)]/90",
              )}
            >
              {sendingMessage ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Optimizing
                </>
              ) : (
                <>
                  <Send size={12} />
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Small inline icon for "stop streaming". Exported so the shell can offer a
 * cancel button later when we wire true streaming transport.
 */
export function StopIcon({ size = 14 }: { size?: number }) {
  return <Square size={size} />;
}
