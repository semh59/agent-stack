/**
 * Tests for custom error classes.
 */
import { describe, it, expect } from "vitest";
import { EmptyResponseError, ToolIdMismatchError } from "./errors";

// â”€â”€ EmptyResponseError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("EmptyResponseError", () => {
  it("should store provider, model, and attempts", () => {
    const err = new EmptyResponseError("google", "gemini-2.5-pro", 3);
    expect(err.provider).toBe("google");
    expect(err.model).toBe("gemini-2.5-pro");
    expect(err.attempts).toBe(3);
  });

  it("should use default message when none provided", () => {
    const err = new EmptyResponseError("google", "gemini-2.5-pro", 1);
    expect(err.message).toBeTruthy();
  });

  it("should use custom message when provided", () => {
    const err = new EmptyResponseError("google", "gemini-2.5-pro", 1, "Custom error msg");
    expect(err.message).toBe("Custom error msg");
  });

  it("should be an instance of Error", () => {
    const err = new EmptyResponseError("google", "gemini-2.5-pro", 1);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EmptyResponseError);
  });

  it("should have correct name", () => {
    const err = new EmptyResponseError("google", "gemini-2.5-pro", 1);
    expect(err.name).toBe("EmptyResponseError");
  });
});

// â”€â”€ ToolIdMismatchError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ToolIdMismatchError", () => {
  it("should store expected and found IDs", () => {
    const err = new ToolIdMismatchError(["id1", "id2"], ["id3"]);
    expect(err.expectedIds).toEqual(["id1", "id2"]);
    expect(err.foundIds).toEqual(["id3"]);
  });

  it("should use default message when none provided", () => {
    const err = new ToolIdMismatchError(["a"], ["b"]);
    expect(err.message).toBeTruthy();
  });

  it("should use custom message when provided", () => {
    const err = new ToolIdMismatchError(["a"], ["b"], "Mismatch!");
    expect(err.message).toBe("Mismatch!");
  });

  it("should be an instance of Error", () => {
    const err = new ToolIdMismatchError(["a"], []);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ToolIdMismatchError);
  });

  it("should have correct name", () => {
    const err = new ToolIdMismatchError(["a"], []);
    expect(err.name).toBe("ToolIdMismatchError");
  });
});
