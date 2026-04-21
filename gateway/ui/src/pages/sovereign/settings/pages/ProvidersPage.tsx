/**
 * Providers page — configure every LLM provider.
 *
 * Each provider gets its own collapsible card. Toggling `enabled` reveals
 * the provider's fields; `Test connection` runs the server-side probe
 * without first requiring a save (the probe reads what's already saved on
 * disk, so unsaved edits are NOT tested — this is called out in the UI).
 */
import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, Activity, Zap } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Row,
  Section,
  SecretInput,
  Switch,
} from "../../../../components/alloy/primitives";
import { useAlloyStore } from "../../../../store/alloyStore";
import { getAtPath, isSecretSet, useEffectiveSettings } from "../useEffectiveSettings";

interface ProviderDef {
  id: string;
  label: string;
  blurb: string;
  kind: "local" | "hosted" | "enterprise";
  hasApiKey: boolean;
  defaultCta?: string;
  helpUrl?: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "ollama",
    label: "Ollama",
    blurb: "Local-first open-source models. Zero latency, zero cost.",
    kind: "local",
    hasApiKey: false,
    helpUrl: "https://ollama.com/download",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    blurb: "200+ models across every frontier lab through a single key.",
    kind: "hosted",
    hasApiKey: true,
    helpUrl: "https://openrouter.ai/keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    blurb: "Direct access to Claude. Highest quality on reasoning-heavy work.",
    kind: "hosted",
    hasApiKey: true,
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT-4o family, embeddings, fine-tunes. Also works with Azure backend.",
    kind: "hosted",
    hasApiKey: true,
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    label: "Google",
    blurb: "Gemini via OAuth. Uses the Alloy AI credentials in Accounts.",
    kind: "hosted",
    hasApiKey: false,
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    blurb: "Local OpenAI-compatible server. Good for on-device experimentation.",
    kind: "local",
    hasApiKey: false,
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    blurb: "Enterprise-compliant OpenAI with regional endpoints and deployments.",
    kind: "enterprise",
    hasApiKey: true,
    helpUrl: "https://portal.azure.com",
  },
];

export function ProvidersPage() {
  return (
    <div className="space-y-8">
      <Section
        title="Providers"
        description="Connect LLM vendors and local runtimes. Fill in credentials here — no .env files required."
        icon={<Zap size={16} />}
      >
        <div className="space-y-4">
          {PROVIDERS.map((p) => (
            <ProviderCard key={p.id} def={p} />
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ProviderCard
// ─────────────────────────────────────────────────────────────────────────────

function ProviderCard({ def }: { def: ProviderDef }) {
  const effective = useEffectiveSettings();
  const { updateSettingsPath, probeProvider, providerProbes } = useAlloyStore();
  const [expanded, setExpanded] = useState(def.kind === "local");

  const base = `providers.${def.id}`;
  const enabled = getAtPath<boolean>(effective, `${base}.enabled`, false);
  const probe = providerProbes[def.id];

  return (
    <Card density="compact" tone={enabled ? "accent" : "neutral"}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-4">
          <div
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-bold uppercase",
              enabled
                ? "border-[var(--color-alloy-accent)]/40 bg-[var(--color-alloy-accent)]/10 text-[var(--color-alloy-accent)]"
                : "border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] text-[var(--color-alloy-text-sec)]",
            )}
          >
            {def.label.slice(0, 2)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-sm tracking-wide text-white">{def.label}</h3>
              <KindBadge kind={def.kind} />
              <ProbeBadge probe={probe} />
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-alloy-text-sec)]">{def.blurb}</p>
          </div>
        </div>
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Switch
            ariaLabel={`Enable ${def.label}`}
            checked={enabled}
            onChange={(next) => updateSettingsPath(`${base}.enabled`, next)}
          />
          <ChevronDown
            size={18}
            className={clsx(
              "text-[var(--color-alloy-text-sec)] transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>

      {expanded ? (
        <div className="mt-5 border-t border-[var(--color-alloy-border)] pt-5">
          <ProviderFields def={def} />
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Activity size={14} />}
              onClick={() => probeProvider(def.id)}
              loading={probe && "loading" in probe ? true : false}
            >
              Test connection
            </Button>
            {def.helpUrl ? (
              <a
                href={def.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--color-alloy-accent)] hover:underline"
              >
                Get API key ↗
              </a>
            ) : null}
          </div>
          {probe && "ok" in probe ? <ProbeDetails probe={probe} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

function KindBadge({ kind }: { kind: ProviderDef["kind"] }) {
  if (kind === "local") return <Badge tone="success">Local</Badge>;
  if (kind === "enterprise") return <Badge tone="warning">Enterprise</Badge>;
  return <Badge tone="neutral">Cloud</Badge>;
}

function ProbeBadge({ probe }: { probe: ReturnType<typeof useAlloyStore.getState>["providerProbes"][string] | undefined }) {
  if (!probe) return null;
  if ("loading" in probe) return <Badge tone="neutral">Testing…</Badge>;
  return probe.ok ? (
    <Badge tone="success">{probe.latency_ms}ms · OK</Badge>
  ) : (
    <Badge tone="danger">{probe.reason}</Badge>
  );
}

function ProbeDetails({ probe }: { probe: { ok: boolean; reason: string; detail?: string; models_seen?: number; latency_ms: number } }) {
  return (
    <div
      className={clsx(
        "mt-3 rounded-lg border px-3 py-2 text-xs",
        probe.ok
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
          : "border-red-500/30 bg-red-500/5 text-red-200",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">{probe.ok ? "Connected" : "Failed"}</span>
        <span className="text-[var(--color-alloy-text-sec)]">· {probe.latency_ms}ms</span>
      </div>
      {probe.detail ? <p className="mt-1">{probe.detail}</p> : null}
      {typeof probe.models_seen === "number" ? (
        <p className="mt-1 text-[var(--color-alloy-text-sec)]">
          {probe.models_seen} model{probe.models_seen === 1 ? "" : "s"} visible
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-provider fields — each one below maps to the Zod schema
// ─────────────────────────────────────────────────────────────────────────────

function ProviderFields({ def }: { def: ProviderDef }) {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useAlloyStore();
  const base = `providers.${def.id}`;

  const commonSecret = (field: string) => {
    const dotted = `${base}.${field}`;
    const { set, updated_at } = isSecretSet(effective, dotted);
    return (
      <SecretInput
        isSet={set}
        updatedAt={updated_at}
        onChange={(next) => updateSettingsPath(dotted, next)}
        onClear={() => updateSettingsPath(dotted, "")}
        placeholder={`${def.label} API key`}
        name={dotted}
      />
    );
  };

  const strField = (field: string, hint?: string, placeholder?: string) => {
    const dotted = `${base}.${field}`;
    const v = getAtPath<string>(effective, dotted, "");
    return (
      <Field label={humanize(field)} hint={hint}>
        <Input
          value={v ?? ""}
          onChange={(e) => updateSettingsPath(dotted, e.target.value)}
          placeholder={placeholder}
        />
      </Field>
    );
  };

  const numField = (field: string, hint?: string) => {
    const dotted = `${base}.${field}`;
    const v = getAtPath<number>(effective, dotted, 0);
    return (
      <Field label={humanize(field)} hint={hint}>
        <Input
          type="number"
          value={Number.isFinite(v) ? String(v) : ""}
          onChange={(e) =>
            updateSettingsPath(dotted, e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </Field>
    );
  };

  switch (def.id) {
    case "ollama":
      return (
        <>
          <Row label="Base URL" hint="Local Ollama server — usually 127.0.0.1:11434.">
            {strField("base_url", undefined, "http://127.0.0.1:11434")}
          </Row>
          <Row label="Default model" hint='Example: "qwen2.5:7b", "llama3.2:3b".'>
            {strField("default_model", undefined, "qwen2.5:7b")}
          </Row>
          <Row label="Timeout (seconds)" hint="How long to wait for a single response.">
            {numField("timeout_s")}
          </Row>
        </>
      );

    case "openrouter":
      return (
        <>
          <Row label="API key" hint="Never sent to clients in plaintext — encrypted at rest.">
            {commonSecret("api_key")}
          </Row>
          <Row label="Default model" hint='e.g. "anthropic/claude-3.5-sonnet".'>
            {strField("default_model")}
          </Row>
          <Row
            label="HTTP Referer"
            hint="Optional. Some model providers rank-list based on this."
          >
            {strField("http_referer", undefined, "https://your-app.example.com")}
          </Row>
        </>
      );

    case "anthropic":
      return (
        <>
          <Row label="API key">{commonSecret("api_key")}</Row>
          <Row label="Default model" hint='e.g. "claude-sonnet-4-5".'>
            {strField("default_model")}
          </Row>
        </>
      );

    case "openai":
      return (
        <>
          <Row label="API key">{commonSecret("api_key")}</Row>
          <Row label="Base URL" hint="Defaults to OpenAI; change for proxies or Together.ai.">
            {strField("base_url", undefined, "https://api.openai.com/v1")}
          </Row>
          <Row label="Default model">{strField("default_model")}</Row>
          <Row label="Organization ID" hint="Optional — only needed if your key spans orgs.">
            {strField("organization_id")}
          </Row>
        </>
      );

    case "google":
      return (
        <>
          <Row
            label="Authentication"
            hint="Google uses OAuth. Connect a Google account under Accounts; tokens live in the accounts service."
          >
            <Badge tone="accent">OAuth only</Badge>
          </Row>
          <Row label="Default model">{strField("default_model")}</Row>
        </>
      );

    case "lmstudio":
      return (
        <>
          <Row label="Base URL" hint="LM Studio's OpenAI-compatible endpoint.">
            {strField("base_url", undefined, "http://127.0.0.1:1234/v1")}
          </Row>
          <Row label="Default model">{strField("default_model")}</Row>
        </>
      );

    case "azure":
      return (
        <>
          <Row label="Endpoint" hint="e.g. https://your-resource.openai.azure.com.">
            {strField("endpoint")}
          </Row>
          <Row label="API key">{commonSecret("api_key")}</Row>
          <Row label="API version">{strField("api_version", undefined, "2024-10-21")}</Row>
          <Row label="Deployment" hint="Your Azure deployment name.">
            {strField("deployment")}
          </Row>
        </>
      );
    default:
      return null;
  }
}

function humanize(field: string): string {
  return field
    .split("_")
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(" ");
}
