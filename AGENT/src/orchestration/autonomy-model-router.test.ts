import { describe, expect, it } from "vitest";
import { SmartMultiModelRouter } from "./autonomy-model-router";

describe("SmartMultiModelRouter", () => {
  it("uses anchor model on initial decision", () => {
    const router = new SmartMultiModelRouter();
    const decision = router.decide({
      taskType: "analysis",
      anchorModel: "google/antigravity-gemini-3-pro-high",
      policy: "smart_multi",
      previousModel: null,
      reasonCode: "INITIAL",
    });

    expect(decision.selectedModel).toBe("gemini-3-pro-high");
    expect(decision.reasonCode).toBe("INITIAL");
    expect(decision.switched).toBe(false);
  });

  it("rotates to fallback model on rate limit", () => {
    const router = new SmartMultiModelRouter();
    const decision = router.decide({
      taskType: "implementation",
      anchorModel: "gemini-3-pro-high",
      policy: "smart_multi",
      previousModel: "gemini-3-pro-high",
      reasonCode: "RATE_LIMIT",
    });

    expect(decision.reasonCode).toBe("RATE_LIMIT");
    expect(decision.selectedModel).not.toBe("gemini-3-pro-high");
    expect(decision.switched).toBe(true);
  });

  it("rotates to fallback model on budget exceeded", () => {
    const router = new SmartMultiModelRouter();
    const decision = router.decide({
      taskType: "implementation",
      anchorModel: "gemini-3-pro-high",
      policy: "smart_multi",
      previousModel: "gemini-3-pro-high",
      reasonCode: "BUDGET_EXCEEDED",
    });

    expect(decision.reasonCode).toBe("BUDGET_EXCEEDED");
    expect(decision.selectedModel).not.toBe("gemini-3-pro-high");
    expect(decision.switched).toBe(true);
  });

  it("returns to anchor when recovery flag is enabled", () => {
    const router = new SmartMultiModelRouter();
    const decision = router.decide({
      taskType: "verification",
      anchorModel: "gemini-3-pro-high",
      policy: "smart_multi",
      previousModel: "claude-sonnet-4-6-thinking",
      reasonCode: "ROUTER_POLICY",
      recoverToAnchor: true,
    });

    expect(decision.selectedModel).toBe("gemini-3-pro-high");
    expect(decision.reasonCode).toBe("ROUTER_POLICY");
  });

  it("forces anchor continuity when context pack is very large", () => {
    const router = new SmartMultiModelRouter();
    const decision = router.decide({
      taskType: "implementation",
      anchorModel: "gemini-3-pro-high",
      policy: "smart_multi",
      previousModel: "claude-sonnet-4-6-thinking",
      reasonCode: "ROUTER_POLICY",
      contextPack: "x".repeat(10_000),
    });

    expect(decision.selectedModel).toBe("gemini-3-pro-high");
  });
});
