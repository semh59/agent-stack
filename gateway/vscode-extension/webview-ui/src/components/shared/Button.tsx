/** Button primitive — inline styles, no Tailwind. */
import { type ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}

const BG: Record<string, string> = {
  primary:   "var(--a-accent)",
  secondary: "var(--a-bg2)",
  ghost:     "transparent",
  danger:    "var(--a-error)",
};
const COLOR: Record<string, string> = {
  primary: "#000",
  secondary: "var(--a-text)",
  ghost:     "var(--a-text2)",
  danger:    "#fff",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading, children, disabled, style, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      style={{
        display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
        padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:500, cursor: (disabled||loading) ? "not-allowed" : "pointer",
        border:"none", background: BG[variant], color: COLOR[variant],
        opacity: (disabled||loading) ? 0.5 : 1,
        ...style,
      }}
      {...rest}
    >
      {loading && <span style={{ display:"inline-block", animation:"spin 1s linear infinite", fontSize:11 }}>⟳</span>}
      {children}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </button>
  )
);
Button.displayName = "Button";
