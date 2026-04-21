import { describe, it, expect } from "vitest";
import { settingsSchema, defaultSettings } from "./schema";

describe("Settings Schema", () => {
  it("generates valid default settings via defaultSettings()", () => {
    const defaults = defaultSettings();
    expect(defaults.appearance.theme).toBe("dark");
    expect(defaults.providers.ollama.enabled).toBe(true);
    expect(defaults.routing.roles.chat).toBeDefined();
  });

  it("hydrates nested objects correctly from partial input", () => {
    const partial = {
      appearance: { theme: "light" },
      providers: { anthropic: { api_key: "sk-test" } }
    };
    const parsed = settingsSchema.parse(partial);
    
    // Check hydrated fields
    expect(parsed.appearance.theme).toBe("light");
    expect(parsed.providers.anthropic.api_key).toBe("sk-test");
    
    // Check defaults preserved for other fields
    expect(parsed.providers.ollama.enabled).toBe(true);
    expect(parsed.routing.roles.chat).toBeDefined();
    expect(parsed.mcp.servers).toEqual([]);
  });

  it("rejects invalid values with ZodError", () => {
    const invalid = {
      routing: {
        timeout_s: -1 // Must be positive
      }
    };
    expect(() => settingsSchema.parse(invalid)).toThrow();
  });

  it("authorizes redacted secret placeholders", () => {
    const roundtrip = {
      providers: {
        anthropic: { api_key: { set: true } }
      }
    };
    const parsed = settingsSchema.parse(roundtrip);
    expect(parsed.providers.anthropic.api_key).toEqual({ set: true });
  });
});
