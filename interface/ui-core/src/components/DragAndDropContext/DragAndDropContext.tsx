import { useEffect, useState } from "react";
import { useEnvironmentContext } from "../../hooks/useEnvironmentContext";
import { useTransport } from "../../transport/TransportProvider";

export interface DragAndDropContextProps {
  children: React.ReactNode;
}

export function DragAndDropContextPanel({ children }: DragAndDropContextProps) {
  const env = useEnvironmentContext();
  const transport = useTransport();
  const [activeDrops, setActiveDrops] = useState<any[]>([]);
  const [isHovering, setIsHovering] = useState(false);

  // In VS Code, we listen to context sync events directly
  useEffect(() => {
    if (env === "vscode") {
      const unsubscribe = transport.subscribe("SYNC_ACTIVE_CONTEXT", (payload) => {
        setActiveDrops((prev) => [...prev, payload]);
      });
      return () => unsubscribe();
    }
  }, [env, transport]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovering(false);
    
    // In Web Console, we extract files or text manually
    if (env === "console") {
      const text = e.dataTransfer.getData("text/plain");
      if (text) {
        setActiveDrops((prev) => [...prev, { type: "text", content: text }]);
      }
    }
  };

  return (
    <div
      className={`relative w-full h-full transition-all ${isHovering ? "ring-2 ring-[var(--color-accent-primary)] bg-[var(--color-surface-tertiary)] opacity-90" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsHovering(true); }}
      onDragLeave={() => setIsHovering(false)}
      onDrop={handleDrop}
    >
      {activeDrops.length > 0 && (
        <div className="absolute top-0 right-0 m-4 flex flex-col gap-2 z-50">
          {activeDrops.map((drop, idx) => (
            <div key={idx} className="bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] text-xs p-2 rounded shadow-md border border-[var(--color-border-primary)]">
              {drop.content || drop.fileName || "Unknown Context"}
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
