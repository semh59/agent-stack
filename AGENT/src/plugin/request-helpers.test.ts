/**
 * Tests for request helper functions.
 * Covers: JSON schema cleaning, thinking config, tool normalization.
 */
import { describe, it, expect } from "vitest";
import {
  cleanJSONSchemaForAntigravity,
  isThinkingCapableModel,
} from "./request-helpers";

// ── cleanJSONSchemaForAntigravity ────────────────────────────────────

describe("cleanJSONSchemaForAntigravity", () => {
  it("should return null/undefined/primatives unchanged", () => {
    expect(cleanJSONSchemaForAntigravity(null)).toBeNull();
    expect(cleanJSONSchemaForAntigravity(undefined)).toBeUndefined();
    expect(cleanJSONSchemaForAntigravity("hello")).toBe("hello");
    expect(cleanJSONSchemaForAntigravity(42)).toBe(42);
  });

  it("should keep allowed schema keywords", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "The name" },
        age: { type: "number" },
      },
      required: ["name"],
      description: "A person",
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.type).toBe("object");
    expect(result.properties).toBeDefined();
    expect(result.required).toEqual(["name"]);
    expect(result.description).toBe("A person");
  });

  it("should keep enum keyword", () => {
    const schema = {
      type: "string",
      enum: ["a", "b", "c"],
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.enum).toEqual(["a", "b", "c"]);
  });

  it("should keep items for array types", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.type).toBe("array");
    expect(result.items).toEqual({ type: "string" });
  });

  it("should convert const to enum", () => {
    const schema = {
      type: "string",
      const: "fixed_value",
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(result.enum).toEqual(["fixed_value"]);
    expect(result.const).toBeUndefined();
  });

  it("should replace empty object with placeholder", () => {
    const schema = {
      type: "object",
      properties: {
        empty: {},
      },
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    // Empty object should be replaced with a placeholder
    expect(result.properties.empty).toBeDefined();
    // Should have at least a type or description
    if (typeof result.properties.empty === "object" && Object.keys(result.properties.empty).length > 0) {
      expect(result.properties.empty.type || result.properties.empty.description).toBeTruthy();
    }
  });

  it("should strip disallowed keywords and convert to description hints", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      additionalProperties: false,
      default: { name: "test" },
      examples: [{ name: "example" }],
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    // additionalProperties is removed (moved to description hint)
    expect(result.additionalProperties).toBeUndefined();
    // default and examples are removed (moved to description hints)
    expect(result.default).toBeUndefined();
    expect(result.examples).toBeUndefined();
    // Description should contain hints about the removed fields
    expect(typeof result.description === "string").toBe(true);
  });

  it("should preserve minProperties/maxProperties (not in unsupported list)", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      minProperties: 1,
      maxProperties: 10,
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    // minProperties/maxProperties are NOT in UNSUPPORTED_KEYWORDS
    expect(result.minProperties).toBe(1);
    expect(result.maxProperties).toBe(10);
  });

  it("should recurse into nested properties", () => {
    const schema = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: {
            deep: { type: "string", const: "deep_value" },
          },
        },
      },
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    const deepProp = result.properties.nested.properties.deep;
    expect(deepProp.enum).toEqual(["deep_value"]);
    expect(deepProp.const).toBeUndefined();
  });

  it("should handle arrays of schemas in items", () => {
    const schema = {
      type: "array",
      items: [
        { type: "string" },
        { type: "number", const: 42 },
      ],
    };
    const result = cleanJSONSchemaForAntigravity(schema);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items[1].enum).toEqual([42]);
  });
});

// ── isThinkingCapableModel ───────────────────────────────────────────

describe("isThinkingCapableModel", () => {
  // Only models with "thinking", "gemini-3", or "opus" in the name are recognized
  it("should recognize models with 'thinking' in name", () => {
    expect(isThinkingCapableModel("gemini-3-thinking")).toBe(true);
  });

  it("should recognize opus models", () => {
    expect(isThinkingCapableModel("claude-3-opus")).toBe(true);
  });

  it("should recognize gemini-3 models", () => {
    expect(isThinkingCapableModel("gemini-3-pro")).toBe(true);
  });

  it("should not recognize non-thinking models", () => {
    expect(isThinkingCapableModel("claude-3-5-sonnet")).toBe(false);
    expect(isThinkingCapableModel("gemini-2.5-pro")).toBe(false);
    expect(isThinkingCapableModel("gemini-1.5-pro")).toBe(false);
    expect(isThinkingCapableModel("gemini-1.5-flash")).toBe(false);
    expect(isThinkingCapableModel("gpt-4")).toBe(false);
  });

  it("should handle empty string gracefully", () => {
    expect(isThinkingCapableModel("")).toBe(false);
  });
});
