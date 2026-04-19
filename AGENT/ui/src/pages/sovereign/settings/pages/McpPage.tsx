/**
 * MCP page — manage connected Model Context Protocol servers.
 *
 * Supports three transports:
 *   - stdio      (command + args; runs a child process)
 *   - http       (URL; HTTP+SSE transport)
 *   - websocket  (URL; WS transport)
 *
 * Each server has a tool allowlist — empty = allow all, otherwise only
 * the named tools are exposed to models.
 */
import { Server, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  Row,
  Section,
  Select,
  Switch,
  Textarea,
} from "../../../../components/sovereign/primitives";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";

interface McpServer {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "websocket";
  command?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
  tool_allowlist: string[];
}

export function McpPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useSovereignStore();
  const servers = (getAtPath<McpServer[]>(effective, "mcp.servers", []) ?? []) as McpServer[];

  const setServers = (next: McpServer[]) => updateSettingsPath("mcp.servers", next);

  const addServer = () => {
    const id = `srv_${Math.random().toString(36).slice(2, 8)}`;
    setServers([
      ...servers,
      {
        id,
        name: "New server",
        enabled: true,
        transport: "stdio",
        command: "",
        args: [],
        url: "",
        env: {},
        tool_allowlist: [],
      },
    ]);
  };

  const patchServer = (i: number, patch: Partial<McpServer>) => {
    const next = [...servers];
    next[i] = { ...next[i]!, ...patch };
    setServers(next);
  };

  return (
    <div className="space-y-8">
      <Section
        title="MCP servers"
        description="Connect Model Context Protocol servers to expose tools and resources to the models."
        icon={<Server size={16} />}
        action={
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={addServer}>
            Add server
          </Button>
        }
      >
        {servers.length === 0 ? (
          <Card className="text-center text-sm text-[var(--color-loji-text-sec)]">
            No MCP servers configured. Add one to expose tools and resources to the assistant.
          </Card>
        ) : (
          <div className="space-y-4">
            {servers.map((srv, i) => (
              <Card key={srv.id} density="comfortable" tone={srv.enabled ? "accent" : "neutral"}>
                <header className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <Input
                      value={srv.name}
                      onChange={(e) => patchServer(i, { name: e.target.value })}
                      className="font-display text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      ariaLabel={`Enable ${srv.name}`}
                      checked={srv.enabled}
                      onChange={(enabled) => patchServer(i, { enabled })}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => {
                        const next = [...servers];
                        next.splice(i, 1);
                        setServers(next);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </header>

                <div className="mt-4">
                  <Row label="Transport">
                    <Select
                      value={srv.transport}
                      onChange={(e) =>
                        patchServer(i, { transport: e.target.value as McpServer["transport"] })
                      }
                    >
                      <option value="stdio">stdio (local process)</option>
                      <option value="http">HTTP</option>
                      <option value="websocket">WebSocket</option>
                    </Select>
                  </Row>

                  {srv.transport === "stdio" ? (
                    <>
                      <Row label="Command" hint="Executable to spawn (absolute path or in PATH).">
                        <Input
                          value={srv.command ?? ""}
                          onChange={(e) => patchServer(i, { command: e.target.value })}
                          placeholder="uvx my-mcp-server"
                        />
                      </Row>
                      <Row label="Arguments" hint="One arg per line.">
                        <Textarea
                          value={(srv.args ?? []).join("\n")}
                          onChange={(e) =>
                            patchServer(i, {
                              args: e.target.value
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </Row>
                    </>
                  ) : (
                    <Row label="URL" hint="Full endpoint URL including scheme.">
                      <Input
                        value={srv.url ?? ""}
                        onChange={(e) => patchServer(i, { url: e.target.value })}
                        placeholder={srv.transport === "http" ? "https://…" : "wss://…"}
                      />
                    </Row>
                  )}

                  <Row label="Environment variables" hint="KEY=value per line.">
                    <Textarea
                      value={Object.entries(srv.env ?? {})
                        .map(([k, v]) => `${k}=${v}`)
                        .join("\n")}
                      onChange={(e) => {
                        const parsed: Record<string, string> = {};
                        for (const line of e.target.value.split("\n")) {
                          const idx = line.indexOf("=");
                          if (idx <= 0) continue;
                          parsed[line.slice(0, idx).trim()] = line.slice(idx + 1);
                        }
                        patchServer(i, { env: parsed });
                      }}
                    />
                  </Row>

                  <Row label="Tool allowlist" hint="Empty = all tools allowed. One tool per line.">
                    <Textarea
                      value={(srv.tool_allowlist ?? []).join("\n")}
                      onChange={(e) =>
                        patchServer(i, {
                          tool_allowlist: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Row>

                  <Field label="Server ID" className="mt-4">
                    <Input value={srv.id} readOnly disabled />
                  </Field>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
