/**
 * Metro Watchdog Store — Production-grade Zustand state management.
 *
 * Manages the real-time health monitoring state for all metro communication
 * lines. Supports both REST polling and SSE streaming, with automatic
 * reconnection, retry backoff, and comprehensive error handling.
 *
 * ## Architecture
 * - **REST Mode**: One-shot fetch via `fetchHealth()`
 * - **Stream Mode**: Continuous SSE via `startStream()` with auto-reconnect
 * - **Alert Management**: Acknowledge alerts with optimistic UI updates
 *
 * @module useMetroStore
 */

import { create } from 'zustand';

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

/** Session storage key for the gateway authentication token. */
const AUTH_TOKEN_KEY = 'gateway_auth_token';

/** Maximum number of SSE reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10;

/** Base delay (ms) for exponential backoff on SSE reconnection. */
const RECONNECT_BASE_DELAY_MS = 2_000;

/** Maximum reconnection delay cap (ms). */
const RECONNECT_MAX_DELAY_MS = 30_000;

/** Window property key for storing the EventSource reference. */
const SSE_REF_KEY = '__alloy_metro_sse';

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/** Unique identifier for each metro communication line. */
export type MetroLineId = 'event_bus' | 'rest_api' | 'ws_sse' | 'vscode' | 'mcp';

/** Aggregated health status of a single metro line. */
export type LineStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/** Alert severity classification. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/** Connection state for the SSE stream. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** Health report for a single communication line. */
export interface LineHealth {
  /** Identifier of the monitored line. */
  lineId: MetroLineId;
  /** Current computed health status. */
  status: LineStatus;
  /** Round-trip latency in milliseconds (-1 if check failed). */
  latencyMs: number;
  /** ISO-8601 timestamp of the last health check. */
  lastCheck: string;
  /** Human-readable status description. */
  message: string;
  /** Arbitrary diagnostic details. */
  details: Record<string, unknown>;
}

/** A structured alert raised when an anomaly is detected. */
export interface MetroAlert {
  /** Unique alert identifier. */
  id: string;
  /** Severity level. */
  severity: AlertSeverity;
  /** The metro line that triggered this alert. */
  lineId: MetroLineId;
  /** Human-readable alert description. */
  message: string;
  /** ISO-8601 timestamp when the alert was raised. */
  timestamp: string;
  /** Whether an operator has acknowledged this alert. */
  acknowledged: boolean;
}

/** Complete health snapshot of the entire metro network. */
export interface MetroHealthSnapshot {
  /** ISO-8601 timestamp when this snapshot was computed. */
  timestamp: string;
  /** Overall network health (worst-case of all lines). */
  overall: LineStatus;
  /** Per-line health reports. */
  lines: Record<MetroLineId, LineHealth>;
  /** Currently active (non-acknowledged) alerts. */
  activeAlerts: MetroAlert[];
  /** Seconds since the watchdog was started. */
  uptimeSec: number;
  /** Total number of check cycles completed. */
  cycleCount: number;
}

// ════════════════════════════════════════════════════════════════════════
// Display Metadata
// ════════════════════════════════════════════════════════════════════════

/** Display metadata for each metro line (label, emoji, color). */
export const LINE_META: Record<MetroLineId, { label: string; emoji: string; color: string }> = {
  event_bus: { label: 'Event Bus',        emoji: '🔴', color: '#ef4444' },
  rest_api:  { label: 'REST API',         emoji: '🔵', color: '#3b82f6' },
  ws_sse:    { label: 'WebSocket / SSE',  emoji: '🟢', color: '#22c55e' },
  vscode:    { label: 'VS Code Protocol', emoji: '🟡', color: '#eab308' },
  mcp:       { label: 'MCP Stdio',        emoji: '🟣', color: '#a855f7' },
} as const;

/** Display metadata for each status level (label, color, Tailwind class). */
export const STATUS_META: Record<LineStatus, { label: string; color: string; bg: string }> = {
  healthy:  { label: 'Sağlıklı',     color: '#22c55e', bg: 'bg-green-500/10' },
  degraded: { label: 'Bozuk',        color: '#eab308', bg: 'bg-yellow-500/10' },
  down:     { label: 'Çevrimdışı',   color: '#ef4444', bg: 'bg-red-500/10' },
  unknown:  { label: 'Bilinmiyor',   color: '#6b7280', bg: 'bg-gray-500/10' },
} as const;

/** Ordered list of all line IDs for consistent iteration. */
export const LINE_ORDER: readonly MetroLineId[] = [
  'event_bus', 'rest_api', 'ws_sse', 'vscode', 'mcp',
];

// ════════════════════════════════════════════════════════════════════════
// Gateway Communication
// ════════════════════════════════════════════════════════════════════════

/**
 * Resolves the gateway base URL from the current browser location.
 * Falls back to port 3000 if no port is detected.
 */
function resolveGatewayBase(): string {
  const port = window.location.port || '3000';
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

/** Cached gateway base URL (computed once on module load). */
const GATEWAY_BASE = resolveGatewayBase();

/**
 * Reads the authentication token from session storage.
 * Used for authenticating API requests.
 */
function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Computes the exponential backoff delay for SSE reconnection.
 *
 * @param attempt - The current reconnection attempt number (0-indexed).
 * @returns The delay in milliseconds before the next attempt.
 */
function computeBackoffDelay(attempt: number): number {
  const exponentialDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // Add up to 1s of jitter
  return Math.min(exponentialDelay + jitter, RECONNECT_MAX_DELAY_MS);
}

// ════════════════════════════════════════════════════════════════════════
// Store Interface
// ════════════════════════════════════════════════════════════════════════

/** State and actions for the Metro Watchdog store. */
interface MetroState {
  // ─── State ──────────────────────────────────────────────────────

  /** Most recently received health snapshot (null if not yet loaded). */
  snapshot: MetroHealthSnapshot | null;
  /** Whether a REST fetch is in progress. */
  isLoading: boolean;
  /** Last error message (null if no error). */
  error: string | null;
  /** Current SSE connection state. */
  connectionState: ConnectionState;
  /** Number of consecutive SSE reconnection attempts. */
  reconnectAttempts: number;
  /** Timestamp of the last successful snapshot received. */
  lastUpdate: string | null;

  // ─── Actions ────────────────────────────────────────────────────

  /** Fetches a single health snapshot via REST. */
  fetchHealth: () => Promise<void>;
  /** Opens an SSE stream for continuous updates. */
  startStream: () => void;
  /** Closes the SSE stream and resets connection state. */
  stopStream: () => void;
  /** Acknowledges an alert by ID and refreshes the snapshot. */
  acknowledgeAlert: (alertId: string) => Promise<void>;
  /** Resets the store to its initial state. */
  reset: () => void;
}

// ════════════════════════════════════════════════════════════════════════
// Store Implementation
// ════════════════════════════════════════════════════════════════════════

/** Initial state values for reset. */
const INITIAL_STATE = {
  snapshot: null as MetroHealthSnapshot | null,
  isLoading: false,
  error: null as string | null,
  connectionState: 'disconnected' as ConnectionState,
  reconnectAttempts: 0,
  lastUpdate: null as string | null,
};

export const useMetroStore = create<MetroState>((set, get) => ({
  ...INITIAL_STATE,

  // ═══════════════════════════════════════════════════════════════════
  // REST Health Fetch
  // ═══════════════════════════════════════════════════════════════════

  fetchHealth: async () => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(`${GATEWAY_BASE}/api/metro/health`, {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Gateway responded with HTTP ${response.status}`);
      }

      const json = await response.json();
      // API wraps data in { success: true, data: ... }
      const snapshot = (json.data ?? json) as MetroHealthSnapshot;

      set({
        snapshot,
        isLoading: false,
        lastUpdate: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // SSE Streaming
  // ═══════════════════════════════════════════════════════════════════

  startStream: () => {
    const currentState = get().connectionState;
    if (currentState === 'connected' || currentState === 'connecting' || currentState === 'reconnecting') {
      return; // Already streaming or attempting to connect
    }

    set({ connectionState: 'connecting', error: null });

    const token = sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
    const url = `${GATEWAY_BASE}/api/metro/health/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      set({ connectionState: 'connected', reconnectAttempts: 0, error: null });
    };

    eventSource.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as MetroHealthSnapshot;
        set({
          snapshot,
          isLoading: false,
          lastUpdate: new Date().toISOString(),
        });
      } catch {
        // Silently ignore malformed SSE data frames
      }
    };

    eventSource.onerror = () => {
      eventSource.close();

      const state = get();
      const attempts = state.reconnectAttempts + 1;

      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        set({
          connectionState: 'failed',
          error: `SSE bağlantısı ${MAX_RECONNECT_ATTEMPTS} deneme sonrasında kesildi`,
          reconnectAttempts: attempts,
        });
        return;
      }

      set({
        connectionState: 'reconnecting',
        error: 'SSE bağlantısı kesildi — yeniden bağlanılıyor...',
        reconnectAttempts: attempts,
      });

      // Schedule reconnection with exponential backoff + jitter
      const delay = computeBackoffDelay(attempts - 1);
      setTimeout(() => {
        const current = get();
        if (current.connectionState === 'reconnecting' || current.connectionState === 'failed') {
          get().startStream();
        }
      }, delay);
    };

    // Store the EventSource reference on window for cleanup
    (window as unknown as Record<string, unknown>)[SSE_REF_KEY] = eventSource;
  },

  stopStream: () => {
    const sseRef = (window as unknown as Record<string, unknown>)[SSE_REF_KEY] as EventSource | undefined;
    if (sseRef) {
      sseRef.close();
      delete (window as unknown as Record<string, unknown>)[SSE_REF_KEY];
    }
    set({ connectionState: 'disconnected', reconnectAttempts: 0 });
  },

  // ═══════════════════════════════════════════════════════════════════
  // Alert Management
  // ═══════════════════════════════════════════════════════════════════

  acknowledgeAlert: async (alertId: string) => {
    const currentSnapshot = get().snapshot;

    // Optimistic update: immediately mark the alert as acknowledged in the UI
    if (currentSnapshot) {
      const updatedAlerts = currentSnapshot.activeAlerts.map((alert) =>
        alert.id === alertId ? { ...alert, acknowledged: true } : alert,
      );
      set({
        snapshot: { ...currentSnapshot, activeAlerts: updatedAlerts },
      });
    }

    try {
      const response = await fetch(`${GATEWAY_BASE}/api/metro/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        throw new Error(`Acknowledge failed with HTTP ${response.status}`);
      }

      // Refresh snapshot to get server-confirmed state
      await get().fetchHealth();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      // Revert optimistic update by re-fetching
      await get().fetchHealth();
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Reset
  // ═══════════════════════════════════════════════════════════════════

  reset: () => {
    get().stopStream();
    set(INITIAL_STATE);
  },
}));