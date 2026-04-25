/** Card container — inline styles, no Tailwind. */
import type { ReactNode, CSSProperties } from "react";

export interface CardProps { children: ReactNode; style?: CSSProperties; }

export function Card({ children, style }: CardProps) {
  return (
    <div style={{ borderRadius:8, border:"1px solid var(--a-border)", background:"var(--a-bg2)", padding:12, ...style }}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid var(--a-border)" }}>{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize:13, fontWeight:600, color:"var(--a-text)" }}>{children}</div>;
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <div style={{ fontSize:11, color:"var(--a-text3)", marginTop:2 }}>{children}</div>;
}
