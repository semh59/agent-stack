/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { installBrowserStubs } from "../tests/installBrowserStubs";

const { storeState, useAppStoreMock, resetStoreState } = vi.hoisted(() => {
  const storeState: Record<string, any> = {};
  return {
    storeState,
    useAppStoreMock: vi.fn((selector?: (state: typeof storeState) => unknown) =>
      typeof selector === "function" ? selector(storeState) : storeState,
    ),
    resetStoreState: () => {
      Object.keys(storeState).forEach((key) => delete storeState[key]);
    },
  };
});

vi.mock("../store/appStore", () => ({
  useAppStore: useAppStoreMock,
}));

import { PipelineHistoryView } from "./PipelineHistoryView";

describe("PipelineHistoryView", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetStoreState();
    Object.assign(storeState, {
      sessionOrder: ["session-1", "session-2"],
      activeSessionId: "session-2",
      selectAutonomySession: vi.fn(),
      sessionsById: {
        "session-1": {
          id: "session-1",
          state: "verify",
          objective: "Audit reconnect flow",
          account: "agent-1@test.dev",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:05:00.000Z",
          queuePosition: 1,
          branchName: null,
          baseBranch: null,
          commitHash: null,
          currentModel: "gemini-3-pro-high",
          currentGear: "elite",
          reviewStatus: "none",
          reviewUpdatedAt: null,
        },
        "session-2": {
          id: "session-2",
          state: "done",
          objective: "Budget recalibration",
          account: "agent-2@test.dev",
          createdAt: "2026-03-10T22:00:00.000Z",
          updatedAt: "2026-03-10T22:05:00.000Z",
          queuePosition: 2,
          branchName: "feat/budget",
          baseBranch: "main",
          commitHash: "abc123",
          currentModel: "claude-opus-4-5-thinking",
          currentGear: "elite",
          reviewStatus: "approved",
          reviewUpdatedAt: "2026-03-10T22:01:00.000Z",
        },
      },
      timelineBySession: {
        "session-2": [
          {
            id: "entry-2",
            type: "decision",
            timestamp: "2026-03-10T22:03:00.000Z",
            message: "Budget widget updated",
          },
        ],
      },
      diffBySession: {
        "session-2": ["src/orchestration/BudgetTracker.ts", "ui/src/components/dashboard/TokenUsageChart.tsx"],
      },
      gateBySession: {
        "session-2": {
          passed: false,
          blockingIssues: ["Needs TPM window validation"],
          impactedScopes: ["root", "ui"],
          audit: { critical: 0, high: 1, moderate: 1, low: 0, total: 2 },
        },
      },
      fetchAutonomySessions: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStoreState();
  });

  it("filters sessions, invokes selection, and shows artifacts/gate details", () => {
    render(<PipelineHistoryView />);

    fireEvent.change(screen.getByPlaceholderText("Search sessions..."), {
      target: { value: "Budget" },
    });
    expect(screen.queryByRole("button", { name: /Audit reconnect flow/i })).toBeNull();

    fireEvent.click(screen.getAllByText("Budget recalibration")[0]!);
    expect(storeState.selectAutonomySession).toHaveBeenCalledWith("session-2");

    fireEvent.click(screen.getByText("Artifacts"));
    expect(screen.getByText("src/orchestration/BudgetTracker.ts")).toBeTruthy();
    expect(screen.getByText("ui/src/components/dashboard/TokenUsageChart.tsx")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Needs TPM window validation")).toBeTruthy();
  });
});
