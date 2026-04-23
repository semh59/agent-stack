/**
 * MCP page — manage connected Model Context Protocol servers.
 */
import { Server as ServerIcon, Plus, Trash2, Terminal, Globe, Box } from "lucide-react";
import {
  Field,
  Input,
  Row,
  Select,
  Switch,
  Textarea,
} from "../../../../components/sovereign/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";
import type { ChangeEvent } from "react";
import clsx from "clsx";

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

function generateMcpId() {
  return `srv_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000).toString(36)}`;
}

export function McpPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();
  const servers = (getAtPath<McpServer[]>(effective, "mcp.servers", []) ?? []) as McpServer[];

  const setServers = (next: McpServer[]) => updateSettingsPath("mcp.servers", next);

  const addServer = () => {
    const id = generateMcpId();
    setServers([
      ...servers,
      {
        id,
        name: "NEW_MCP_NODE",
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
    <div className="space-y-12 pb-20">
      <div className="flex items-center justify-between p-6 bg-blue-500/5 border border-blue-500/10 rounded-2xl mb-8">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-blue-500/20 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
             <ServerIcon size={20} />
          </div>
          <div>
             <h2 className="text-sm font-bold uppercase tracking-widest text-white">External Tools (MCP)</h2>
             <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Connect external servers to give the AI more tools and data access.</p>
          </div>
        </div>
        <button
          onClick={addServer}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 border border-blue-500/20 rounded-lg text-[10px] font-bold uppercase tracking-widest text-blue-100 hover:bg-blue-500/40 hover:text-white transition-all shadow-lg active:scale-95"
        >
          <Plus size={14} />
          Add New Server
        </button>
      </div>

      {servers.length === 0 ? (
        <div className="py-20 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-center">
           <Box size={48} className="text-white/5 mb-4" />
           <p className="text-xs font-bold uppercase tracking-widest text-white/20">No external tool servers connected.</p>
           <button onClick={addServer} className="mt-4 text-[10px] text-blue-400 hover:underline font-bold uppercase tracking-widest">Initialization Required</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {servers.map((srv, i) => (
            <div key={srv.id} className="group relative bg-black/40 border border-white/5 rounded-2xl transition-all duration-300 hover:border-white/10 shadow-alloy-elevated overflow-hidden">
               {/* Transport Strip */}
               <div className={clsx(
                 "absolute left-0 top-0 bottom-0 w-1",
                 srv.enabled ? "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" : "bg-white/5"
               )} />

               <header className="flex items-center justify-between p-6 border-b border-white/5">
                  <div className="flex items-center gap-4 flex-1">
                    <div className={clsx(
                      "h-8 w-8 rounded-lg flex items-center justify-center border",
                      srv.enabled ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-white/5 border-white/5 text-white/10"
                    )}>
                       {srv.transport === 'stdio' ? <Terminal size={14} /> : <Globe size={14} />}
                    </div>
                    <Input
                       value={srv.name}
                       onChange={(e: ChangeEvent<HTMLInputElement>) => patchServer(i, { name: e.target.value })}
                       className="bg-transparent border-none p-0 focus:ring-0 text-sm font-bold uppercase tracking-tight text-white w-full max-w-sm"
                       placeholder="Server Name"
                    />
                  </div>

                  <div className="flex items-center gap-6">
                     <div className="flex items-center gap-3">
                        <span className="text-[9px] font-bold text-white/10 uppercase tracking-widest">Active</span>
                        <Switch
                          ariaLabel={`Enable ${srv.name}`}
                          checked={srv.enabled}
                          onChange={(enabled: boolean) => patchServer(i, { enabled })}
                        />
                     </div>
                     <button
                        onClick={() => {
                          const next = [...servers];
                          next.splice(i, 1);
                          setServers(next);
                        }}
                        className="p-2 text-white/10 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                  </div>
               </header>

               <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <Row label="Connection Type">
                      <Select
                        value={srv.transport}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                          patchServer(i, { transport: e.target.value as McpServer["transport"] })
                        }
                        className="bg-black/40 border-white/10 font-mono text-[10px]"
                      >
                        <option value="stdio">LOCAL_STDIO (POSIX)</option>
                        <option value="http">REMOTE_HTTP (SSE)</option>
                        <option value="websocket">REMOTE_WSS</option>
                      </Select>
                    </Row>

                    {srv.transport === "stdio" ? (
                      <>
                        <Row label="Server Command" hint="Executable to run (e.g. node, python, or absolute path).">
                          <Input
                            value={srv.command ?? ""}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => patchServer(i, { command: e.target.value })}
                            placeholder="uvx server-exec"
                            className="font-mono text-xs"
                          />
                        </Row>
                        <Field label="Arguments" hint="Command line arguments (one per line).">
                          <Textarea
                            value={(srv.args ?? []).join("\n")}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                              patchServer(i, {
                                args: e.target.value
                                  .split("\n")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            className="min-h-[100px] bg-black/40 border-white/5 font-mono text-[11px]"
                            placeholder="--port\n3000"
                          />
                        </Field>
                      </>
                    ) : (
                      <Row label="Server URL" hint="The address of the remote server.">
                        <Input
                          value={srv.url ?? ""}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => patchServer(i, { url: e.target.value })}
                          placeholder={srv.transport === "http" ? "https://relay.cluster.local" : "wss://relay.cluster.local"}
                          className="font-mono text-xs"
                        />
                      </Row>
                    )}
                  </div>

                  <div className="space-y-6">
                    <Field label="Environment Variables" hint="KEY=VALUE pairs.">
                      <Textarea
                        value={Object.entries(srv.env ?? {})
                          .map(([k, v]) => `${k}=${v}`)
                          .join("\n")}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                          const parsed: Record<string, string> = {};
                          for (const line of e.target.value.split("\n")) {
                            const idx = line.indexOf("=");
                            if (idx <= 0) continue;
                            parsed[line.slice(0, idx).trim()] = line.slice(idx + 1);
                          }
                          patchServer(i, { env: parsed });
                        }}
                        className="min-h-[100px] bg-black/40 border-white/5 font-mono text-[11px]"
                        placeholder="DEBUG=alloy:*"
                      />
                    </Field>

                    <Field label="Tool Allowlist" hint="Empty = All tools. Filter tools by name.">
                      <Textarea
                        value={(srv.tool_allowlist ?? []).join("\n")}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                          patchServer(i, {
                            tool_allowlist: e.target.value
                              .split("\n")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="min-h-[100px] bg-black/40 border-white/5 font-mono text-[11px]"
                        placeholder="git_commit\nfile_search"
                      />
                    </Field>

                    <div className="pt-4 flex items-center justify-between border-t border-white/5">
                       <span className="text-[9px] font-mono text-white/10">ID: {srv.id}</span>
                       <div className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded text-[9px] font-bold text-white/20 uppercase tracking-[0.2em]">Connected</div>
                    </div>
                  </div>
               </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
