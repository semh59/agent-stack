import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy Button — Premium button with variants & states
   ═══════════════════════════════════════════════════════════════════ */
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
export const Button = forwardRef(({ variant = "secondary", size = "md", loading = false, icon, iconRight, className, disabled, children, ...props }, ref) => {
    const isDisabled = disabled || loading;
    return (_jsxs("button", { ref: ref, disabled: isDisabled, className: cn("inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 rounded-md", "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--alloy-accent)]", "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none", 
        // Variants
        variant === "primary" && [
            "bg-[var(--alloy-accent)] text-white",
            "hover:bg-[var(--alloy-accent-hover)]",
            "active:scale-[0.97]",
            "shadow-[var(--alloy-shadow-sm)]",
        ], variant === "accent" && [
            "bg-[var(--alloy-accent-muted)] text-[var(--alloy-accent)]",
            "hover:bg-[var(--alloy-accent)] hover:text-white",
            "border border-[var(--alloy-border-accent)]",
        ], variant === "secondary" && [
            "bg-[var(--alloy-bg-tertiary)] text-[var(--alloy-text-primary)]",
            "hover:bg-[var(--alloy-bg-hover)]",
            "border border-[var(--alloy-border-default)]",
        ], variant === "ghost" && [
            "bg-transparent text-[var(--alloy-text-secondary)]",
            "hover:bg-[var(--alloy-bg-hover)] hover:text-[var(--alloy-text-primary)]",
        ], variant === "danger" && [
            "bg-[var(--alloy-error)] text-white",
            "hover:bg-[var(--alloy-error-dark)]",
            "active:scale-[0.97]",
        ], 
        // Sizes
        size === "xs" && "h-6 px-2 text-[11px]", size === "sm" && "h-7 px-2.5 text-xs", size === "md" && "h-8 px-3 text-[13px]", size === "lg" && "h-10 px-4 text-sm", className), ...props, children: [loading ? (_jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" })) : icon ? (_jsx("span", { className: "shrink-0", children: icon })) : null, children && _jsx("span", { children: children }), iconRight && !loading && (_jsx("span", { className: "shrink-0", children: iconRight }))] }));
});
Button.displayName = "Button";
