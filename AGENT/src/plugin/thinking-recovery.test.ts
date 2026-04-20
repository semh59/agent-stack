/**
 * Tests for thinking block recovery module.
 * Covers: conversation state analysis, tool loop detection, turn closure,
 * compacted thinking detection, recovery triggers.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
  looksLikeCompactedThinkingTurn,
  hasPossibleCompactedThinking,
} from "./thinking-recovery";
import type { ConversationState } from "./thinking-recovery";

// â”€â”€ Test Helpers (Gemini format: model/user with parts[]) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function userMsg(text: string) {
  return {
    role: "user",
    parts: [{ text }],
  };
}

function userToolResultMsg(toolName: string, response: string) {
  return {
    role: "user",
    parts: [{ functionResponse: { name: toolName, response: { content: response } } }],
  };
}

function modelMsg(parts: unknown[]) {
  return {
    role: "model",
    parts,
  };
}

function thinkingPart(text: string) {
  return { thought: true, text };
}

function textPart(text: string) {
  return { text };
}

function functionCallPart(name: string, args: Record<string, unknown> = {}) {
  return { functionCall: { name, args } };
}

// â”€â”€ analyzeConversationState â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("analyzeConversationState", () => {
  it("should detect empty conversation", () => {
    const state = analyzeConversationState([]);
    expect(state.inToolLoop).toBe(false);
    expect(state.turnStartIdx).toBe(-1);
    expect(state.lastModelHasThinking).toBe(false);
    expect(state.lastModelHasToolCalls).toBe(false);
  });

  it("should detect simple conversation without tool loop", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([textPart("hi there")]),
    ];
    const state = analyzeConversationState(contents);
    expect(state.inToolLoop).toBe(false);
    expect(state.lastModelHasThinking).toBe(false);
    expect(state.lastModelHasToolCalls).toBe(false);
  });

  it("should detect thinking in last model message", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([thinkingPart("hmm..."), textPart("hi")]),
    ];
    const state = analyzeConversationState(contents);
    expect(state.lastModelHasThinking).toBe(true);
  });

  it("should detect tool calls in last model message", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([functionCallPart("test_tool")]),
    ];
    const state = analyzeConversationState(contents);
    expect(state.lastModelHasToolCalls).toBe(true);
  });

  it("should detect tool loop (model functionCall â†’ user functionResponse)", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([functionCallPart("tool_1")]),
      userToolResultMsg("tool_1", "ok"),
      modelMsg([functionCallPart("tool_2")]),
      userToolResultMsg("tool_2", "ok"),
    ];
    const state = analyzeConversationState(contents);
    expect(state.inToolLoop).toBe(true);
  });

  it("should detect tool loop with thinking in between", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([thinkingPart("planning..."), functionCallPart("tool_1")]),
      userToolResultMsg("tool_1", "ok"),
      modelMsg([thinkingPart("analyzing..."), functionCallPart("tool_2")]),
      userToolResultMsg("tool_2", "ok"),
    ];
    const state = analyzeConversationState(contents);
    expect(state.inToolLoop).toBe(true);
    expect(state.turnHasThinking).toBe(true);
  });

  it("should calculate correct turn start index", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([textPart("hi")]),
      userMsg("do more"),
      modelMsg([functionCallPart("t1")]),
    ];
    const state = analyzeConversationState(contents);
    // Turn starts at model message after last real user message ("do more" at idx 2)
    expect(state.turnStartIdx).toBe(3);
  });

  it("should not be in tool loop when last message is a real user message", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([functionCallPart("tool_1")]),
      userToolResultMsg("tool_1", "ok"),
      modelMsg([textPart("done")]),
      userMsg("thanks"),
    ];
    const state = analyzeConversationState(contents);
    expect(state.inToolLoop).toBe(false);
  });

  it("should not be in tool loop when last message is model", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([functionCallPart("tool_1")]),
      userToolResultMsg("tool_1", "ok"),
      modelMsg([textPart("all done")]),
    ];
    const state = analyzeConversationState(contents);
    expect(state.inToolLoop).toBe(false);
  });
});

// â”€â”€ needsThinkingRecovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("needsThinkingRecovery", () => {
  it("should not trigger for normal conversation", () => {
    const state: ConversationState = {
      inToolLoop: false,
      turnStartIdx: -1,
      turnHasThinking: false,
      lastModelIdx: 1,
      lastModelHasThinking: false,
      lastModelHasToolCalls: false,
    };
    expect(needsThinkingRecovery(state)).toBe(false);
  });

  it("should not trigger when in tool loop AND turn has thinking", () => {
    const state: ConversationState = {
      inToolLoop: true,
      turnStartIdx: 1,
      turnHasThinking: true,
      lastModelIdx: 3,
      lastModelHasThinking: true,
      lastModelHasToolCalls: true,
    };
    expect(needsThinkingRecovery(state)).toBe(false);
  });

  it("should trigger when in tool loop WITHOUT thinking", () => {
    const state: ConversationState = {
      inToolLoop: true,
      turnStartIdx: 1,
      turnHasThinking: false,
      lastModelIdx: 3,
      lastModelHasThinking: false,
      lastModelHasToolCalls: true,
    };
    expect(needsThinkingRecovery(state)).toBe(true);
  });
});

// â”€â”€ closeToolLoopForThinking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("closeToolLoopForThinking", () => {
  it("should add synthetic messages to close a tool loop", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([functionCallPart("tool_1")]),
      userToolResultMsg("tool_1", "ok"),
      modelMsg([functionCallPart("tool_2")]),
    ];

    const result = closeToolLoopForThinking(contents);
    // Should have original (4) + synthetic model + synthetic user = 6
    expect(result.length).toBe(contents.length + 2);
    // Last message should be user with resume text
    const lastMsg = result[result.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.parts[0].text).toBeTruthy();
    // Second to last should be synthetic model
    const synthModel = result[result.length - 2];
    expect(synthModel.role).toBe("model");
  });

  it("should add synthetic messages even without tool calls", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([textPart("hi")]),
    ];

    const result = closeToolLoopForThinking(contents);
    // Always strips thinking and adds 2 synthetic messages
    expect(result.length).toBe(contents.length + 2);
  });

  it("should strip thinking blocks from messages", () => {
    const contents = [
      userMsg("do something"),
      modelMsg([thinkingPart("hmm"), functionCallPart("tool_1")]),
      userToolResultMsg("tool_1", "ok"),
      modelMsg([thinkingPart("bad thinking"), functionCallPart("tool_2")]),
    ];

    const result = closeToolLoopForThinking(contents);
    // No thinking parts should remain in original messages
    for (const msg of result) {
      if (msg.role === "model" && Array.isArray(msg.parts)) {
        const hasThinking = msg.parts.some(
          (p: Record<string, unknown>) => p.thought === true || p.type === "thinking"
        );
        // Synthetic messages have only text, originals should have thinking stripped
        if (msg.parts.some((p: Record<string, unknown>) => p.functionCall)) {
          expect(hasThinking).toBe(false);
        }
      }
    }
  });

  it("should include single tool result message in synthetic model text", () => {
    // countTrailingToolResults stops at model messages â€” only 1 trailing result
    const contents = [
      userMsg("do something"),
      modelMsg([functionCallPart("tool_1")]),
      userToolResultMsg("tool_1", "ok"),
      modelMsg([functionCallPart("tool_2")]),
      userToolResultMsg("tool_2", "ok"),
    ];

    const result = closeToolLoopForThinking(contents);
    const synthModel = result[result.length - 2];
    const text = synthModel.parts[0].text as string;
    // Only the last userToolResultMsg counts (stops at model boundary)
    expect(text).toContain("Tool execution completed");
  });

  it("should include multiple tool results in synthetic model text", () => {
    // Two trailing functionResponse parts in same user message
    const contents = [
      userMsg("do something"),
      modelMsg([functionCallPart("tool_1"), functionCallPart("tool_2")]),
      {
        role: "user",
        parts: [
          { functionResponse: { name: "tool_1", response: { content: "ok" } } },
          { functionResponse: { name: "tool_2", response: { content: "ok" } } },
        ],
      },
    ];

    const result = closeToolLoopForThinking(contents);
    const synthModel = result[result.length - 2];
    const text = synthModel.parts[0].text as string;
    expect(text).toContain("2 tool executions completed");
  });
});

// â”€â”€ looksLikeCompactedThinkingTurn â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("looksLikeCompactedThinkingTurn", () => {
  it("should detect compacted thinking: functionCall without thinking or text", () => {
    const msg = modelMsg([functionCallPart("tool_1")]);
    // No thinking, no text before functionCall â†’ looks compacted
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(true);
  });

  it("should not flag messages with thinking as compacted", () => {
    const msg = modelMsg([
      thinkingPart("I need to use a tool"),
      functionCallPart("tool_1"),
    ]);
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false);
  });

  it("should not flag simple text messages", () => {
    const msg = modelMsg([textPart("just a response")]);
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false);
  });

  it("should not flag messages with text before functionCall", () => {
    const msg = modelMsg([
      textPart("Let me check that for you."),
      functionCallPart("tool_1"),
    ]);
    expect(looksLikeCompactedThinkingTurn(msg)).toBe(false);
  });

  it("should handle null/undefined gracefully", () => {
    expect(looksLikeCompactedThinkingTurn(null)).toBe(false);
    expect(looksLikeCompactedThinkingTurn(undefined)).toBe(false);
    expect(looksLikeCompactedThinkingTurn({})).toBe(false);
    expect(looksLikeCompactedThinkingTurn({ parts: [] })).toBe(false);
  });
});

// â”€â”€ hasPossibleCompactedThinking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("hasPossibleCompactedThinking", () => {
  it("should return false for empty conversation", () => {
    expect(hasPossibleCompactedThinking([], 0)).toBe(false);
  });

  it("should return false for negative turn start", () => {
    expect(hasPossibleCompactedThinking([{ role: "model", parts: [] }], -1)).toBe(false);
  });

  it("should detect compacted model message in turn", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([functionCallPart("tool_1")]), // No thinking, no text â†’ compacted
    ];
    expect(hasPossibleCompactedThinking(contents, 1)).toBe(true);
  });

  it("should return false when thinking is present", () => {
    const contents = [
      userMsg("hello"),
      modelMsg([thinkingPart("hmm"), functionCallPart("tool_1")]),
    ];
    expect(hasPossibleCompactedThinking(contents, 1)).toBe(false);
  });

  it("should skip non-model messages", () => {
    const contents = [
      userMsg("hello"),
      userMsg("world"), // Not a model message, skip
    ];
    expect(hasPossibleCompactedThinking(contents, 1)).toBe(false);
  });
});
