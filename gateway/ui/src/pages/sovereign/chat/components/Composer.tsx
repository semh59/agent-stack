import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";
import clsx from "clsx";
import { useAlloyStore } from "../../../../store/alloyStore";
import { ModelPicker } from "./ModelPicker";

const MAX_ROWS = 8;
const MIN_ROWS = 1;

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "24");
  const max = lineHeight * MAX_ROWS + 24;
  const min = lineHeight * MIN_ROWS + 24;
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
      /* errors bubble through store */
    }
  }, [value, model, isGenerating, sendMessage]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const canSend = value.trim().length > 0 && !isGenerating;

  return (
    <div className="border-t border-[var(--color-alloy-border)] bg-[var(--color-alloy-surface)] px-4 pb-4 pt-3">
      <div className="mx-auto max-w-3xl">
        {/* Error banner */}
        {sendError && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {sendError}
          </div>
        )}

        {/* Compose box */}
        <div className={clsx(
          "relative flex flex-col rounded-xl border bg-[var(--color-alloy-bg)] transition-shadow",
          isGenerating
            ? "border-[var(--color-alloy-accent)] shadow-[var(--shadow-alloy-focus)]"
            : "border-[var(--color-alloy-border)] focus-within:border-[var(--color-alloy-accent)] focus-within:shadow-[var(--shadow-alloy-focus)]",
        )}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Bir şey sorun… (Enter gönderir, Shift+Enter yeni satır)"
            disabled={isGenerating}
            rows={MIN_ROWS}
            className="alloy-scroll block w-full resize-none bg-transparent px-4 py-3 text-sm text-[var(--color-alloy-text)] placeholder:text-[var(--color-alloy-text-dim)] focus:outline-none"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-alloy-border)] px-3 py-2">
            <ModelPicker value={model} onChange={setModel} />

            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-[var(--color-alloy-text-dim)] md:inline">
                Enter gönder
              </span>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                aria-label={isGenerating ? "İşleniyor" : "Gönder"}
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                  canSend
                    ? "bg-[var(--color-alloy-accent)] text-white hover:bg-[var(--color-alloy-accent-hover)] active:scale-95"
                    : "cursor-not-allowed bg-[var(--color-alloy-surface-hover)] text-[var(--color-alloy-text-dim)]",
                )}
              >
                {isGenerating
                  ? <Loader2 size={15} className="animate-spin" />
                  : <ArrowUp size={15} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StopIcon({ size = 14 }: { size?: number }) {
  return <Square size={size} />;
}
