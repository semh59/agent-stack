/** Spinner — inline styles, no Tailwind. */
export interface SpinnerProps { size?: number; color?: string; }

export function Spinner({ size = 16, color = "var(--a-accent)" }: SpinnerProps) {
  return (
    <>
      <span style={{
        display:"inline-block", width:size, height:size, borderRadius:"50%",
        border:`2px solid ${color}`, borderTopColor:"transparent",
        animation:"_spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes _spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
