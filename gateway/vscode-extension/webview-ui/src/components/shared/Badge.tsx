/** Status badge — inline styles, no Tailwind. */
import type { ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "error";
}

const COLORS: Record<string, string> = {
  default: "var(--a-text3)",
  success: "var(--a-success)",
  warning: "var(--a-warning)",
  error:   "var(--a-error)",
};

export function Badge({ children, variant = "default" }: BadgeProps) {
  const color = COLORS[variant] ?? COLORS.default;
  return (
    <span style={{ fontSize:10, color, padding:"1px 6px", borderRadius:4, border:`1px solid ${color}`, display:"inline-flex", alignItems:"center" }}>
      {children}
    </span>
  );
}
