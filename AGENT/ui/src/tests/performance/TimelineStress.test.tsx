/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installBrowserStubs } from "../installBrowserStubs";

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

vi.mock("../../store/appStore", () => ({
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

vi.mock("../../components/dashboard/TokenUsageChart", () => ({
  TokenUsageChart: ({ sessionId }: { sessionId: string }) => <div data-testid="token-chart">{sessionId}</div>,
}));

vi.mock("../../components/telemetry/DecisionMatrix", () => ({
  DecisionMatrix: ({ sessionId }: { sessionId: string }) => <div data-testid="decision-matrix">{sessionId}</div>,
}));

import { DashboardView } from "../../pages/DashboardView";

function createTimelineEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    type: index % 7 === 0 ? "success" : "tool",
    timestamp: new Date(Date.UTC(2026, 2, 11, 0, 0, index)).toISOString(),
    message: `Timeline event ${index}`,
  }));
}

describe("Timeline Performance Stress Test", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetStoreState();
    navigateMock.mockReset();
    Object.assign(storeState, {
      startAutonomySession: vi.fn(),
      pipelineStatus: {
        status: "running",
        state: { pipelineStatus: "running", userTask: "Stress timeline" },
        completedCount: 12,
        totalAgents: 50,
      },
      autonomySession: {
        id: "stress-session",
        state: "execute",
        objective: "Stress timeline",
        account: "agent@test.dev",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:01:00.000Z",
        queuePosition: null,
        branchName: null,
        baseBranch: null,
        commitHash: null,
        currentModel: "gemini-3-pro-high",
        currentGear: "elite",
        reviewStatus: "none",
        reviewUpdatedAt: null,
      },
      autonomyTimeline: createTimelineEntries(5000),
      models: [{ id: "gemini-3-pro-high", name: "Gemini 3 Pro", provider: "Google", status: "active" }],
      accountQuotas: [],
      activeAccount: "agent@test.dev",
      selectedModelId: "gemini-3-pro-high",
      selectedMode: "smart_multi",
      activeSessionId: "stress-session",
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

  it("mounts the virtualized timeline and renders only a visible window", async () => {
    const { container } = render(<DashboardView />);
    const scrollRegion = container.querySelector(".custom-scrollbar") as HTMLDivElement;
    expect(scrollRegion).toBeTruthy();

    Object.defineProperty(scrollRegion, "clientHeight", { configurable: true, value: 360 });
    Object.defineProperty(scrollRegion, "scrollHeight", { configurable: true, value: 5000 * 36 });
    Object.defineProperty(scrollRegion, "scrollTop", { configurable: true, writable: true, value: 0 });

    await waitFor(() => {
      const renderedItems = container.querySelectorAll(".timeline-item-enter");
      expect(renderedItems.length).toBeGreaterThan(0);
      expect(renderedItems.length).toBeLessThan(80);
    });

    scrollRegion.scrollTop = 4200;
    fireEvent.scroll(scrollRegion);

    await waitFor(() => {
      expect(screen.queryAllByText(/Timeline event 11\d/).length).toBeGreaterThan(0);
    });
  });
});
