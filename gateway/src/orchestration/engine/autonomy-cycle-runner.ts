import type { 
  AutonomySession, 
  TaskNode, 
  ModelDecision, 
  ModelSwitchReason, 
  GateResult, 
  AutonomousTaskExecutor,
  AutonomyEvent,
  GearLevel,
  AutonomousClientResolver,
} from "../autonomy-types";
import { SmartMultiModelRouter } from "../autonomy-model-router";
import { gearEngine } from "../GearEngine";
import { taskGraphManager } from "../TaskGraphManager";
import { normalizeTouchedFiles } from "../gateway-utils";
import { AutonomySessionManager } from "./autonomy-session-manager";
import { GateEngine } from "../GateEngine";
import { AlloyGatewayClient } from "../gateway-client";
import type { BudgetTracker } from "../BudgetTracker";

interface CycleRunnerOptions {
  sessionManager: AutonomySessionManager;
  taskExecutor: AutonomousTaskExecutor;
  modelRouter: SmartMultiModelRouter;
  gateEngine: GateEngine;
  emit: (type: AutonomyEvent["type"], session: AutonomySession, payload: Record<string, unknown>) => void;
  clientResolver?: AutonomousClientResolver;
  defaultClient?: AlloyGatewayClient;
}

export class AutonomyCycleRunner {
  constructor(private readonly options: CycleRunnerOptions) {}

  public async prepareCycle(
    session: AutonomySession,
    task: TaskNode,
    nextSwitchReason: ModelSwitchReason,
    recoverToAnchorPending: boolean,
  ): Promise<ModelDecision> {
    await this.options.sessionManager.transition(session, "plan", task, `Planning ${task.type} task`);

    const modelDecision = this.options.modelRouter.decide({
      taskType: task.type,
      anchorModel: session.anchorModel,
      previousModel:
        session.modelHistory.length > 0
          ? session.modelHistory[session.modelHistory.length - 1]!.selectedModel
          : null,
      reasonCode: nextSwitchReason,
      policy: session.modelPolicy,
      recoverToAnchor: recoverToAnchorPending && nextSwitchReason === "ROUTER_POLICY",
      contextPack: session.artifacts.contextPack,
      history: session.modelHistory,
    });

    session.modelHistory.push(modelDecision);
    session.currentModel = modelDecision.selectedModel;
    
    let gear = this.deriveGear(modelDecision.selectedModel);
    if (session.budgets.warning && gear !== "fast") {
      const downshifted = gearEngine.scaleGear(gear!, "down");
      this.options.emit("log", session, { 
        message: `Adaptive Gear Scaling: Downshifting from ${gear} to ${downshifted} due to budget pressure.`,
        severity: "info"
      });
      gear = downshifted;
    }
    session.currentGear = gear;

    this.options.emit("model_switch", session, {
      selectedModel: modelDecision.selectedModel,
      previousModel: modelDecision.previousModel,
      reasonCode: modelDecision.reasonCode,
      taskId: task.id,
    });

    return modelDecision;
  }

  public async executeCycle(
    session: AutonomySession,
    task: TaskNode,
    modelDecision: ModelDecision,
    isInterrupted: () => boolean,
    budgetTracker: BudgetTracker,
  ): Promise<{ success: boolean; result?: any; nextSwitchReason?: ModelSwitchReason }> {
    await this.options.sessionManager.transition(session, "execute", task, `Executing ${task.type}`);
    task.status = "in_progress";
    task.attempts += 1;
    task.updatedAt = new Date().toISOString();
    
    await this.options.sessionManager.appendOpLog(session, {
      operationId: `${session.id}:${task.type}:${session.cycleCount}`,
      cycle: session.cycleCount,
      taskType: task.type,
      status: "started",
      summary: `Executing ${task.type}`,
      touchedFiles: [],
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await this.options.taskExecutor({
        session: structuredClone(session),
        task: structuredClone(task),
        modelDecision,
        cycle: session.cycleCount,
        isInterrupted,
      });

      const touched = normalizeTouchedFiles(result.touchedFiles ?? []);
      session.touchedFiles = [...new Set([...session.touchedFiles, ...touched])];
      session.artifacts.changeSummary = result.summary;
      if (result.contextPack && result.contextPack.trim().length > 0) {
        session.artifacts.contextPack = result.contextPack;
      }
      
      if (result.usageAccounting) {
        budgetTracker.applyExecutionUsage(session, result.usageAccounting);
      } else if (
        typeof result.inputTokens === "number" ||
        typeof result.outputTokens === "number" ||
        typeof result.estimatedUsd === "number"
      ) {
        budgetTracker.consume(
          session,
          Math.max(0, Math.floor(result.inputTokens ?? 0)),
          Math.max(0, Math.floor(result.outputTokens ?? 0)),
          Math.max(0, result.estimatedUsd ?? 0),
        );
      }
      const warningReason = budgetTracker.checkWarning(session);
      const exceeded = budgetTracker.checkExceeded(session);

      this.options.emit("artifact", session, { type: "changeSummary", value: session.artifacts.changeSummary });
      this.options.emit("budget", session, {
        limits: session.budgets.limits,
        usage: session.budgets.usage,
        warning: warningReason !== null,
        warningReason,
        exceeded,
        exceedReason: session.budgets.exceedReason,
        tokenVelocity: budgetTracker.getTokenVelocity(),
      });

      if (touched.length > 0) {
        this.options.emit("diff_ready", session, { files: touched, taskId: task.id });
      }

      await this.options.sessionManager.appendOpLog(session, {
        operationId: `${session.id}:${task.type}:${session.cycleCount}`,
        cycle: session.cycleCount,
        taskType: task.type,
        status: "completed",
        summary: result.summary,
        touchedFiles: touched,
        timestamp: new Date().toISOString(),
      });
      this.options.emit("gear_completed", session, {
        taskId: task.id,
        selectedModel: modelDecision.selectedModel,
        gear: session.currentGear,
        summary: result.summary,
      });

      return {
        success: true,
        result,
        nextSwitchReason: warningReason ? "BUDGET_EXCEEDED" : undefined,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      const isImmediateFail = this.isImmediateFailExecutionError(message);
      
      await this.options.sessionManager.appendOpLog(session, {
        operationId: `${session.id}:${task.type}:${session.cycleCount}`,
        cycle: session.cycleCount,
        taskType: task.type,
        status: "failed",
        summary: message,
        touchedFiles: [],
        timestamp: new Date().toISOString(),
      });
      
      task.lastError = message;
      task.status = isImmediateFail || task.attempts >= task.maxAttempts ? "failed" : "pending";
      session.artifacts.changeSummary = `Task execution failed: ${message}`;
      
      const nextSwitchReason = this.inferModelSwitchReason(message);
      SmartMultiModelRouter.recordFailure(modelDecision.selectedModel, session.id);

      this.options.emit("gear_failed", session, {
        taskId: task.id,
        selectedModel: modelDecision.selectedModel,
        gear: session.currentGear,
        error: message,
        nextSwitchReason,
      });

      if (isImmediateFail) {
        await this.options.sessionManager.failSession(session, `Task ${task.type} failed with unrecoverable runtime error: ${message}`);
        return { success: false };
      }

      await this.options.sessionManager.transition(session, "retry", task, message);
      
      if (task.status === "failed") {
        await this.options.sessionManager.failSession(session, `Task ${task.type} exhausted retry budget: ${message}`);
      }
      
      return { success: false, nextSwitchReason };
    }
  }

  public async verifyCycle(session: AutonomySession, task: TaskNode, projectRoot: string): Promise<GateResult> {
    const isNoFileTask = ["analysis", "finalize"].includes(task.type);
    const hasNoChanges = !session.touchedFiles || session.touchedFiles.length === 0;

    if (isNoFileTask || hasNoChanges) {
      await this.options.sessionManager.transition(session, "verify", task, `Bypassing quality gates for ${task.type} (No files changed)`);
      const bypassResult: GateResult = {
        passed: true,
        strictMode: true,
        blockingIssues: [],
        auditSummary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 },
        impactedScopes: [],
        commands: [],
        timestamp: new Date().toISOString()
      };
      session.artifacts.gateResult = bypassResult;
      this.options.emit("gate_bypass", session, {
        taskId: task.id,
        reasonCode: isNoFileTask ? "TASK_TYPE_BYPASS" : "NO_FILES_CHANGED",
        passed: true,
        blockingIssues: [],
        impactedScopes: [],
        audit: bypassResult.auditSummary,
        auditSummary: bypassResult.auditSummary,
      });
      return bypassResult;
    }

    await this.options.sessionManager.transition(session, "verify", task, "Running modular quality gates");
    const client = this.options.clientResolver 
      ? await this.options.clientResolver(session) 
      : this.options.defaultClient;

    const gateResult = await this.options.gateEngine.run({
      sessionId: session.id,
      projectRoot,
      touchedFiles: session.touchedFiles,
      scopePaths: session.scope.paths,
      client,
    });
    session.artifacts.gateResult = gateResult;
    this.options.emit("gate_result", session, {
      passed: gateResult.passed,
      blockingIssues: gateResult.blockingIssues,
      impactedScopes: gateResult.impactedScopes,
      audit: gateResult.auditSummary,
    });
    return gateResult;
  }

  public async reflectOnCycle(
    session: AutonomySession,
    task: TaskNode,
    gateResult: GateResult,
    executionResult: Record<string, any>,
  ): Promise<{ passed: boolean; nextSwitchReason?: ModelSwitchReason; nextActionReason?: string }> {
    if (!gateResult.passed) {
      this.options.emit("log", session, {
        message: `Gate failure (Consecutive: ${session.consecutiveGateFailures + 1}). Fix cycle tasks activated.`,
        severity: "error",
      });
      session.consecutiveGateFailures += 1;
      task.lastError = gateResult.blockingIssues[0] ?? "Quality gate failed";
      task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
      
      let recoveryGear: GearLevel = "standard";
      const issuesLower = gateResult.blockingIssues.join(" ").toLowerCase();
      
      if (issuesLower.includes("lint") || issuesLower.includes("type-check")) {
        recoveryGear = "fast";
      } else if (issuesLower.includes("build") || issuesLower.includes("command failed")) {
        recoveryGear = "standard";
      } else if (issuesLower.includes("test")) {
        recoveryGear = "elite";
      }
      
      session.currentGear = recoveryGear;
      taskGraphManager.activateFixCycle(session.taskGraph);
      
      const nextActionReason = `Gate failed (${recoveryGear} gear recovery). Issues: ${gateResult.blockingIssues.join("; ")}`;
      await this.options.sessionManager.transition(
        session,
        "retry",
        task,
        `Gate fail ${session.consecutiveGateFailures}/3: ${gateResult.blockingIssues[0]}`,
      );

      if (session.consecutiveGateFailures >= 3) {
        await this.options.sessionManager.failSession(session, `Gate failed three consecutive cycles: ${gateResult.blockingIssues.join("; ")}`);
        return { passed: false };
      }
      if (task.status === "failed") {
        await this.options.sessionManager.failSession(session, `Task ${task.type} exhausted retry budget after gate failures`);
        return { passed: false };
      }
      
      return { passed: false, nextSwitchReason: "QUALITY_FAIL_RECOVERY", nextActionReason };
    }

    session.consecutiveGateFailures = 0;
    task.status = "completed";
    task.lastError = undefined;
    task.updatedAt = new Date().toISOString();
    
    return { 
      passed: true, 
      nextActionReason: executionResult.nextActionReason ?? `Task ${task.type} completed` 
    };
  }

  private deriveGear(model: string | null): GearLevel | null {
    if (!model) return null;
    const normalized = model.toLowerCase();
    if (normalized.includes("flash") || normalized.includes("8b") || normalized.includes("mini")) return "fast";
    if (normalized.includes("opus") || normalized.includes("thinking") || normalized.includes("pro") || normalized.includes("elite")) {
      return "elite";
    }
    return "standard";
  }

  private inferModelSwitchReason(message: string): ModelSwitchReason {
    const normalized = message.toLowerCase();
    if (normalized.includes("429") || normalized.includes("rate limit")) return "RATE_LIMIT";
    if (normalized.includes("timeout") || normalized.includes("timed out")) return "TIMEOUT";
    if (normalized.includes("format") || normalized.includes("schema")) return "FORMAT_ERROR";
    if (normalized.includes("budget")) return "BUDGET_EXCEEDED";
    return "QUALITY_FAIL_RECOVERY";
  }

  private isImmediateFailExecutionError(message: string): boolean {
    const normalized = message.toLowerCase();
    const oomPatterns = [/javascript heap out of memory/, /out of memory/, /enomem/];
    return oomPatterns.some((pattern) => pattern.test(normalized));
  }
}
