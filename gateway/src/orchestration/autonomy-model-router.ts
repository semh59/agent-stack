import type { ModelDecision, ModelSwitchReason, TaskNodeType, ModelPolicy } from "./autonomy-types";

interface RouterInput {
  taskType: TaskNodeType;
  anchorModel: string;
  previousModel: string | null;
  reasonCode: ModelSwitchReason;
  policy: ModelPolicy;
  recoverToAnchor?: boolean;
  contextPack?: string;
  history?: ModelDecision[];
}

const FLASH_MODELS = [
  "gemini-3-flash",
  "claude-3-haiku",
  "gpt-4o-mini"
];

const PRO_MODELS = [
  "claude-sonnet-4-6-thinking",
  "gemini-3-pro-high",
  "gpt-4o-2024-05-13"
];

const FALLBACK_MODELS = [
  ...PRO_MODELS,
  ...FLASH_MODELS
];

function normalizeModelName(model: string): string {
  if (model.startsWith("google/Alloy-")) {
    return model.slice("google/Alloy-".length);
  }
  return model;
}

function pickPolicyModel(taskType: TaskNodeType, policy: ModelPolicy): string {
  if (policy === "fast_only") return FLASH_MODELS[0]!;
  if (policy === "pro_only") return PRO_MODELS[0]!;

  // Default smart_multi logic
  if (taskType === "analysis" || taskType === "refactor") {
    return PRO_MODELS[0]!;
  }
  if (taskType === "implementation" || taskType === "test-fix") {
    return FLASH_MODELS[0]!;
  }
  return PRO_MODELS[1] ?? PRO_MODELS[0]!; // gemini-3-pro-high for others
}

export class SmartMultiModelRouter {
  private static readonly CIRCUIT_BREAKER = new Map<string, { trippedUntil: number }>();
  private static readonly FAILURE_THRESHOLD = 3;
  private static readonly COOLDOWN_MS = 5 * 60 * 1000;

  public decide(input: RouterInput): ModelDecision {
    const timestamp = new Date().toISOString();
    const normalizedAnchor = normalizeModelName(input.anchorModel);
    const policyModel = pickPolicyModel(input.taskType, input.policy);
    const previous = input.previousModel ? normalizeModelName(input.previousModel) : null;

    const errorDriven = new Set<ModelSwitchReason>([
      "RATE_LIMIT",
      "TIMEOUT",
      "FORMAT_ERROR",
      "QUALITY_FAIL_RECOVERY",
      "BUDGET_EXCEEDED",
    ]);

    let selectedModel = policyModel;
    let reasonCode: ModelSwitchReason = "ROUTER_POLICY";

    if (input.reasonCode === "INITIAL") {
      selectedModel = normalizedAnchor;
      reasonCode = "INITIAL";
    } else if (errorDriven.has(input.reasonCode)) {
      // Phase 4B: Rate-limit Cool-down and Fallback Rotation
      if (input.reasonCode === "RATE_LIMIT") {
        selectedModel = this.handleRateLimit(input, normalizedAnchor, previous);
      } else {
        // Bulletproof: Skip tripped models during rotation
        const rotation = [normalizedAnchor, ...FALLBACK_MODELS.filter((m) => m !== normalizedAnchor)];
        const available = rotation.filter(m => !this.isTripped(m));
        
        const currentIndex = previous ? available.indexOf(previous) : -1;
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % available.length : 0;
        selectedModel = available[nextIndex] ?? rotation[0] ?? normalizedAnchor;
      }
      reasonCode = input.reasonCode;
    } else if (input.recoverToAnchor) {
      selectedModel = normalizedAnchor;
      reasonCode = "ROUTER_POLICY";
    }

    // Force policy adherence if not in error recovery
    if (!errorDriven.has(input.reasonCode) && input.reasonCode !== "INITIAL") {
      if (input.policy === "fast_only" && !FLASH_MODELS.includes(selectedModel)) {
        selectedModel = FLASH_MODELS[0]!;
      } else if (input.policy === "pro_only" && !PRO_MODELS.includes(selectedModel)) {
        selectedModel = PRO_MODELS[0]!;
      }
    }

    // Circuit Breaker auto-reset check
    if (this.isTripped(selectedModel) && errorDriven.has(input.reasonCode)) {
        // If the selected model is tripped, try to find the next best available
        selectedModel = FALLBACK_MODELS.find(m => !this.isTripped(m)) || selectedModel;
    }

    const selected = this.applyContextContinuity(selectedModel, input.contextPack, normalizedAnchor, previous);

    return {
      selectedModel: selected,
      previousModel: previous,
      anchorModel: normalizedAnchor,
      reasonCode,
      switched: previous !== null && selected !== previous,
      timestamp,
    };
  }

  /**
   * Records a failure for a model to potentially trip the circuit.
   */
  public static recordFailure(model: string, sessionId: string): void {
    const key = `${sessionId}:${normalizeModelName(model)}`;
    // In a production app, we would use a more sophisticated sliding window.
    // Here we trip the model globally for the session if it hits threshold.
    const entry = SmartMultiModelRouter.CIRCUIT_BREAKER.get(key) || { trippedUntil: 0 };
    SmartMultiModelRouter.CIRCUIT_BREAKER.set(key, { 
        trippedUntil: Date.now() + SmartMultiModelRouter.COOLDOWN_MS 
    });
    console.warn(`[Alloy:Breaker] Tripped model ${model} for session ${sessionId} due to recurring failure.`);
  }

  private isTripped(model: string): boolean {
    const entry = SmartMultiModelRouter.CIRCUIT_BREAKER.get(normalizeModelName(model));
    if (!entry) return false;
    return Date.now() < entry.trippedUntil;
  }

  private handleRateLimit(input: RouterInput, anchor: string, previous: string | null): string {
    const rotation = [...FLASH_MODELS, ...PRO_MODELS];
    const available = rotation.filter(m => !this.isTripped(m));
    const currentIndex = previous ? available.indexOf(previous) : -1;
    const nextIndex = (currentIndex + 1) % available.length;
    return available[nextIndex] ?? FLASH_MODELS[0]!;
  }

  private applyContextContinuity(
    selectedModel: string,
    contextPack: string | undefined,
    anchorModel: string,
    previousModel: string | null,
  ): string {
    if (!contextPack || contextPack.trim().length === 0) return selectedModel;
    if (contextPack.length > 8_000 && previousModel && previousModel !== anchorModel) {
      return anchorModel;
    }
    return selectedModel;
  }
}
