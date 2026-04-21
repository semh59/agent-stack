/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { installBrowserStubs } from "../tests/installBrowserStubs";

vi.mock("../utils/api", () => ({
  connectLogsWS: vi.fn(() => ({ close: vi.fn() })),
  stopPipeline: vi.fn().mockResolvedValue(undefined),
}));

const { storeState, useAppStoreMock, resetStoreState, navigateMock } = vi.hoisted(() => {
  const storeState: Record<string, any> = {};
  return {
    storeState,
    useAppStoreMock: vi.fn((selector?: (state: typeof storeState) => unknown) =>
      typeof selector === "function" ? selector(storeState) : storeState,
    ),
    resetStoreState: () => {
      Object.keys(storeState).forEach((key) => delete storeState[key]);
    },
    navigateMock: vi.fn(),
  };
});

vi.mock("../store/appStore", () => ({
  useAppStore: useAppStoreMock,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

import { ActivePipelineView } from "./ActivePipelineView";

describe("ActivePipelineView", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetStoreState();
    navigateMock.mockReset();
    Object.assign(storeState, {
      activeAccount: "agent@test.dev",
      pipelineStatus: {
        status: "running",
        state: { pipelineStatus: "running", userTask: "Ship deeper tests" },
      },
      logs: [],
      addLog: vi.fn(),
      fetchPipelineStatus: vi.fn().mockResolvedValue(undefined),
      autonomySession: {
        id: "session-1",
        state: "paused",
        objective: "Mission",
        account: "agent@test.dev",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:01:00.000Z",
        queuePosition: 1,
        branchName: null,
        baseBranch: null,
        commitHash: null,
        currentModel: "claude-opus-4-5-thinking",
        currentGear: "elite",
        reviewStatus: "plan_pending",
        reviewUpdatedAt: "2026-03-11T00:01:00.000Z",
      },
      autonomyTimeline: [
        { id: "entry-1", type: "decision", timestamp: "2026-03-11T00:00:00.000Z", message: "Paused for review" },
      ],
      gateStatus: {
        passed: false,
        blockingIssues: ["Architect review needed"],
        impactedScopes: ["ui"],
        audit: { critical: 0, high: 1, moderate: 0, low: 0, total: 1 },
      },
      budgetStatus: {
        limits: {
          maxCycles: 10,
          maxDurationMs: 60000,
          maxInputTokens: 1000,
          maxOutputTokens: 500,
          maxTPM: 1200,
          maxRPD: 20,
        },
        usage: {
          cyclesUsed: 4,
          durationMsUsed: 16000,
          inputTokensUsed: 350,
          outputTokensUsed: 140,
          currentTPM: 490,
          requestsUsed: 4,
          usdUsed: 0,
        },
        warning: true,
        warningReason: "BUDGET_WARNING: tpm 490/1200",
        exceeded: false,
        exceedReason: null,
      },
      pauseAutonomySession: vi.fn().mockResolvedValue(undefined),
      resumeAutonomySession: vi.fn().mockResolvedValue(undefined),
      stopAutonomySession: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStoreState();
  });

  it("renders timeline, gate/budget side panels, and resume/cancel controls", () => {
    render(<ActivePipelineView />);

    expect(screen.getByText("Ship deeper tests")).toBeTruthy();
    expect(screen.getByText("Paused for review")).toBeTruthy();
    expect(screen.getByText("Blocked (1)")).toBeTruthy();
    expect(screen.getByLabelText(/Faz gostergesi karti/i)).toBeTruthy();
    expect(screen.getByLabelText(/Disli durumu karti/i)).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) => element?.tagName === "P" && (element.textContent?.includes("TPM 490/1.200") ?? false),
      ),
    ).toBeTruthy();
    expect(screen.getByText("BUDGET_WARNING: tpm 490/1200")).toBeTruthy();

    fireEvent.click(screen.getByText("Devam"));
    expect(storeState.resumeAutonomySession).toHaveBeenCalledWith("Resume from active view");

    fireEvent.click(screen.getByText("Iptal"));
    expect(storeState.stopAutonomySession).toHaveBeenCalledWith("Stopped from active view");

    fireEvent.click(screen.getByText("Plan Onayi"));
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/session-1/plan");
  });
});
