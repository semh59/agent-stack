/* ═══════════════════════════════════════════════════════════════════
   Alloy ChatInput — Advanced input with @-context chips, model & skills
   ═══════════════════════════════════════════════════════════════════ */

import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Square, Sparkles, FileCode, FolderOpen, MousePointer2, X, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shared";
import { ModelSelector } from "./ModelSelector";
import { TokenBadge } from "./TokenBadge";
import { useChatStore } from "@/store/chatStore";

/* ── Context chip types ──────────────────────────────────────────── */

type ContextType = "file" | "workspace" | "selection";

interface ContextChip {
  id: string;
  type: ContextType;
  label: string;
}

const CONTEXT_OPTIONS: { type: ContextType; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    type: "file",
    label: "Active File",
    hint: "Attach current editor file",
    icon: <FileCode className="w-3.5 h-3.5" />,
  },
  {
    type: "workspace",
    label: "Workspace",
    hint: "Attach file tree",
    icon: <FolderOpen className="w-3.5 h-3.5" />,
  },
  {
    type: "selection",
    label: "Selection",
    hint: "Attach selected text",
    icon: <MousePointer2 className="w-3.5 h-3.5" />,
  },
];

/* ── Main component ──────────────────────────────────────────────── */

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
}

export function ChatInput({ onSend, onStop }: ChatInputProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<ContextChip[]>([]);
  const [showAtPicker, setShowAtPicker] = useState(false);
  const [atPickerIdx, setAtPickerIdx] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const { isStreaming, availableSkills } = useChatStore();

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // Close picker on outside click
  useEffect(() => {
    if (!showAtPicker) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowAtPicker(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showAtPicker]);

  const addChip = useCallback((type: ContextType) => {
    setChips((prev) => {
      if (prev.some((c) => c.type === type)) return prev;
      const option = CONTEXT_OPTIONS.find((o) => o.type === type)!;
      return [...prev, { id: `${type}-${Date.now()}`, type, label: option.label }];
    });
    setShowAtPicker(false);
    // Remove the "@" that triggered the picker
    setText((prev) => prev.replace(/@$/, "").replace(/@(\w*)$/, ""));
    textareaRef.current?.focus();
  }, []);

  const removeChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const buildMessageWithContext = useCallback(
    (raw: string) => {
      if (chips.length === 0) return raw;
      const ctxTags = chips.map((c) => `[@${c.type}]`).join(" ");
      return `${ctxTags} ${raw}`.trim();
    },
    [chips]
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(buildMessageWithContext(trimmed));
    setText("");
    setChips([]);
    setShowAtPicker(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, isStreaming, onSend, buildMessageWithContext]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    // Detect trailing "@" to open picker
    if (val.endsWith("@")) {
      setShowAtPicker(true);
      setAtPickerIdx(0);
    } else if (!val.includes("@")) {
      setShowAtPicker(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showAtPicker) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtPickerIdx((i) => (i + 1) % CONTEXT_OPTIONS.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtPickerIdx((i) => (i - 1 + CONTEXT_OPTIONS.length) % CONTEXT_OPTIONS.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          addChip(CONTEXT_OPTIONS[atPickerIdx].type);
          return;
        }
        if (e.key === "Escape") {
          setShowAtPicker(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showAtPicker, atPickerIdx, addChip, handleSend]
  );

  return (
    <div className="flex flex-col border-t border-[var(--alloy-border-default)] bg-[var(--alloy-bg-secondary)]">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--alloy-border-subtle)]">
        <ModelSelector />
        <TokenBadge />
        <div className="flex-1" />
        {availableSkills.length > 0 && (
          <span className="text-[10px] text-[var(--alloy-text-muted)]">
            {availableSkills.length} skills
          </span>
        )}
        {/* @ shortcut hint */}
        <button
          onClick={() => {
            setText((prev) => prev + "@");
            setShowAtPicker(true);
            setAtPickerIdx(0);
            textareaRef.current?.focus();
          }}
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]",
            "text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-secondary)]",
            "hover:bg-[var(--alloy-bg-hover)] transition-colors duration-100"
          )}
          title="Attach context (@)"
        >
          <AtSign className="w-3 h-3" />
        </button>
      </div>

      {/* Context Chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pt-1.5">
          {chips.map((chip) => {
            const opt = CONTEXT_OPTIONS.find((o) => o.type === chip.type)!;
            return (
              <span
                key={chip.id}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
                  "text-[10px] font-medium border",
                  "bg-[var(--alloy-accent-subtle)] border-[var(--alloy-accent-muted)] text-[var(--alloy-accent)]"
                )}
              >
                {opt.icon}
                {chip.label}
                <button
                  onClick={() => removeChip(chip.id)}
                  className="ml-0.5 hover:opacity-60 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2 p-2 relative">
        {/* @-context picker */}
        {showAtPicker && (
          <div
            ref={pickerRef}
            className={cn(
              "absolute bottom-full left-2 mb-1 w-52 z-50",
              "bg-[var(--alloy-bg-elevated)] border border-[var(--alloy-border-default)]",
              "rounded-lg shadow-[var(--alloy-shadow-lg)] overflow-hidden",
              "animate-slide-down"
            )}
          >
            <div className="px-2.5 py-1.5 border-b border-[var(--alloy-border-subtle)]">
              <span className="text-[10px] text-[var(--alloy-text-muted)] uppercase tracking-wide font-semibold">
                Attach context
              </span>
            </div>
            {CONTEXT_OPTIONS.map((opt, idx) => (
              <button
                key={opt.type}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  addChip(opt.type);
                }}
                onMouseEnter={() => setAtPickerIdx(idx)}
                className={cn(
                  "w-full flex items-start gap-2.5 px-2.5 py-2 text-left transition-colors",
                  idx === atPickerIdx
                    ? "bg-[var(--alloy-accent-subtle)]"
                    : "hover:bg-[var(--alloy-bg-hover)]"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    idx === atPickerIdx
                      ? "text-[var(--alloy-accent)]"
                      : "text-[var(--alloy-text-muted)]"
                  )}
                >
                  {opt.icon}
                </span>
                <span>
                  <span
                    className={cn(
                      "block text-[12px] font-medium",
                      idx === atPickerIdx
                        ? "text-[var(--alloy-accent)]"
                        : "text-[var(--alloy-text-primary)]"
                    )}
                  >
                    {opt.label}
                  </span>
                  <span className="block text-[10px] text-[var(--alloy-text-muted)]">
                    {opt.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Waiting for response..."
                : "Ask Alloy anything… type @ to attach context"
            }
            disabled={isStreaming}
            rows={1}
            className={cn(
              "w-full resize-none rounded-lg px-3 py-2 pr-8",
              "bg-[var(--alloy-bg-primary)] border border-[var(--alloy-border-default)]",
              "text-[13px] text-[var(--alloy-text-primary)] placeholder:text-[var(--alloy-text-muted)]",
              "focus:border-[var(--alloy-accent)] focus:ring-1 focus:ring-[var(--alloy-accent-muted)]",
              "transition-all duration-150 outline-none",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-[36px] max-h-[200px]"
            )}
          />
          <div className="absolute right-2 bottom-2">
            <Sparkles className="w-3.5 h-3.5 text-[var(--alloy-text-muted)]" />
          </div>
        </div>

        {/* Send / Stop Button */}
        {isStreaming ? (
          <Button
            variant="danger"
            size="sm"
            onClick={onStop}
            icon={<Square className="w-3 h-3" />}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!text.trim() && chips.length === 0}
            icon={<Send className="w-3 h-3" />}
          >
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
