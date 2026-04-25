import { vi } from "vitest";
import { useAppStore } from "../store/appStore";
import type { AppState } from "../store/types";

const initialState = useAppStore.getState();

export function resetAppStore(): void {
  useAppStore.setState({ ...initialState }, true);
  window.localStorage.clear();
  window.sessionStorage.clear();
}

export function seedAppStore(partial: Partial<AppState>): void {
  useAppStore.setState({ ...useAppStore.getState(), ...partial });
}

export function installBrowserStubs(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => window.clearTimeout(id)));

  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
}

export async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
