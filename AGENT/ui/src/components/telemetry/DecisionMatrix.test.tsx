/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

import { DecisionMatrix } from "./DecisionMatrix";

describe("DecisionMatrix", () => {
  beforeEach(() => {
    installBrowserStubs();
    resetStoreState();
    Object.assign(storeState, {
      timelineBySession: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStoreState();
  });

  it("shows only the latest three decision nodes with confidence data", () => {
    Object.assign(storeState, {
      timelineBySession: {
        "session-1": [
          {
            id: "d-1",
            type: "decision",
            timestamp: "2026-03-11T00:00:01.000Z",
            message: "Oldest",
            payload: { strategy: "PLAN", reason: "Oldest reason", confidence: 0.51 },
          },
          {
            id: "d-2",
            type: "decision",
            timestamp: "2026-03-11T00:00:02.000Z",
            message: "Middle",
            payload: { strategy: "VERIFY", reason: "Middle reason", confidence: 0.73 },
          },
          {
            id: "d-3",
            type: "decision",
            timestamp: "2026-03-11T00:00:03.000Z",
            message: "Recent",
            payload: { strategy: "RECOVERY", reason: "Recent reason", confidence: 0.84 },
          },
          {
            id: "d-4",
            type: "decision",
            timestamp: "2026-03-11T00:00:04.000Z",
            message: "Newest",
            payload: { strategy: "PATCH", reason: "Newest reason", confidence: 0.91 },
          },
        ],
      },
    });

    render(<DecisionMatrix sessionId="session-1" />);

    expect(screen.queryByText("Oldest reason")).toBeNull();
    expect(screen.getByText("Newest reason")).toBeTruthy();
    expect(screen.getByText("Recent reason")).toBeTruthy();
    expect(screen.getByText("Middle reason")).toBeTruthy();
    expect(screen.getByText("91%")).toBeTruthy();
    expect(screen.getByText("PATCH")).toBeTruthy();
  });
});
