/**
 * Observability page — log levels, OpenTelemetry, Prometheus metrics.
 */
import { Gauge } from "lucide-react";
import {
  Card,
  Input,
  Row,
  Section,
  Select,
  Switch,
} from "../../../../components/sovereign/primitives";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";

export function ObservabilityPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useSovereignStore();

  return (
    <div className="space-y-10">
      <Section
        title="Log levels"
        description="Adjust verbosity per subsystem. Restarts are not required — applied on next request."
        icon={<Gauge size={16} />}
      >
        <Card>
          <Row label="Gateway (TypeScript)">
            <Select
              value={getAtPath<string>(effective, "observability.log_level.gateway", "info") ?? "info"}
              onChange={(e) => updateSettingsPath("observability.log_level.gateway", e.target.value)}
            >
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </Select>
          </Row>
          <Row label="Bridge (Python)">
            <Select
              value={getAtPath<string>(effective, "observability.log_level.bridge", "INFO") ?? "INFO"}
              onChange={(e) => updateSettingsPath("observability.log_level.bridge", e.target.value)}
            >
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
            </Select>
          </Row>
          <Row label="MCP host">
            <Select
              value={getAtPath<string>(effective, "observability.log_level.mcp", "info") ?? "info"}
              onChange={(e) => updateSettingsPath("observability.log_level.mcp", e.target.value)}
            >
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </Select>
          </Row>
        </Card>
      </Section>

      <Section title="OpenTelemetry" description="Ship distributed traces to your OTLP-compatible collector.">
        <Card>
          <Row label="Enabled">
            <Switch
              checked={getAtPath<boolean>(effective, "observability.otel.enabled", false) ?? false}
              onChange={(v) => updateSettingsPath("observability.otel.enabled", v)}
            />
          </Row>
          <Row label="Endpoint" hint="OTLP HTTP/GRPC endpoint.">
            <Input
              value={getAtPath<string>(effective, "observability.otel.endpoint", "") ?? ""}
              onChange={(e) => updateSettingsPath("observability.otel.endpoint", e.target.value)}
              placeholder="https://otel.example.com:4318"
            />
          </Row>
          <Row label="Service namespace">
            <Input
              value={getAtPath<string>(effective, "observability.otel.service_namespace", "") ?? ""}
              onChange={(e) =>
                updateSettingsPath("observability.otel.service_namespace", e.target.value)
              }
              placeholder="sovereign-ai"
            />
          </Row>
        </Card>
      </Section>

      <Section title="Prometheus" description="Expose a /metrics endpoint for scraping.">
        <Card>
          <Row label="Enabled">
            <Switch
              checked={getAtPath<boolean>(effective, "observability.metrics.enabled", true) ?? true}
              onChange={(v) => updateSettingsPath("observability.metrics.enabled", v)}
            />
          </Row>
          <Row label="Port">
            <Input
              type="number"
              value={String(getAtPath<number>(effective, "observability.metrics.port", 9090) ?? 9090)}
              onChange={(e) =>
                updateSettingsPath(
                  "observability.metrics.port",
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            />
          </Row>
        </Card>
      </Section>
    </div>
  );
}
