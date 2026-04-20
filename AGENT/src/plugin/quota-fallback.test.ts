import { beforeAll, describe, expect, it, vi } from "vitest";
import type { HeaderStyle, ModelFamily } from "./accounts";

type ResolveQuotaFallbackHeaderStyle = (input: {
  quotaFallback: boolean;
  cliFirst: boolean;
  explicitQuota: boolean;
  family: ModelFamily;
  headerStyle: HeaderStyle;
  alternateStyle: HeaderStyle | null;
}) => HeaderStyle | null;

let resolveQuotaFallbackHeaderStyle: ResolveQuotaFallbackHeaderStyle | undefined;

beforeAll(async () => {
  vi.mock("@opencode-ai/plugin", () => ({
    tool: vi.fn(),
  }));

  const { __testExports } = await import("../plugin");
  resolveQuotaFallbackHeaderStyle = (__testExports as {
    resolveQuotaFallbackHeaderStyle?: ResolveQuotaFallbackHeaderStyle;
  }).resolveQuotaFallbackHeaderStyle;
});

describe("quota fallback direction", () => {
  it("falls back from gemini-cli to Sovereign when cli_first is enabled", () => {
    const result = resolveQuotaFallbackHeaderStyle?.({
      quotaFallback: true,
      cliFirst: true,
      explicitQuota: false,
      family: "gemini",
      headerStyle: "gemini-cli",
      alternateStyle: "Sovereign",
    });

    expect(result).toBe("Sovereign");
  });

  it("does not fall back from Sovereign when cli_first is enabled", () => {
    const result = resolveQuotaFallbackHeaderStyle?.({
      quotaFallback: true,
      cliFirst: true,
      explicitQuota: false,
      family: "gemini",
      headerStyle: "Sovereign",
      alternateStyle: "gemini-cli",
    });

    expect(result).toBeNull();
  });

  it("falls back from Sovereign to gemini-cli when cli_first is disabled", () => {
    const result = resolveQuotaFallbackHeaderStyle?.({
      quotaFallback: true,
      cliFirst: false,
      explicitQuota: false,
      family: "gemini",
      headerStyle: "Sovereign",
      alternateStyle: "gemini-cli",
    });

    expect(result).toBe("gemini-cli");
  });
});
