/**
 * Tests for session recovery module.
 * Covers: error detection, toast content, recoverable error classification.
 */
import { describe, it, expect } from "vitest";
import {
  detectErrorType,
  isRecoverableError,
  getRecoveryToastContent,
  getRecoverySuccessToast,
  getRecoveryFailureToast,
} from "./recovery";

// ── detectErrorType ──────────────────────────────────────────────────

describe("detectErrorType", () => {
  it("should detect tool_result_missing error", () => {
    const error = {
      message: "tool_use ids were found without corresponding tool_result blocks: toolu_abc123",
    };
    const result = detectErrorType(error);
    expect(result).toBe("tool_result_missing");
  });

  it("should detect thinking_block_order error", () => {
    const error = {
      message: "Expected thinking but found text",
    };
    const result = detectErrorType(error);
    expect(result).toBe("thinking_block_order");
  });

  it("should detect thinking_disabled_violation error", () => {
    // Pattern: "thinking is disabled" AND "cannot contain"
    const error = {
      message: "thinking is disabled and cannot contain thinking blocks",
    };
    const result = detectErrorType(error);
    expect(result).toBe("thinking_disabled_violation");
  });

  it("should return null for non-recoverable errors", () => {
    expect(detectErrorType(new Error("rate limit exceeded"))).toBeNull();
    expect(detectErrorType(new Error("internal server error"))).toBeNull();
  });

  it("should return null for null/undefined", () => {
    expect(detectErrorType(null)).toBeNull();
    expect(detectErrorType(undefined)).toBeNull();
  });

  it("should handle string errors", () => {
    expect(detectErrorType("some string error")).toBeNull();
  });

  it("should handle error objects with message", () => {
    const err = new Error("something went wrong");
    expect(detectErrorType(err)).toBeNull();
  });
});

// ── isRecoverableError ───────────────────────────────────────────────

describe("isRecoverableError", () => {
  it("should return true for tool_result_missing", () => {
    const error = { message: "tool_use ids were found without corresponding tool_result blocks" };
    expect(isRecoverableError(error)).toBe(true);
  });

  it("should return true for thinking_block_order", () => {
    const error = { message: "Expected thinking but found text" };
    expect(isRecoverableError(error)).toBe(true);
  });

  it("should return false for generic errors", () => {
    expect(isRecoverableError(new Error("timeout"))).toBe(false);
    expect(isRecoverableError(null)).toBe(false);
    expect(isRecoverableError(undefined)).toBe(false);
  });
});

// ── getRecoveryToastContent ──────────────────────────────────────────

describe("getRecoveryToastContent", () => {
  it("should return toast for tool_result_missing", () => {
    const toast = getRecoveryToastContent("tool_result_missing");
    expect(toast.title).toBeTruthy();
    expect(toast.message).toBeTruthy();
  });

  it("should return toast for thinking_block_order", () => {
    const toast = getRecoveryToastContent("thinking_block_order");
    expect(toast.title).toBeTruthy();
    expect(toast.message).toBeTruthy();
  });

  it("should return toast for thinking_disabled_violation", () => {
    const toast = getRecoveryToastContent("thinking_disabled_violation");
    expect(toast.title).toBeTruthy();
    expect(toast.message).toBeTruthy();
  });
});

// ── getRecoverySuccessToast ──────────────────────────────────────────

describe("getRecoverySuccessToast", () => {
  it("should return success toast with title and message", () => {
    const toast = getRecoverySuccessToast();
    expect(toast.title).toBeTruthy();
    expect(toast.message).toBeTruthy();
  });
});

// ── getRecoveryFailureToast ──────────────────────────────────────────

describe("getRecoveryFailureToast", () => {
  it("should return failure toast with title and message", () => {
    const toast = getRecoveryFailureToast();
    expect(toast.title).toBeTruthy();
    expect(toast.message).toBeTruthy();
  });
});