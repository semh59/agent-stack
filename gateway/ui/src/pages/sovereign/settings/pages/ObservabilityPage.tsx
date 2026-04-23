/**
 * Observability page — log levels, OpenTelemetry, Prometheus metrics.
 */
import { Gauge, Activity, Radio, Database, ShieldCheck } from "lucide-react";
import {
  Field,
  Input,
  Row,
  Section,
  Select,
  Switch,
} from "../../../../components/sovereign/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";
import type { ChangeEvent } from "react";

export function ObservabilityPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();

  return (
    <div className="space-y-12 pb-20">
      <div className="flex items-center gap-4 p-6 bg-cyan-500/5 border border-cyan-500/10 rounded-2xl mb-8">
        <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
           <Gauge size={20} />
        </div>
        <div>
           <h2 className="text-sm font-bold uppercase tracking-widest text-white">Telemetry_Control_Bridge</h2>
           <p className="text-[10px] text-white/40 mt-1 font-medium tracking-tight">Monitor and adjust the observability stack for real-time kernel forensics.</p>
        </div>
      </div>

      <Section
        title="Subsystem_Verbosity"
        description="Real-time adjustment of log levels across the node architecture."
        icon={<Activity size={16} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black/40 border border-white/5 rounded-2xl p-6">
           <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl">
             <span className="block text-[10px] font-bold text-white/20 uppercase tracking-widest mb-4">Gateway_TS</span>
             <Row label="LOG_LEVEL">
                <Select
                  value={getAtPath<string>(effective, "observability.log_level.gateway", "info") ?? "info"}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => updateSettingsPath("observability.log_level.gateway", e.target.value)}
                  className="bg-black/40 border-white/10 font-mono text-xs"
                >
                  <option value="debug">DEBUG_DETAILED</option>
                  <option value="info">INFO_STANDARD</option>
                  <option value="warn">WARN_FILTERED</option>
                  <option value="error">ERROR_ONLY</option>
                </Select>
             </Row>
           </div>

           <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl">
             <span className="block text-[10px] font-bold text-white/20 uppercase tracking-widest mb-4">Bridge_Python</span>
             <Row label="LOG_LEVEL">
                <Select
                  value={getAtPath<string>(effective, "observability.log_level.bridge", "INFO") ?? "INFO"}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => updateSettingsPath("observability.log_level.bridge", e.target.value)}
                  className="bg-black/40 border-white/10 font-mono text-xs"
                >
                  <option value="DEBUG">DEBUG_DETAILED</option>
                  <option value="INFO">INFO_STANDARD</option>
                  <option value="WARNING">WARN_FILTERED</option>
                  <option value="ERROR">ERROR_ONLY</option>
                </Select>
             </Row>
           </div>

           <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl md:col-span-2">
             <span className="block text-[10px] font-bold text-white/20 uppercase tracking-widest mb-4">MCP_Host_Relay</span>
             <Row label="LOG_LEVEL">
                <Select
                  value={getAtPath<string>(effective, "observability.log_level.mcp", "info") ?? "info"}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => updateSettingsPath("observability.log_level.mcp", e.target.value)}
                  className="bg-black/40 border-white/10 font-mono text-xs"
                >
                  <option value="debug">DEBUG_DETAILED</option>
                  <option value="info">INFO_STANDARD</option>
                  <option value="warn">WARN_FILTERED</option>
                  <option value="error">ERROR_ONLY</option>
                </Select>
             </Row>
           </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Section title="Distributed_Tracing" icon={<Radio size={16} />}>
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-6">
             <div className="flex items-center justify-between p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                <div>
                   <span className="block text-[10px] font-bold text-blue-400/80 uppercase">OpenTelemetry_State</span>
                   <p className="text-[10px] text-blue-400/40 mt-1 uppercase">Broadcast kernel traces to OTLP.</p>
                </div>
                <Switch
                  checked={getAtPath<boolean>(effective, "observability.otel.enabled", false) ?? false}
                  onChange={(v: boolean) => updateSettingsPath("observability.otel.enabled", v)}
                />
             </div>

             <Field label="Collector_URI" hint="OTLP gRPC/HTTP endpoint.">
                <Input
                  value={getAtPath<string>(effective, "observability.otel.endpoint", "") ?? ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateSettingsPath("observability.otel.endpoint", e.target.value)}
                  placeholder="https://otel.cluster.local:4318"
                  className="font-mono text-xs"
                />
             </Field>

             <Field label="Service_Namespace" hint="Appended to trace metadata.">
                <Input
                  value={getAtPath<string>(effective, "observability.otel.service_namespace", "") ?? ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updateSettingsPath("observability.otel.service_namespace", e.target.value)
                  }
                  placeholder="alloy.core.node"
                  className="font-mono text-xs"
                />
             </Field>
          </div>
        </Section>

        <Section title="Metric_Exposition" icon={<Database size={16} />}>
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                <div>
                   <span className="block text-[10px] font-bold text-emerald-400/80 uppercase">Prometheus_Export</span>
                   <p className="text-[10px] text-emerald-400/40 mt-1 uppercase">Expose internal counters on /metrics.</p>
                </div>
                <Switch
                  checked={getAtPath<boolean>(effective, "observability.metrics.enabled", true) ?? true}
                  onChange={(v: boolean) => updateSettingsPath("observability.metrics.enabled", v)}
                />
             </div>

             <Field label="Scrape_Port" hint="The dedicated port for the metrics server.">
                <Input
                  type="number"
                  value={String(getAtPath<number>(effective, "observability.metrics.port", 9090) ?? 9090)}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updateSettingsPath(
                      "observability.metrics.port",
                      e.target.value === "" ? undefined : Number(e.target.value),
                    )
                  }
                  className="font-mono text-xs max-w-[120px]"
                />
             </Field>

             <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl flex items-center gap-3">
                <ShieldCheck size={16} className="text-emerald-400/40" />
                <span className="text-[10px] font-bold text-emerald-400/40 uppercase">Kernel_Metrics_Validated</span>
             </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
