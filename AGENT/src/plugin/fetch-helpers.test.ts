/**
 * Tests for fetch helper utilities.
 * Covers: URL parsing, model extraction, header style detection, quota fallback.
 */
import { describe, it, expect } from "vitest";
import {
  toUrlString,
  extractModelFromUrl,
  getModelFamilyFromUrl,
  getHeaderStyleFromUrl,
  isExplicitQuotaFromUrl,
} from "./fetch-helpers";

// â”€â”€ toUrlString â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("toUrlString", () => {
  it("should return string input unchanged", () => {
    expect(toUrlString("https://example.com/api")).toBe("https://example.com/api");
  });

  it("should extract URL from Request object", () => {
    const req = new Request("https://example.com/api");
    expect(toUrlString(req)).toBe("https://example.com/api");
  });
});

// â”€â”€ extractModelFromUrl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("extractModelFromUrl", () => {
  it("should extract model from generativelanguage URL", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
    expect(extractModelFromUrl(url)).toBe("gemini-2.5-pro");
  });

  it("should extract model from alternate URL format", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent";
    expect(extractModelFromUrl(url)).toBe("gemini-2.5-flash");
  });

  it("should return null for URL without model", () => {
    const url = "https://example.com/api";
    expect(extractModelFromUrl(url)).toBeNull();
  });

  it("should handle empty string", () => {
    expect(extractModelFromUrl("")).toBeNull();
  });
});

// â”€â”€ getModelFamilyFromUrl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("getModelFamilyFromUrl", () => {
  it("should detect gemini family from generativelanguage URL", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
    expect(getModelFamilyFromUrl(url)).toBe("gemini");
  });

  it("should detect claude family from model name", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/claude-3-5-sonnet:generateContent";
    expect(getModelFamilyFromUrl(url)).toBe("claude");
  });
});

// â”€â”€ getHeaderStyleFromUrl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("getHeaderStyleFromUrl", () => {
  it("should return Sovereign style for gemini family by default", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
    const style = getHeaderStyleFromUrl(url, "gemini");
    expect(style).toBe("Sovereign");
  });

  it("should handle different family/style combinations", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/claude-3-5-sonnet:generateContent";
    const style = getHeaderStyleFromUrl(url, "claude");
    expect(typeof style).toBe("string");
  });
});

// â”€â”€ isExplicitQuotaFromUrl â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("isExplicitQuotaFromUrl", () => {
  it("should return false for URL without model (no extractable model)", () => {
    expect(isExplicitQuotaFromUrl("https://example.com/api")).toBe(false);
  });

  it("should return boolean for valid model URL", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";
    // Result depends on resolveModelWithTier lookup
    expect(typeof isExplicitQuotaFromUrl(url)).toBe("boolean");
  });
});
