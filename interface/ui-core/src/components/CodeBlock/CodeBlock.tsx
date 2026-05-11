import { useEnvironmentContext } from "../../hooks/useEnvironmentContext";
import { useTransport } from "../../transport/TransportProvider";
import { useState } from "react";

export interface CodeBlockProps {
  code: string;
  language?: string;
  filePath?: string;
}

export function CodeBlock({ code, language = "plaintext", filePath }: CodeBlockProps) {
  const env = useEnvironmentContext();
  const transport = useTransport();
  const [copied, setCopied] = useState(false);

  const handleAction = async () => {
    if (env === "vscode") {
      // IDE: Send a diff/apply command over the transport
      await transport.post("APPLY_DIFF", { code, filePath });
    } else {
      // Console: Copy to clipboard as standard
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative my-4 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] text-xs border-b border-[var(--color-border-primary)]">
        <span className="font-semibold">{filePath || language}</span>
        <button
          onClick={handleAction}
          className="flex gap-2 items-center px-2 py-1 rounded bg-[var(--color-surface-primary)] hover:bg-[var(--color-accent-hover)] hover:text-white transition-colors cursor-pointer"
        >
          {env === "vscode" ? "Apply to Editor" : copied ? "Copied!" : "Copy Code"}
        </button>
      </div>
      <div className="p-4 overflow-x-auto text-[var(--color-text-primary)] text-sm font-mono whitespace-pre">
        {code}
      </div>
    </div>
  );
}
