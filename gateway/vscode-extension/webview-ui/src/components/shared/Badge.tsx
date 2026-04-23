/* ═══════════════════════════════════════════════════════════════════
   Alloy Badge — Status indicator with variants
   ═══════════════════════════════════════════════════════════════════ */

import { cn } from "@/lib/utils";

export interface BadgeProps {
  variant?: "default" | "success" | "warning" | "error" | "info" | "accent" | "processing";
  size?: "xs" | "sm" | "md";
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Badge({
  variant = "default",
  size = "sm",
  dot = false,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium rounded-full whitespace-nowrap",
        // Variants
        variant === "default" && [
          "bg-[var(--alloy-bg-tertiary)] text-[var(--alloy-text-secondary)]",
          "border border-[var(--alloy-border-default)]",
        ],
        variant === "success" && [
          "bg-[rgba(16,185,129,0.12)] text-[var(--alloy-success-light)]",
          "border border-[rgba(16,185,129,0.2)]",
        ],
        variant === "warning" && [
          "bg-[rgba(245,158,11,0.12)] text-[var(--alloy-warning-light)]",
          "border border-[rgba(245,158,11,0.2)]",
        ],
        variant === "error" && [
          "bg-[rgba(239,68,68,0.12)] text-[var(--alloy-error-light)]",
          "border border-[rgba(239,68,68,0.2)]",
        ],
        variant === "info" && [
          "bg-[rgba(59,130,246,0.12)] text-[var(--alloy-info-light)]",
          "border border-[rgba(59,130,246,0.2)]",
        ],
        variant === "accent" && [
          "bg-[var(--alloy-accent-subtle)] text-[var(--alloy-accent)]",
          "border border-[var(--alloy-accent-muted)]",
        ],
        variant === "processing" && [
          "bg-[var(--alloy-accent-subtle)] text-[var(--alloy-accent)]",
          "border border-[var(--alloy-accent-muted)]",
        ],
        // Sizes
        size === "xs" && "px-1.5 py-0.5 text-[10px]",
        size === "sm" && "px-2 py-0.5 text-[11px]",
        size === "md" && "px-2.5 py-1 text-xs",
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "rounded-full shrink-0",
            variant === "success" && "w-1.5 h-1.5 bg-[var(--alloy-success)]",
            variant === "warning" && "w-1.5 h-1.5 bg-[var(--alloy-warning)]",
            variant === "error" && "w-1.5 h-1.5 bg-[var(--alloy-error)]",
            variant === "info" && "w-1.5 h-1.5 bg-[var(--alloy-info)]",
            variant === "processing" && "w-1.5 h-1.5 bg-[var(--alloy-accent)] animate-pulse",
            variant === "accent" && "w-1.5 h-1.5 bg-[var(--alloy-accent)]",
            variant === "default" && "w-1.5 h-1.5 bg-[var(--alloy-text-tertiary)]"
          )}
        />
      )}
      {children}
    </span>
  );
}