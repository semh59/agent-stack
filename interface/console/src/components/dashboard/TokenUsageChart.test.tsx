/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { installBrowserStubs } from "../../tests/installBrowserStubs";

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

vi.mock("../../store/appStore", () => ({
  useAppStore: useAppStoreMock,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="responsive">{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div data-testid="chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

import { TokenUsageChart } from "./TokenUsageChart";

describe("TokenUsageChart", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetStoreState();
    Object.assign(storeState, {
      analyticsBySession: {},
      budgetBySession: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStoreState();
  });

  it("renders TPM, RPD, and token velocity metrics from the store contract", () => {
    Object.assign(storeState, {
      analyticsBySession: {
        "session-1": {
          tokenVelocity: 42,
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
            cyclesUsed: 3,
            durationMsUsed: 8000,
            inputTokensUsed: 700,
            outputTokensUsed: 180,
            currentTPM: 880,
            requestsUsed: 6,
            usdUsed: 0,
          },
          warning: true,
          warningReason: "BUDGET_WARNING: tpm 880/1200",
          exceeded: false,
          exceedReason: null,
        },
      },
    });

    render(<TokenUsageChart sessionId="session-1" />);

    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "880 / 1.200")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "6 / 20")).toBeTruthy();
    expect(screen.getByTestId("chart")).toBeTruthy();
  });
});
