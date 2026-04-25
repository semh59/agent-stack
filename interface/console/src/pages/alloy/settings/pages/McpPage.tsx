import { useState } from "react";
import { Section, Field, Input, Button } from "../../../../components/Alloy/primitives";
import { Plug, Plus, Trash2 } from "lucide-react";

interface McpServer {
  id: string;
  name: string;
  url: string;
}

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  function handleAdd() {
    if (!name.trim() || !url.trim()) return;
    setServers((prev) => [...prev, { id: Date.now().toString(), name: name.trim(), url: url.trim() }]);
    setName("");
    setUrl("");
  }

  function handleRemove(id: string) {
    setServers((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Plug size={16} />}
        title="MCP Sunuculari"
        description="Model Context Protocol sunucularini yapilandirin."
      >
        <div className="flex flex-col gap-4 p-4">
          {servers.length > 0 && (
            <div className="flex flex-col divide-y divide-[var(--color-alloy-border)] rounded-xl border border-[var(--color-alloy-border)] overflow-hidden">
              {servers.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-[var(--color-alloy-bg)]">
                  <Plug size={13} className="shrink-0 text-[var(--color-alloy-accent)]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--color-alloy-text)] truncate">{s.name}</p>
                    <p className="text-[11px] text-[var(--color-alloy-text-sec)] truncate font-mono">{s.url}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(s.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-alloy-text-dim)] hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] p-4">
            <p className="text-[12px] font-semibold text-[var(--color-alloy-text)]">Sunucu Ekle</p>
            <Field label="Sunucu Adi" htmlFor="mcp-name">
              <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ornek: dosya-sunucusu" />
            </Field>
            <Field label="URL" htmlFor="mcp-url">
              <Input id="mcp-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3100" />
            </Field>
            <Button size="sm" onClick={handleAdd} disabled={!name.trim() || !url.trim()}>
              <Plus size={13} />
              Ekle
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
