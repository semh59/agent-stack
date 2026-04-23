import { randomUUID } from "node:crypto";
import path from "node:path";
import { AlloyGatewayClient } from "../orchestration/gateway-client";
import {
  AutonomousLoopEngine,
} from "../orchestration/autonomous-loop-engine";
import type {
  AutonomousTaskExecutionContext,
  AutonomousTaskExecutorResult,
} from "../orchestration/autonomy-types";
import {
  BudgetReservationError,
  budgetTracker as defaultBudgetTracker,
  type BudgetTracker,
} from "../orchestration/BudgetTracker";
import type {
  AutonomyEvent,
  AutonomyQueueItem,
  AutonomySession,
  AutonomyState,
  CreateAutonomySessionRequest,
} from "../orchestration/autonomy-types";
import type { TokenStore } from "./token-store";
import type { AccountManager } from "../plugin/accounts";
import { getSettingsStore } from "../services/settings";
import { prepareAlloyRequest } from "../plugin/request";

interface ModelPayload {
  summary?: unknown;
  touchedFiles?: unknown;
  contextPack?: unknown;
}

interface ModelResponseShape {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  response?: {
    usageMetadata?: unknown;
  };
}

interface UsageMetadata {
  totalTokenCount?: number;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface SessionManagerOptions {
  projectRoot: string;
  tokenStore: TokenStore;
  getAccountManager: () => AccountManager | null;
  modelRequestTimeoutMs?: number;
  budgetTracker?: BudgetTracker;
}

const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 90_000;

/**
 * Bridges autonomy loop execution with Alloy account/model infrastructure.
 */
export class AutonomySessionManager {
  private readonly engine: AutonomousLoopEngine;
  private readonly projectRoot: string;
  private readonly tokenStore: TokenStore;
  private readonly getAccountManager: () => AccountManager | null;
  private readonly modelRequestTimeoutMs: number;
  private readonly budgetTracker: BudgetTracker;
  private readonly listeners = new Set<(event: AutonomyEvent) => void>();
  private readonly interruptedSessions = new Set<string>();
  private readonly activeTaskControllers = new Map<string, AbortController>();
  private readonly queue: string[] = [];
  private activeSessionId: string | null = null;
  private schedulerLocked = false;

  constructor(options: SessionManagerOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.tokenStore = options.tokenStore;
    this.getAccountManager = options.getAccountManager;
    this.modelRequestTimeoutMs =
      typeof options.modelRequestTimeoutMs === "number" && options.modelRequestTimeoutMs > 0
        ? Math.floor(options.modelRequestTimeoutMs)
        : DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
    this.budgetTracker = options.budgetTracker ?? defaultBudgetTracker;
    this.engine = new AutonomousLoopEngine({
      projectRoot: this.projectRoot,
      taskExecutor: this.executeTask.bind(this),
      clientResolver: this.resolveClient.bind(this),
      budgetTracker: this.budgetTracker,
    });
    this.engine.onEvent((event) => this.handleEngineEvent(event));
  }

  public onEvent(listener: (event: AutonomyEvent) => void): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  public startSession(request: CreateAutonomySessionRequest): AutonomySession {
    const startMode = request.startMode ?? "queued";

    if (startMode === "immediate" && !this.activeSessionId && this.queue.length === 0) {
      process.stderr.write(`[GATEWAY] Starting immediate session ${request.objective}\n`);
      const immediate = this.engine.create({ ...request, startMode: "immediate" }, "init");
      this.emitCreatedEvent(immediate);
      this.activeSessionId = immediate.id;
      process.stderr.write(`[GATEWAY] Calling engine.runExistingInBackground for ${immediate.id}\n`);
      this.engine.runExistingInBackground(immediate.id);
      this.emitQueueEvent("start_immediate", immediate.id);
      return this.engine.getSession(immediate.id) ?? immediate;
    }
    process.stderr.write(`[GATEWAY] Queuing session ${request.objective}. activeSessionId: ${this.activeSessionId}, queue: ${this.queue.length}\n`);

    const session = this.engine.create({ ...request, startMode: "queued" }, "queued");
    this.emitCreatedEvent(session);
    if (startMode === "immediate") {
      this.queue.unshift(session.id);
    } else {
      this.queue.push(session.id);
    }
    this.syncQueuePositions();
    this.emitQueueEvent(startMode === "immediate" ? "enqueue_priority" : "enqueue", session.id);
    this.drainQueue();
    return this.engine.getSession(session.id) ?? session;
  }

  public getSession(sessionId: string): AutonomySession | null {
    return this.engine.getSession(sessionId);
  }

  public async listSessions(): Promise<AutonomySession[]> {
    return (await this.engine.listSessions()).sort((a: AutonomySession, b: AutonomySession) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  public getQueue(): AutonomyQueueItem[] {
    return this.queue
      .map((sessionId, index) => {
        const session = this.engine.getSession(sessionId);
        if (!session) return null;
        return {
          sessionId,
          state: session.state,
          objective: session.objective,
          account: session.account,
          createdAt: session.createdAt,
          queuePosition: index + 1,
        } satisfies AutonomyQueueItem;
      })
      .filter((item): item is AutonomyQueueItem => item !== null);
  }

  public getArtifacts(sessionId: string): AutonomySession["artifacts"] | null {
    return this.engine.getArtifacts(sessionId);
  }

  public hydrateSession(snapshot: AutonomySession): AutonomySession {
    return this.engine.hydrateSession(snapshot);
  }

  public resumeRecoveredSession(sessionId: string): boolean {
    if (this.activeSessionId || this.queue.length > 0) {
      if (!this.queue.includes(sessionId)) {
        this.queue.unshift(sessionId);
        this.syncQueuePositions();
        this.emitQueueEvent("enqueue_recovery", sessionId);
      }
      this.drainQueue();
      return true;
    }

    const started = this.engine.runExistingInBackground(sessionId);
    if (started) {
      this.activeSessionId = sessionId;
      this.emitQueueEvent("resume_recovery", sessionId);
    }
    return started;
  }

  public async stopSession(sessionId: string, reason?: string): Promise<boolean> {
    this.activeTaskControllers.get(sessionId)?.abort(reason ?? "Stopped by API request");
    void this.budgetTracker.releaseAllForSession(sessionId, reason ?? "stop");
    const queueIndex = this.queue.indexOf(sessionId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      const stopped = await this.engine.stopQueued(sessionId, reason ?? "Cancelled while queued");
      this.syncQueuePositions();
      this.emitQueueEvent("cancel", sessionId);
      this.drainQueue();
      return stopped;
    }
    const stopped = await this.engine.stop(sessionId, reason);
    if (stopped) {
      this.interruptedSessions.add(sessionId);
      this.emitQueueEvent("stop_request", sessionId);
    }
    return stopped;
  }

  public consumeInterruptedStop(sessionId: string): boolean {
    if (!this.interruptedSessions.has(sessionId)) {
      return false;
    }
    this.interruptedSessions.delete(sessionId);
    return true;
  }

  public pauseSession(sessionId: string, reason?: string): boolean {
    this.activeTaskControllers.get(sessionId)?.abort(reason ?? "Paused by API request");
    void this.budgetTracker.releaseAllForSession(sessionId, reason ?? "pause");
    return this.engine.pause(sessionId, reason);
  }

  public resumeSession(sessionId: string, reason?: string): boolean {
    return this.engine.resume(sessionId, reason);
  }

  public promoteSession(sessionId: string): boolean {
    const index = this.queue.indexOf(sessionId);
    if (index < 0) return false;
    if (index === 0) return true;
    this.queue.splice(index, 1);
    this.queue.unshift(sessionId);
    this.syncQueuePositions();
    this.emitQueueEvent("promote", sessionId);
    return true;
  }

  private handleEngineEvent(event: AutonomyEvent): void {
    this.emit(event);

    if (event.type !== "state") return;
    const state = typeof event.payload.state === "string" ? event.payload.state : "";
    if (!state) return;

    if (state === "init" && this.activeSessionId !== event.sessionId) {
      this.activeSessionId = event.sessionId;
      this.emitQueueEvent("start_next", event.sessionId);
      return;
    }

    if (isTerminalState(state)) {
      this.interruptedSessions.delete(event.sessionId);
      const queueIndex = this.queue.indexOf(event.sessionId);
      if (queueIndex >= 0) {
        this.queue.splice(queueIndex, 1);
      }
      if (this.activeSessionId === event.sessionId) {
        this.activeSessionId = null;
      }
      this.syncQueuePositions();
      this.emitQueueEvent("complete", event.sessionId);
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    if (this.schedulerLocked) return;
    if (this.activeSessionId) return;
    if (this.queue.length === 0) return;

    this.schedulerLocked = true;
    try {
      while (!this.activeSessionId && this.queue.length > 0) {
        const nextSessionId = this.queue.shift()!;
        this.syncQueuePositions();
        const started = this.engine.runExistingInBackground(nextSessionId);
        if (started) {
          this.activeSessionId = nextSessionId;
          this.emitQueueEvent("start_next", nextSessionId);
          break;
        }
      }
    } finally {
      this.schedulerLocked = false;
    }
  }

  private syncQueuePositions(): void {
    for (let index = 0; index < this.queue.length; index += 1) {
      const sessionId = this.queue[index]!;
      this.engine.setQueuePosition(sessionId, index + 1);
    }
    if (this.activeSessionId) {
      this.engine.setQueuePosition(this.activeSessionId, null);
    }
  }

  private emit(event: AutonomyEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitCreatedEvent(session: AutonomySession): void {
    this.emit({
      type: "created",
      sessionId: session.id,
      timestamp: session.createdAt,
      payload: {
        state: session.state,
        reviewStatus: session.reviewStatus,
      },
    });
  }

  private emitQueueEvent(action: string, sessionId: string): void {
    const event: AutonomyEvent = {
      type: "queue",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        action,
        activeSessionId: this.activeSessionId,
        queue: this.getQueue(),
      },
    };
    this.emit(event);
  }

  private async executeTask(
    context: AutonomousTaskExecutionContext,
  ): Promise<AutonomousTaskExecutorResult> {
    const abortController = new AbortController();
    this.activeTaskControllers.set(context.session.id, abortController);
    
    // Check for interruption periodically or via a short-poll (as this is a sync-to-async bridge)
    const checkInterval = setInterval(() => {
      if (context.isInterrupted()) {
        abortController.abort("Task interrupted by autonomy engine");
        clearInterval(checkInterval);
      }
    }, 100);

    try {
      const prompt = this.buildPrompt(context);
      const requestId = randomUUID();
      const maxOutputTokens = 1024;
      const reservation = await this.budgetTracker.reserve(context.session, {
        requestId,
        estimatedTokens: estimateTokens(prompt) + maxOutputTokens,
        leaseExpiresAtMs: Date.now() + this.modelRequestTimeoutMs + 15_000,
      });
      if (!reservation.accepted || !reservation.reservation) {
        throw new BudgetReservationError(
          reservation.reason ?? "BUDGET_EXCEEDED: quota reservation rejected",
          reservation.usage,
        );
      }

      const modelResult = await this.invokeModel(
        context,
        prompt,
        maxOutputTokens,
        abortController.signal,
      );
      clearInterval(checkInterval);
      const parsed = this.parseModelPayload(modelResult.text);
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : modelResult.text.slice(0, 1200).trim();

    const touchedFiles = Array.isArray(parsed.touchedFiles)
      ? parsed.touchedFiles.filter((item): item is string => typeof item === "string")
      : [];

    const violations = touchedFiles.filter((file) => !this.isWithinScope(file, context.session.scope.paths));
    if (violations.length > 0) {
      await this.budgetTracker.release(reservation.reservation.reservationId, "scope_violation");
      throw new Error(`SCOPE_VIOLATION: ${violations.join(", ")}`);
    }

    const actualUsage = resolveUsageAccounting(modelResult.usage, prompt, modelResult.text);
    const estimatedUsd = estimateUsd(
      context.modelDecision.selectedModel,
      actualUsage.inputTokens,
      actualUsage.outputTokens,
    );
    const commitResult = await this.budgetTracker.commit(
      reservation.reservation.reservationId,
      {
        inputTokens: actualUsage.inputTokens,
        outputTokens: actualUsage.outputTokens,
        estimatedUsd,
        cachedInputTokens: actualUsage.cachedInputTokens,
      },
    );
    if (!commitResult.usage) {
      throw new Error("BUDGET_COMMIT_FAILED: reservation was lost before commit");
    }

    return {
      summary,
      touchedFiles,
      nextActionReason: `Completed ${context.task.type} via ${context.modelDecision.selectedModel}`,
      contextPack:
        typeof parsed.contextPack === "string" && parsed.contextPack.trim().length > 0
          ? parsed.contextPack.trim()
          : undefined,
      usageAccounting: {
        inputTokens: actualUsage.inputTokens,
        outputTokens: actualUsage.outputTokens,
        estimatedUsd,
        cachedInputTokens: commitResult.cachedInputTokens,
        usage: commitResult.usage,
      },
    };
  } catch (error) {
      const normalizedMessage =
        error instanceof Error
          ? error.message.toLowerCase()
          : typeof error === "string"
            ? error.toLowerCase()
            : "";

      if (normalizedMessage.includes("timeout")) {
        await this.budgetTracker.releaseAllForSession(context.session.id, "timeout");
        throw new Error(`MODEL_TIMEOUT: Model request exceeded ${this.modelRequestTimeoutMs}ms`);
      }

      if (error === "Task interrupted by autonomy engine" || normalizedMessage.includes("abort")) {
        await this.budgetTracker.releaseAllForSession(context.session.id, "abort");
        throw new Error("TASK_INTERRUPTED: Otonom d\u00f6ng\u00fc taraf\u0131ndan kesildi.");
      }

      await this.budgetTracker.releaseAllForSession(context.session.id, "task_failure");
      throw error;
    } finally {
      clearInterval(checkInterval);
      this.activeTaskControllers.delete(context.session.id);
    }
  }

  private async invokeModel(
    context: AutonomousTaskExecutionContext,
    prompt: string,
    maxOutputTokens: number,
    abortSignal?: AbortSignal
  ): Promise<{ text: string; usage: UsageMetadata | null }> {
    const settings = getSettingsStore().getSettings();
    const modelId = context.modelDecision.selectedModel;
    
    // Determine provider from modelId (e.g., "anthropic/claude-3-5-sonnet" -> "anthropic")
    const providerMatch = modelId.match(/^([^/:]+)[/:]/);
    const providerId = providerMatch ? providerMatch[1] : "google";
    const modelName = modelId.includes("/") || modelId.includes(":") ? modelId.split(/[/:]/).slice(1).join("/") : modelId;

    // Direct Provider Branch (Native API Keys)
    if (providerId === "anthropic" || providerId === "openai" || providerId === "openrouter") {
      const apiKey = getSettingsStore().getSecret(`providers.${providerId}.api_key` as any);
      if (apiKey) {
        return this.invokeNativeProvider(providerId, modelName, prompt, apiKey, maxOutputTokens, abortSignal);
      }
    }

    // Managed Provider Branch (OAuth / Google Proxy)
    const token = await this.tokenStore.getValidAccessToken();
    const active = this.tokenStore.getActiveToken();

    if (!token || !active) {
      throw new Error("No active account/token available for autonomous execution. Connect an account in the Accounts page.");
    }

    const accountManager = this.getAccountManager();
    if (accountManager && active.email) {
      accountManager.switchToAccountByEmail(active.email);
    }

    const client = AlloyGatewayClient.fromToken(token, active.email, accountManager ?? undefined);
    
    // Use prepareAlloyRequest to handle model-specific transforms and generic-to-native mapping
    const { request: url, init } = prepareAlloyRequest(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens,
          },
        }),
        signal: this.createModelRequestSignal(abortSignal),
      },
      token,
      "autonomy-task"
    );

    const response = await client.fetch(url, init);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${providerId} request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as ModelResponseShape;
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Model response missing text payload");
    }
    return {
      text,
      usage: extractUsageMetadata(payload) ?? extractUsageHeaders(response.headers),
    };
  }

  private async invokeNativeProvider(
    provider: string,
    model: string,
    prompt: string,
    apiKey: string,
    maxOutputTokens: number,
    abortSignal?: AbortSignal
  ): Promise<{ text: string; usage: UsageMetadata | null }> {
    let endpoint = "";
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    let body: any = {};

    if (provider === "anthropic") {
      endpoint = "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: prompt }],
      };
    } else if (provider === "openai") {
      endpoint = "https://api.openai.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${apiKey}`;
      body = {
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: prompt }],
      };
    } else if (provider === "openrouter") {
      endpoint = "https://openrouter.ai/api/v1/chat/completions";
      headers["Authorization"] = `Bearer ${apiKey}`;
      body = {
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: prompt }],
      };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: this.createModelRequestSignal(abortSignal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Native ${provider} request failed (${response.status}): ${errorText.slice(0, 300)}`);
    }

    const data = await response.json() as any;
    let text = "";
    let usage: UsageMetadata | null = null;

    if (provider === "anthropic") {
      text = data.content?.[0]?.text ?? "";
      usage = {
        promptTokenCount: data.usage?.input_tokens,
        candidatesTokenCount: data.usage?.output_tokens,
        totalTokenCount: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      };
    } else {
      // OpenAI / OpenRouter format
      text = data.choices?.[0]?.message?.content ?? "";
      usage = {
        promptTokenCount: data.usage?.prompt_tokens,
        candidatesTokenCount: data.usage?.completion_tokens,
        totalTokenCount: data.usage?.total_tokens,
      };
    }

    return { text, usage };
  }

  private buildPrompt(context: AutonomousTaskExecutionContext): string {
    const scope = context.session.scope.paths.join(", ");
    return `
You are an autonomous AI coding agent. Your goal is to solve the following objective:
Objective: ${context.session.objective}

Current Task: ${context.task.type}
Allowed Scope: ${scope}

Instructions:
1. Analyze the context and perform the requested task.
2. If the task requires file changes, provide a summary of the changes and a list of touched files.
3. Your response MUST be a valid JSON object with the following structure:
{
  "summary": "Detailed explanation of what you did and why.",
  "touchedFiles": ["relative/path/to/file1.ts", "relative/path/to/file2.ts"],
  "contextPack": "Optional: Additional context or notes for the next turn."
}
4. If no files were modified, set "touchedFiles" to [].
5. Do not include any text outside the JSON block.

Begin your analysis.
`.trim();
  }

  private parseModelPayload(raw: string): ModelPayload {
    const trimmed = raw.trim();
    const strictParsed = this.tryParseJson(trimmed);
    if (strictParsed) {
      return strictParsed;
    }

    const recoveredParsed = this.tryParseFencedOrTailTrim(trimmed);
    if (recoveredParsed) {
      return recoveredParsed;
    }

    if (!this.looksJsonLike(trimmed)) {
      return { summary: trimmed, touchedFiles: [] };
    }

    throw new Error("MODEL_PAYLOAD_PARSE_ERROR: JSON payload could not be recovered");
  }

  private tryParseJson(candidate: string): ModelPayload | null {
    try {
      return JSON.parse(candidate) as ModelPayload;
    } catch {
      return null;
    }
  }

  private tryParseFencedOrTailTrim(input: string): ModelPayload | null {
    const fencedMatch = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const fenced = fencedMatch?.[1]?.trim();
    if (fenced) {
      const parsed = this.tryParseJson(fenced);
      if (parsed) {
        return parsed;
      }
      const trimmedFenced = this.trimCandidateToJsonBoundary(fenced, this.inferBoundaryMode(fenced));
      if (trimmedFenced) {
        const parsedTrimmedFenced = this.tryParseJson(trimmedFenced);
        if (parsedTrimmedFenced) {
          return parsedTrimmedFenced;
        }
      }
    }

    const trimmed = this.trimCandidateToJsonBoundary(input, this.inferBoundaryMode(input));
    if (!trimmed) {
      return null;
    }
    return this.tryParseJson(trimmed);
  }

  private inferBoundaryMode(input: string): "auto" | "object" | "array" {
    const trimmed = input.trim();
    if (trimmed.startsWith("{")) {
      return "object";
    }
    if (trimmed.startsWith("[")) {
      return "array";
    }
    return "auto";
  }

  private trimCandidateToJsonBoundary(input: string, mode: "auto" | "object" | "array" = "auto"): string | null {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (mode !== "array") {
      const objectStart = trimmed.indexOf("{");
      const objectEnd = trimmed.lastIndexOf("}");
      if (objectStart >= 0 && objectEnd > objectStart) {
        return trimmed.slice(objectStart, objectEnd + 1);
      }
      if (mode === "object") {
        return null;
      }
    }

    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return trimmed.slice(arrayStart, arrayEnd + 1);
    }

    return null;
  }

  private looksJsonLike(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return false;
    }
    if (trimmed.startsWith("```")) {
      return true;
    }
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }

  private createModelRequestSignal(abortSignal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(this.modelRequestTimeoutMs);
    if (!abortSignal) {
      return timeoutSignal;
    }

    const controller = new AbortController();
    const forwardAbort = (reason?: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort(reason);
      abortSignal.removeEventListener("abort", onAbortFromCaller);
      timeoutSignal.removeEventListener("abort", onAbortFromTimeout);
    };

    const onAbortFromCaller = () => forwardAbort(abortSignal.reason);
    const onAbortFromTimeout = () => forwardAbort(timeoutSignal.reason);

    if (abortSignal.aborted) {
      forwardAbort(abortSignal.reason);
      return controller.signal;
    }
    if (timeoutSignal.aborted) {
      forwardAbort(timeoutSignal.reason);
      return controller.signal;
    }

    abortSignal.addEventListener("abort", onAbortFromCaller, { once: true });
    timeoutSignal.addEventListener("abort", onAbortFromTimeout, { once: true });
    return controller.signal;
  }

  private async resolveClient(_session: AutonomySession): Promise<AlloyGatewayClient> {
    const token = await this.tokenStore.getValidAccessToken();
    const active = this.tokenStore.getActiveToken();

    if (!token || !active) {
      throw new Error("No active account/token available for client resolution");
    }

    const accountManager = this.getAccountManager();
    if (accountManager && active.email) {
      accountManager.switchToAccountByEmail(active.email);
    }

    return AlloyGatewayClient.fromToken(token, active.email, accountManager ?? undefined);
  }

  private isWithinScope(relativeFilePath: string, scopeRoots: string[]): boolean {
    const normalized = relativeFilePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    return scopeRoots.some((scopeRoot) => {
      const normalizedScope = scopeRoot.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
      return normalized === normalizedScope || normalized.startsWith(`${normalizedScope}/`);
    });
  }
}

function normalizeModel(model: string): string {
  if (model.startsWith("google/Alloy-")) {
    return model.slice("google/Alloy-".length);
  }
  return model;
}

function estimateTokens(text: string | undefined): number {
  if (!text || text.trim().length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const normalized = model.toLowerCase();
  const basePer1kIn = normalized.includes("flash") ? 0.00015 : 0.001;
  const basePer1kOut = normalized.includes("flash") ? 0.0004 : 0.002;
  return (inputTokens / 1000) * basePer1kIn + (outputTokens / 1000) * basePer1kOut;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractUsageMetadata(payload: ModelResponseShape): UsageMetadata | null {
  const usage = payload.response?.usageMetadata;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const record = usage as Record<string, unknown>;
  return {
    totalTokenCount: toFiniteNumber(record.totalTokenCount),
    promptTokenCount: toFiniteNumber(record.promptTokenCount),
    candidatesTokenCount: toFiniteNumber(record.candidatesTokenCount),
    cachedContentTokenCount: toFiniteNumber(record.cachedContentTokenCount),
  };
}

function extractUsageHeaders(headers: Headers): UsageMetadata | null {
  const parseHeader = (name: string): number | undefined => {
    const raw = headers.get(name);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const usage: UsageMetadata = {
    totalTokenCount: parseHeader("x-Alloy-total-token-count"),
    promptTokenCount: parseHeader("x-Alloy-prompt-token-count"),
    candidatesTokenCount: parseHeader("x-Alloy-candidates-token-count"),
    cachedContentTokenCount: parseHeader("x-Alloy-cached-content-token-count"),
  };

  return Object.values(usage).some((value) => value !== undefined) ? usage : null;
}

function resolveUsageAccounting(
  usage: UsageMetadata | null,
  prompt: string,
  modelText: string,
): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
} {
  const fallbackInputTokens = estimateTokens(prompt);
  const fallbackOutputTokens = estimateTokens(modelText);
  const inputTokens = Math.max(
    0,
    Math.floor(usage?.promptTokenCount ?? usage?.totalTokenCount ?? fallbackInputTokens),
  );
  const outputTokens = Math.max(
    0,
    Math.floor(usage?.candidatesTokenCount ?? fallbackOutputTokens),
  );
  const cachedInputTokens = Math.max(0, Math.floor(usage?.cachedContentTokenCount ?? 0));

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };
}

function isTerminalState(state: string): state is Extract<AutonomyState, "done" | "failed" | "stopped"> {
  return state === "done" || state === "failed" || state === "stopped";
}
