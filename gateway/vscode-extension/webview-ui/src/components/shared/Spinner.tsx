/* ═══════════════════════════════════════════════════════════════════
   Alloy Spinner — Animated loading indicator
   ═══════════════════════════════════════════════════════════════════ */

import { cn } from "@/lib/utils";

export interface SpinnerProps {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <svg
      className={cn(
        "animate-spin text-[var(--alloy-accent)]",
        size === "xs" && "w-3 h-3",
        size === "sm" && "w-4 h-4",
        size === "md" && "w-5 h-5",
        size === "lg" && "w-8 h-8",
        className
      )}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-80"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        fill="currentColor"
      />
    </svg>
  );
}