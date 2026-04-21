/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
}));

vi.mock("@tanstack/react-virtual", async () => {
  const React = await import("react");
  return {
    useVirtualizer: ({
      count,
      getScrollElement,
      estimateSize,
      overscan,
    }: {
      count: number;
      getScrollElement: () => HTMLElement | null;
      estimateSize: () => number;
      overscan: number;
    }) => {
      const [scrollTop, setScrollTop] = React.useState(0);
      React.useEffect(() => {
        const element = getScrollElement();
        if (!element) return;
        const onScroll = () => setScrollTop(element.scrollTop);
        element.addEventListener("scroll", onScroll);
        return () => element.removeEventListener("scroll", onScroll);
      });

      const itemSize = estimateSize();
      const visibleWindow = 10;
      const start = Math.max(0, Math.floor(scrollTop / itemSize) - overscan);
      const end = Math.min(count, start + visibleWindow + overscan * 2);

      return {
        getTotalSize: () => count * itemSize,
        getVirtualItems: () =>
          Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
            const index = start + offset;
            return {
              index,
              size: itemSize,
              start: index * itemSize,
            };
          }),
      };
    },
  };
});

vi.mock("../components/dashboard/TokenUsageChart", () => ({
  TokenUsageChart: () => <div data-testid="token-chart">token chart</div>,
}));

vi.mock("../components/telemetry/DecisionMatrix", () => ({
  DecisionMatrix: () => <div data-testid="decision-matrix">decision matrix</div>,
}));

import { DashboardView } from "./DashboardView";

describe("DashboardView", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetStoreState();
    navigateMock.mockReset();
    Object.assign(storeState, {
      startAutonomySession: vi.fn().mockResolvedValue(undefined),
      pipelineStatus: { status: "idle" },
      autonomySession: null,
      autonomyTimeline: [],
      models: [{ id: "gemini-3-pro-high", name: "Gemini 3 Pro", provider: "Google", status: "active" }],
      accountQuotas: [],
      activeAccount: "agent@test.dev",
      selectedModelId: "gemini-3-pro-high",
      selectedMode: "smart_multi",
      activeSessionId: null,
      fetchQuota: vi.fn(),
      fetchModels: vi.fn(),
      setSelectedModel: vi.fn(),
      setSelectedMode: vi.fn(),
      setLastError: vi.fn(),
      stopAutonomySession: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStoreState();
  });

  it("submits the prompt with Ctrl+Enter when idle", async () => {
    const user = userEvent.setup();
    render(<DashboardView />);

    const textarea = screen.getByPlaceholderText(/parametrelerini girin/i) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    await user.type(textarea, "Audit the reconnect path");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(storeState.startAutonomySession).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "agent@test.dev",
        anchorModel: "gemini-3-pro-high",
        objective: "Audit the reconnect path",
        reviewAfterPlan: true,
        startMode: "immediate",
      }),
    );
  });

  it("sends stop on Escape while a mission is running", async () => {
    Object.assign(storeState, {
      autonomySession: {
        id: "session-1",
        state: "execute",
        objective: "Audit",
        account: "agent@test.dev",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
        queuePosition: null,
        branchName: null,
        baseBranch: null,
        commitHash: null,
        currentModel: "gemini-3-pro-high",
        currentGear: "elite",
        reviewStatus: "none",
        reviewUpdatedAt: null,
      },
      pipelineStatus: { status: "running", state: { pipelineStatus: "running", userTask: "Audit" } },
      activeSessionId: "session-1",
      autonomyTimeline: [
        {
          id: "t-1",
          type: "tool",
          timestamp: "2026-03-11T00:00:00.000Z",
          message: "Step 1",
        },
      ],
    });

    const user = userEvent.setup();
    render(<DashboardView />);
    await user.keyboard("{Escape}");

    expect(storeState.stopAutonomySession).toHaveBeenCalledWith("User requested stop via UI shortcut");
  });

  it("clears the draft with Escape while idle", async () => {
    const user = userEvent.setup();
    render(<DashboardView />);

    const textarea = screen.getByPlaceholderText(/parametrelerini girin/i) as HTMLTextAreaElement;
    await user.type(textarea, "Temporary draft");
    await user.keyboard("{Escape}");

    expect(textarea.value).toBe("");
  });

  it("renders explicit phase and gear cards plus a plan review CTA when review is pending", async () => {
    Object.assign(storeState, {
      autonomySession: {
        id: "session-9",
        state: "paused",
        objective: "Review my plan",
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
      activeSessionId: "session-9",
      autonomyTimeline: [
        {
          id: "timeline-1",
          type: "step",
          timestamp: "2026-03-11T00:00:00.000Z",
          message: "Awaiting approval",
        },
      ],
    });

    const user = userEvent.setup();
    render(<DashboardView />);

    expect(screen.getByLabelText(/Faz gostergesi karti/i)).toBeTruthy();
    expect(screen.getByLabelText(/Disli durumu karti/i)).toBeTruthy();
    expect(screen.getByText(/Plan Onayi Bekliyor/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Incele/i }));
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/session-9/plan");
  });
});
