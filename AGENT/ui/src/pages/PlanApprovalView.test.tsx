/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installBrowserStubs } from "../tests/installBrowserStubs";

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
  useParams: () => ({ id: "session-1" }),
}));

import { PlanApprovalView } from "./PlanApprovalView";

const structuredPlan = `# Plan Review

## Objective
Deep audit remaining phase work.

## Scope
- src
- ui

## Current Phase
plan

## Current Model
claude-opus-4-5-thinking

## Proposed Steps
- Inspect contract drift.
- Approve before execute.

## Expected Touch Points
- src/orchestration
- ui/src/pages

## Risks / Gate Expectations
- Strict gate validation remains enabled.

## Next Action
Await approval.`;

function renderPage() {
  return render(<PlanApprovalView />);
}

describe("PlanApprovalView", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetStoreState();
    navigateMock.mockReset();
    Object.assign(storeState, {
      gatewayToken: "gateway-token",
      activeAccount: "agent@test.dev",
      sessionsById: {
        "session-1": {
          id: "session-1",
          state: "paused",
          objective: "Review current plan",
          account: "agent@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:10:00.000Z",
          queuePosition: null,
          branchName: null,
          baseBranch: null,
          commitHash: null,
          currentModel: "claude-opus-4-5-thinking",
          currentGear: "elite",
          reviewStatus: "plan_pending",
          reviewUpdatedAt: "2026-03-11T00:10:00.000Z",
        },
      },
      planArtifactsBySession: {
        "session-1": {
          plan: structuredPlan,
          changeSummary: "summary",
          nextActionReason: "Await approval",
          gateResult: {
            passed: false,
            blockingIssues: ["Awaiting architect approval"],
            impactedScopes: ["ui"],
            audit: { critical: 0, high: 1, moderate: 0, low: 0, total: 1 },
          },
          rawResponses: [],
          contextPack: "ctx",
        },
      },
      budgetBySession: {
        "session-1": {
          limits: {
            maxCycles: 10,
            maxDurationMs: 60000,
            maxInputTokens: 1000,
            maxOutputTokens: 500,
            maxTPM: 1200,
            maxRPD: 20,
          },
          usage: {
            cyclesUsed: 2,
            durationMsUsed: 10000,
            inputTokensUsed: 200,
            outputTokensUsed: 120,
            currentTPM: 400,
            requestsUsed: 2,
            usdUsed: 0,
          },
          warning: false,
          warningReason: null,
          exceeded: false,
          exceedReason: null,
        },
      },
      gateBySession: {
        "session-1": {
          passed: false,
          blockingIssues: ["Awaiting architect approval"],
          impactedScopes: ["ui"],
          audit: { critical: 0, high: 1, moderate: 0, low: 0, total: 1 },
        },
      },
      diffBySession: {
        "session-1": ["ui/src/pages/PlanApprovalView.tsx"],
      },
      selectAutonomySession: vi.fn(),
      fetchAutonomySessionDetail: vi.fn().mockResolvedValue(undefined),
      fetchAutonomyArtifacts: vi.fn().mockResolvedValue(undefined),
      approveAutonomyPlan: vi.fn().mockResolvedValue(undefined),
      rejectAutonomyPlan: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStoreState();
  });

  it("renders structured plan sections and approves the plan", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Plan Summary")).toBeTruthy();
    });

    expect(screen.getByText("Objective")).toBeTruthy();
    expect(screen.getByText("Current Model")).toBeTruthy();
    expect(screen.getByText(/Deep audit remaining phase work/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Approve/i }));
    expect(storeState.approveAutonomyPlan).toHaveBeenCalledWith("session-1");
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/session-1");
  });

  it("falls back to raw plan text and rejects the plan", async () => {
    storeState.planArtifactsBySession["session-1"].plan = "raw plan fallback";
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/raw plan fallback/i)).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: /Reject/i }));
    expect(storeState.rejectAutonomyPlan).toHaveBeenCalledWith("session-1", "Plan rejected from review screen");
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/history");
  });

  it("supports back flow without mutating the mission", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: /Back/i }));
    expect(storeState.approveAutonomyPlan).not.toHaveBeenCalled();
    expect(storeState.rejectAutonomyPlan).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/session-1");
  });

  it("shows auth missing state when neither token nor active account exists", () => {
    storeState.gatewayToken = null;
    storeState.activeAccount = null;

    renderPage();
    expect(screen.getByText(/auth olmadan kullanilamaz/i)).toBeTruthy();
  });
});
