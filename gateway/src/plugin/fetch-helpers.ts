/**
 * Fetch-related helper functions extracted from plugin.ts monolith.
 * URL parsing, model detection, header style resolution.
 */
import type { HeaderStyle } from "../constants";
import type { ModelFamily } from "./accounts";
import type { AlloyGatewayConfig } from "./config";
import { resolveModelWithTier } from "./transform/model-resolver";
import { isDebugEnabled, logModelFamily } from "./debug";

export function toUrlString(value: RequestInfo): string {
  if (typeof value === "string") {
    return value;
  }
  const candidate = (value as Request).url;
  if (candidate) {
    return candidate;
  }
  return value.toString();
}

export function toWarmupStreamUrl(value: RequestInfo): string {
  const urlString = toUrlString(value);
  try {
    const url = new URL(urlString);
    if (!url.pathname.includes(":streamGenerateContent")) {
      url.pathname = url.pathname.replace(":generateContent", ":streamGenerateContent");
    }
    url.searchParams.set("alt", "sse");
    return url.toString();
  } catch {
    return urlString;
  }
}

export function extractModelFromUrl(urlString: string): string | null {
  const match = urlString.match(/\/models\/([^:\/?]+)(?::\w+)?/);
  return match?.[1] ?? null;
}

export function extractModelFromUrlWithSuffix(urlString: string): string | null {
  const match = urlString.match(/\/models\/([^:\/\?]+)/);
  return match?.[1] ?? null;
}

export function getModelFamilyFromUrl(urlString: string): ModelFamily {
  const model = extractModelFromUrl(urlString);
  let family: ModelFamily = "gemini";
  if (model && model.includes("claude")) {
    family = "claude";
  }
  if (isDebugEnabled()) {
    logModelFamily(urlString, model, family);
  }
  return family;
}

export function resolveQuotaFallbackHeaderStyle(input: {
  quotaFallback: boolean;
  cliFirst: boolean;
  explicitQuota: boolean;
  family: ModelFamily;
  headerStyle: HeaderStyle;
  alternateStyle: HeaderStyle | null;
}): HeaderStyle | null {
  if (!input.quotaFallback || input.explicitQuota || input.family !== "gemini") {
    return null;
  }
  if (!input.alternateStyle || input.alternateStyle === input.headerStyle) {
    return null;
  }
  if (input.cliFirst && input.headerStyle !== "gemini-cli") {
    return null;
  }
  return input.alternateStyle;
}

export function getCliFirst(config: AlloyGatewayConfig): boolean {
  return (config as AlloyGatewayConfig & { cli_first?: boolean }).cli_first ?? false;
}

export function getHeaderStyleFromUrl(urlString: string, family: ModelFamily): HeaderStyle {
  if (family === "claude") {
    return "Alloy";
  }
  const modelWithSuffix = extractModelFromUrlWithSuffix(urlString);
  if (!modelWithSuffix) {
    return "Alloy";
  }
  const { quotaPreference } = resolveModelWithTier(modelWithSuffix);
  return quotaPreference === "gemini-cli" ? "Alloy" : (quotaPreference ?? "Alloy");
}

export function isExplicitQuotaFromUrl(urlString: string): boolean {
  const modelWithSuffix = extractModelFromUrlWithSuffix(urlString);
  if (!modelWithSuffix) {
    return false;
  }
  const { explicitQuota } = resolveModelWithTier(modelWithSuffix);
  return explicitQuota ?? false;
}
