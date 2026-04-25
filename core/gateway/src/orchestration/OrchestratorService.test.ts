import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OrchestratorService } from "./OrchestratorService";
import { eventBus } from "./event-bus";

describe("OrchestratorService", () => {
  let service: OrchestratorService;
  const projectRoot = process.cwd();

  beforeEach(() => {
    // Reset singleton instance for test isolation
    (OrchestratorService as any).instance = undefined;
    service = OrchestratorService.getInstance(projectRoot);
  });

  afterEach(() => {
    service.dispose();
  });

  it("returns singleton instance via getInstance", () => {
    const instance2 = OrchestratorService.getInstance(projectRoot);
    expect(service).toBe(instance2);
  });

  it("creates mission session synchronously", () => {
    const session = service.createMission({
      account: "test@loji.next",
      objective: "Test objective",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 1 }
    });
    expect(session.id).toBeDefined();
    expect(session.objective).toBe("Test objective");
  });

  it("publishes budget:warning on soft limit overflow without stopping the engine", () => {
    const session = service.createMission({
      account: "test@loji.next",
      objective: "Budget test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 1 }
    });

    const stopSpy = vi.spyOn((service as any).autonomyEngine, "stop");
    const warningSpy = vi.fn();
    const unsubscribe = eventBus.subscribe("budget:warning", warningSpy);

    eventBus.publish("mission.budget", {
      type: "budget",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      payload: {
        warning: true,
        warningReason: "BUDGET_WARNING: tpm 950/1000",
        exceeded: false,
        exceedReason: null
      }
    });

    expect(warningSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not stop the engine on hard budget exceed because failure belongs to the engine", () => {
    const session = service.createMission({
      account: "test@loji.next",
      objective: "Budget hard stop test",
      anchorModel: "gemini-3-pro-high",
      scope: { mode: "selected_only", paths: ["src"] },
      modelPolicy: "smart_multi",
      gitMode: "patch_only",
      budgets: { maxCycles: 10, maxDurationMs: 60000, maxInputTokens: 100000, maxOutputTokens: 50000, maxUsd: 1 }
    });

    const stopSpy = vi.spyOn((service as any).autonomyEngine, "stop");

    eventBus.publish("mission.budget", {
      type: "budget",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      payload: {
        warning: false,
        warningReason: null,
        exceeded: true,
        exceedReason: "BUDGET_EXCEEDED: tpm 1200/1000"
      }
    });

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("cleans up subscriptions on dispose", () => {
    const initialSubs = (service as any).subscriptions.length;
    expect(initialSubs).toBeGreaterThan(0);
    
    service.dispose();
    expect((service as any).subscriptions.length).toBe(0);
    expect((service as any).engineDispose).toBeNull();
  });

  it("fans out autonomy events onto the global mission namespace", () => {
    const missionStateSpy = vi.fn();
    const unsubscribe = eventBus.subscribe("mission.state", missionStateSpy);

    (service as any).handleAutonomyEvent({
      type: "state",
      sessionId: "session-1",
      timestamp: "2026-03-11T00:00:00.000Z",
      payload: { state: "verify" },
    });

    expect(missionStateSpy).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops rebroadcasting budget warnings after dispose unsubscribes internal listeners", () => {
    const warningSpy = vi.fn();
    const unsubscribe = eventBus.subscribe("budget:warning", warningSpy);

    service.dispose();

    eventBus.publish("mission.budget", {
      type: "budget",
      sessionId: "session-1",
      timestamp: "2026-03-11T00:00:00.000Z",
      payload: {
        warning: true,
        warningReason: "BUDGET_WARNING: tpm 950/1000",
        exceeded: false,
        exceedReason: null,
      },
    });

    expect(warningSpy).not.toHaveBeenCalled();
    unsubscribe();
  });
});
