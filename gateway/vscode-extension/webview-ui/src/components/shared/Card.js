import { jsx as _jsx } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy Card — Elevated container with optional header/footer
   ═══════════════════════════════════════════════════════════════════ */
import { cn } from "@/lib/utils";
export function Card({ variant = "default", padding = "md", hover = false, glow = false, children, className, onClick, }) {
    return (_jsx("div", { role: onClick ? "button" : undefined, tabIndex: onClick ? 0 : undefined, onClick: onClick, onKeyDown: onClick ? (e) => e.key === "Enter" && onClick() : undefined, className: cn("rounded-lg border transition-all duration-150", 
        // Variants
        variant === "default" && [
            "bg-[var(--alloy-bg-secondary)] border-[var(--alloy-border-default)]",
        ], variant === "elevated" && [
            "bg-[var(--alloy-bg-elevated)] border-[var(--alloy-border-subtle)]",
            "shadow-[var(--alloy-shadow-md)]",
        ], variant === "ghost" && [
            "bg-transparent border-[var(--alloy-border-subtle)]",
        ], variant === "accent" && [
            "bg-[var(--alloy-accent-subtle)] border-[var(--alloy-accent-muted)]",
            glow && "shadow-[var(--alloy-glow-sm)]",
        ], 
        // Padding
        padding === "none" && "", padding === "sm" && "p-2", padding === "md" && "p-3", padding === "lg" && "p-4", 
        // Hover
        hover && "cursor-pointer hover:bg-[var(--alloy-bg-hover)] hover:border-[var(--alloy-border-strong)]", 
        // Glow
        glow && variant !== "accent" && "shadow-[var(--alloy-glow-sm)]", className), children: children }));
}
export function CardHeader({ children, className }) {
    return (_jsx("div", { className: cn("flex items-center gap-2 mb-2", className), children: children }));
}
export function CardTitle({ children, className }) {
    return (_jsx("h3", { className: cn("text-sm font-semibold text-[var(--alloy-text-primary)]", className), children: children }));
}
export function CardDescription({ children, className }) {
    return (_jsx("p", { className: cn("text-xs text-[var(--alloy-text-tertiary)]", className), children: children }));
}
