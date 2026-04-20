/**
 * Smoke Tests â€” Sovereign AI Platform Phase 1+2
 *
 * Validates core module imports and basic functionality
 * without requiring network access or running services.
 */

import { describe, it, expect } from "vitest";

// â”€â”€â”€ Provider Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ProviderTypes", () => {
  it("should define both provider constants", async () => {
    const { AIProvider, GOOGLE_GEMINI_MODELS, CLAUDE_CODE_MODELS, getAllModels } =
      await import("../gateway/provider-types");

    expect(AIProvider.GOOGLE_GEMINI).toBe("google_gemini");
    expect(AIProvider.CLAUDE_CODE).toBe("claude_code");
    expect(GOOGLE_GEMINI_MODELS.length).toBeGreaterThan(0);
    expect(CLAUDE_CODE_MODELS.length).toBeGreaterThan(0);
    expect(getAllModels().length).toBe(
      GOOGLE_GEMINI_MODELS.length + CLAUDE_CODE_MODELS.length,
    );
  });

  it("should have correct model tiers", async () => {
    const { GOOGLE_GEMINI_MODELS, CLAUDE_CODE_MODELS } =
      await import("../gateway/provider-types");

    const tiers = new Set(
      [...GOOGLE_GEMINI_MODELS, ...CLAUDE_CODE_MODELS].map((m) => m.tier),
    );
    expect(tiers.has("fast")).toBe(true);
    expect(tiers.has("balanced")).toBe(true);
    expect(tiers.has("powerful")).toBe(true);
  });
});

// â”€â”€â”€ Claude Provider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ClaudeCodeProvider", () => {
  it("should default to api_key mode when no OAuth client is configured", async () => {
    const { ClaudeCodeProvider } = await import("../gateway/claude-provider");
    const provider = new ClaudeCodeProvider();
    expect(provider.getAuthMode()).toBe("api_key");
  });

  it("should generate auth URL in api_key mode", async () => {
    const { ClaudeCodeProvider } = await import("../gateway/claude-provider");
    const provider = new ClaudeCodeProvider("api_key");
    const { url, state } = await provider.getAuthUrl();
    expect(url).toContain("sovereign://auth/claude-code");
    expect(url).toContain("mode=api_key");
    expect(state).toBeTruthy();
    expect(state.length).toBe(64); // 32 bytes hex
  });

  it("should validate token correctly", async () => {
    const { ClaudeCodeProvider } = await import("../gateway/claude-provider");
    const { AIProvider, CLAUDE_CODE_MODELS } = await import("../gateway/provider-types");
    const provider = new ClaudeCodeProvider();

    // API key token (never expires)
    expect(
      provider.isTokenValid({
        provider: AIProvider.CLAUDE_CODE,
        accessToken: "sk-ant-test",
        refreshToken: "",
        expiresAt: 0,
        email: "test",
        createdAt: Date.now(),
        availableModels: CLAUDE_CODE_MODELS,
      }),
    ).toBe(true);

    // Expired OAuth token
    expect(
      provider.isTokenValid({
        provider: AIProvider.CLAUDE_CODE,
        accessToken: "expired",
        refreshToken: "refresh",
        expiresAt: Date.now() - 1000,
        email: "test",
        createdAt: Date.now(),
        availableModels: CLAUDE_CODE_MODELS,
      }),
    ).toBe(false);

    // Empty token
    expect(
      provider.isTokenValid({
        provider: AIProvider.CLAUDE_CODE,
        accessToken: "",
        refreshToken: "",
        expiresAt: 0,
        email: "test",
        createdAt: Date.now(),
        availableModels: CLAUDE_CODE_MODELS,
      }),
    ).toBe(false);
  });
});

// â”€â”€â”€ Model Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ModelRouter", () => {
  it("should route CEO agent to thinking/powerful tier", async () => {
    const { ModelRouter } = await import("../gateway/model-router");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const router = new ModelRouter();
    const ceoAgent = AGENTS.find((a) => a.role === "ceo")!;

    const decision = router.route({
      agent: ceoAgent,
      estimatedTokens: 2000,
      complexity: 7,
      activeProviders: [AIProvider.GOOGLE_GEMINI],
      providerHealth: new Map(),
    });

    expect(decision.useThinking).toBe(true);
    expect(["powerful", "ultimate"]).toContain(decision.tier);
    expect(decision.provider).toBe(AIProvider.GOOGLE_GEMINI);
  });

  it("should route DevOps agent to fast tier", async () => {
    const { ModelRouter } = await import("../gateway/model-router");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const router = new ModelRouter();
    const devopsAgent = AGENTS.find((a) => a.role === "devops")!;

    const decision = router.route({
      agent: devopsAgent,
      estimatedTokens: 500,
      complexity: 3,
      activeProviders: [AIProvider.GOOGLE_GEMINI],
      providerHealth: new Map(),
    });

    expect(decision.tier).toBe("fast");
    expect(decision.useThinking).toBe(false);
  });

  it("should prefer Google AG when budget is low", async () => {
    const { ModelRouter } = await import("../gateway/model-router");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const router = new ModelRouter();
    const backendAgent = AGENTS.find((a) => a.role === "backend")!;

    const decision = router.route({
      agent: backendAgent,
      estimatedTokens: 4000,
      complexity: 5,
      activeProviders: [AIProvider.GOOGLE_GEMINI, AIProvider.CLAUDE_CODE],
      providerHealth: new Map(),
      budgetRemaining: 500, // Very low budget
    });

    expect(decision.provider).toBe(AIProvider.GOOGLE_GEMINI);
  });

  it("should handle model override", async () => {
    const { ModelRouter } = await import("../gateway/model-router");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const router = new ModelRouter();
    const agent = AGENTS[0]!;

    const decision = router.route({
      agent,
      estimatedTokens: 1000,
      complexity: 3,
      activeProviders: [AIProvider.GOOGLE_GEMINI],
      providerHealth: new Map(),
      modelOverride: "claude-opus-4",
    });

    expect(decision.model.id).toBe("claude-opus-4");
    expect(decision.reasoning).toContain("Manual override");
  });
});

// â”€â”€â”€ Task Delegator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("TaskDelegator", () => {
  it("should list available groups", async () => {
    const { TaskDelegator } = await import("../gateway/task-delegator");
    const groups = TaskDelegator.getAvailableGroups();
    expect(groups.length).toBeGreaterThanOrEqual(6);
    expect(groups.find((g) => g.id === "plan")).toBeTruthy();
    expect(groups.find((g) => g.id === "code")).toBeTruthy();
  });

  it("should plan a single-group delegation", async () => {
    const { TaskDelegator, TaskGroup } = await import("../gateway/task-delegator");
    const delegator = new TaskDelegator();

    const plan = delegator.plan({
      task: "Build a REST API",
      groups: [TaskGroup.PLAN],
    });

    expect(plan.totalAgents).toBe(3); // CEO, PM, Architect
    expect(plan.stages.length).toBe(1);
    expect(plan.warnings.length).toBe(0);
    expect(plan.estimatedMinutes).toBeGreaterThan(0);
  });

  it("should plan multi-group with dependencies", async () => {
    const { TaskDelegator, TaskGroup } = await import("../gateway/task-delegator");
    const delegator = new TaskDelegator();

    const plan = delegator.plan({
      task: "Build a full app",
      groups: [TaskGroup.PLAN, TaskGroup.CODE],
    });

    expect(plan.totalAgents).toBe(7); // 3 plan + 4 code
    expect(plan.stages.length).toBe(2);
    // Plan should come before code due to dependency
    expect(plan.stages[0]!.group).toBe("plan");
    expect(plan.stages[1]!.group).toBe("code");
    expect(plan.dependencies.length).toBeGreaterThan(0);
  });

  it("should warn when dependencies are missing", async () => {
    const { TaskDelegator, TaskGroup } = await import("../gateway/task-delegator");
    const delegator = new TaskDelegator();

    const plan = delegator.plan({
      task: "Run tests",
      groups: [TaskGroup.TEST], // Without code group
    });

    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.warnings[0]).toContain("code");
  });

  it("should convert plan to pipeline options", async () => {
    const { TaskDelegator, TaskGroup } = await import("../gateway/task-delegator");
    const delegator = new TaskDelegator();

    const plan = delegator.plan({
      task: "Plan only",
      groups: [TaskGroup.PLAN],
    });

    const options = delegator.toPipelineOptions(plan, 0);
    expect(options.skipAgents.length).toBeGreaterThan(0);
    expect(options.startFromOrder).toBe(1); // CEO is order 1
  });
});

// â”€â”€â”€ Circuit Breaker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ProviderCircuitBreaker", () => {
  it("should start in closed state and allow requests", async () => {
    const { ProviderCircuitBreaker } = await import("../gateway/circuit-breaker");
    const { AIProvider } = await import("../gateway/provider-types");
    const cb = new ProviderCircuitBreaker();

    expect(cb.isAvailable(AIProvider.GOOGLE_GEMINI)).toBe(true);
    expect(cb.isAvailable(AIProvider.CLAUDE_CODE)).toBe(true);
  });

  it("should open after consecutive failures", async () => {
    const { ProviderCircuitBreaker } = await import("../gateway/circuit-breaker");
    const { AIProvider } = await import("../gateway/provider-types");
    const cb = new ProviderCircuitBreaker({ failureThreshold: 3 });

    cb.recordFailure(AIProvider.GOOGLE_GEMINI);
    cb.recordFailure(AIProvider.GOOGLE_GEMINI);
    expect(cb.isAvailable(AIProvider.GOOGLE_GEMINI)).toBe(true); // 2 < 3

    cb.recordFailure(AIProvider.GOOGLE_GEMINI);
    expect(cb.isAvailable(AIProvider.GOOGLE_GEMINI)).toBe(false); // 3 >= 3 â†’ OPEN

    // Other provider is unaffected
    expect(cb.isAvailable(AIProvider.CLAUDE_CODE)).toBe(true);
  });

  it("should recover through half-open state", async () => {
    const { ProviderCircuitBreaker } = await import("../gateway/circuit-breaker");
    const { AIProvider } = await import("../gateway/provider-types");
    const cb = new ProviderCircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 50, // 50ms for test speed
      halfOpenSuccessThreshold: 1,
    });

    cb.recordFailure(AIProvider.GOOGLE_GEMINI);
    cb.recordFailure(AIProvider.GOOGLE_GEMINI);
    expect(cb.isAvailable(AIProvider.GOOGLE_GEMINI)).toBe(false);

    // Wait for recovery timeout
    await new Promise((r) => setTimeout(r, 60));
    expect(cb.isAvailable(AIProvider.GOOGLE_GEMINI)).toBe(true); // half-open

    cb.recordSuccess(AIProvider.GOOGLE_GEMINI, 100);
    const stats = cb.getStats(AIProvider.GOOGLE_GEMINI);
    expect(stats.state).toBe("closed");
  });

  it("should execute with auto-fallback", async () => {
    const { ProviderCircuitBreaker } = await import("../gateway/circuit-breaker");
    const { AIProvider } = await import("../gateway/provider-types");
    const cb = new ProviderCircuitBreaker({ failureThreshold: 1 });

    // Break Google
    cb.recordFailure(AIProvider.GOOGLE_GEMINI);

    // Execute with fallback to Claude
    const result = await cb.execute(
      AIProvider.GOOGLE_GEMINI,
      async () => "google-result",
      AIProvider.CLAUDE_CODE,
      async () => "claude-fallback",
    );

    expect(result).toBe("claude-fallback");
  });

  it("should track per-provider stats independently", async () => {
    const { ProviderCircuitBreaker } = await import("../gateway/circuit-breaker");
    const { AIProvider } = await import("../gateway/provider-types");
    const cb = new ProviderCircuitBreaker();

    cb.recordSuccess(AIProvider.GOOGLE_GEMINI, 50);
    cb.recordSuccess(AIProvider.GOOGLE_GEMINI, 100);
    cb.recordFailure(AIProvider.CLAUDE_CODE);

    const googleStats = cb.getStats(AIProvider.GOOGLE_GEMINI);
    const claudeStats = cb.getStats(AIProvider.CLAUDE_CODE);

    expect(googleStats.totalSuccesses).toBe(2);
    expect(googleStats.totalFailures).toBe(0);
    expect(googleStats.avgLatencyMs).toBe(75);

    expect(claudeStats.totalSuccesses).toBe(0);
    expect(claudeStats.totalFailures).toBe(1);
  });
});

// â”€â”€â”€ Pipeline Optimizer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("PipelineOptimizer", () => {
  it("should import and instantiate", async () => {
    const { PipelineOptimizer } = await import("../gateway/pipeline-optimizer");
    const { AIProvider } = await import("../gateway/provider-types");

    const optimizer = new PipelineOptimizer({
      activeProviders: [AIProvider.GOOGLE_GEMINI],
      enableOptimization: false, // No bridge needed for this test
    });

    expect(optimizer).toBeTruthy();
    expect(optimizer.getStats().totalCalls).toBe(0);
  });

  it("should optimize with model routing (no bridge)", async () => {
    const { PipelineOptimizer } = await import("../gateway/pipeline-optimizer");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const optimizer = new PipelineOptimizer({
      activeProviders: [AIProvider.GOOGLE_GEMINI, AIProvider.CLAUDE_CODE],
      enableOptimization: false, // Skip bridge
    });

    const ceoAgent = AGENTS.find((a) => a.role === "ceo")!;
    const result = await optimizer.optimize(ceoAgent, "Plan a REST API project", 8);

    expect(result.model).toBeTruthy();
    expect(result.provider).toBeTruthy();
    expect(result.optimizedPrompt).toBe("Plan a REST API project"); // No bridge = unchanged
    expect(result.cacheHit).toBe(false);
  });

  it("should track stats across calls", async () => {
    const { PipelineOptimizer } = await import("../gateway/pipeline-optimizer");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const optimizer = new PipelineOptimizer({
      activeProviders: [AIProvider.GOOGLE_GEMINI],
      enableOptimization: false,
    });

    const agent = AGENTS[0]!;
    await optimizer.optimize(agent, "prompt 1", 5);
    await optimizer.optimize(agent, "prompt 2", 3);

    const stats = optimizer.getStats();
    expect(stats.totalCalls).toBe(2);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
    expect(stats.bridgeAvailable).toBeNull(); // Never checked (optimization disabled)
  });

  it("should gracefully handle bridge unavailability", async () => {
    const { PipelineOptimizer } = await import("../gateway/pipeline-optimizer");
    const { AIProvider } = await import("../gateway/provider-types");
    const { AGENTS } = await import("../orchestration/agents");

    const optimizer = new PipelineOptimizer({
      activeProviders: [AIProvider.GOOGLE_GEMINI],
      enableOptimization: true,
      bridgePort: 19999, // Port nothing listens on
    });

    const agent = AGENTS[0]!;
    const result = await optimizer.optimize(agent, "Test prompt", 5);

    // Should fall through without error
    expect(result.optimizedPrompt).toBe("Test prompt");
    expect(result.cacheHit).toBe(false);
    expect(optimizer.getStats().bridgeAvailable).toBe(false);
  });
});
