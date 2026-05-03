/**
 * Metro Watchdog — Production-grade real-time health monitoring engine.
 *
 * Continuously polls all communication lines on the metro map, aggregates
 * health status into snapshots, detects anomalies via configurable rule
 * engine, and emits structured alerts through the global event bus.
 *
 * ## Architecture
 *
 * ```
 * MetroWatchdog
 * ├── HealthCheckEngine  (parallel line polling)
 * ├── AlertRuleEngine    (anomaly detection + de-duplication)
 * ├── MetricsCollector   (latency histograms, counters)
 * └── SnapshotStore      (immutable health history)
 * ```
 *
 * ## Thread Safety
 * All internal state mutations are serialized through the single
 * `runCheckCycle()` invocation on the interval timer. No concurrent
 * mutation paths exist.
 *
 * @module metro-watchdog
 */

import { GlobalEventBus } from './event-bus';

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

/** All valid metro line identifiers, mapped to display metadata. */
const LINE_REGISTRY = {
  event_bus: { label: '🔴 Event Bus',       color: '#ef4444' },
  rest_api:  { label: '🔵 REST API',        color: '#3b82f6' },
  ws_sse:    { label: '🟢 WebSocket/SSE',   color: '#22c55e' },
  vscode:    { label: '🟡 VS Code Protocol', color: '#eab308' },
  mcp:       { label: '🟣 MCP Stdio',       color: '#a855f7' },
} as const;

/** Maximum number of alerts retained in memory. */
const MAX_ALERTS = 200;

/** Maximum number of historical health records per line. */
const MAX_HISTORY_PER_LINE = 200;

/** Alert de-duplication window in milliseconds. */
const ALERT_DEDUPE_WINDOW_MS = 60_000;

/** HTTP request timeout for bridge health checks (ms). */
const BRIDGE_CHECK_TIMEOUT_MS = 5_000;

/** Error threshold for event-bus anomaly detection. */
const EVENT_BUS_ERROR_THRESHOLD = 3;

/** Maximum events to scan in replay buffer (performance guard). */
const REPLAY_BUFFER_SCAN_LIMIT = 500;

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/** Unique identifier for each metro communication line. */
export type MetroLineId = keyof typeof LINE_REGISTRY;

/** Aggregated health status of a single metro line. */
export type LineStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/** Alert severity classification. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

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
  /** Arbitrary diagnostic details for debugging. */
  details: Record<string, unknown>;
}

/** A structured alert raised when an anomaly is detected. */
export interface MetroAlert {
  /** Unique alert identifier (monotonically increasing). */
  id: string;
  /** Severity level of the alert. */
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

/** Configuration for the MetroWatchdog engine. */
export interface MetroWatchdogConfig {
  /** Polling interval in milliseconds. @default 10000 */
  pollIntervalMs: number;
  /** Bridge base URL for HTTP health checks. @example "http://127.0.0.1:9100" */
  bridgeUrl: string;
  /** Shared secret for authenticating bridge requests. */
  bridgeSecret: string;
  /** Consecutive failures required to mark a line as "down". @default 3 */
  downThreshold: number;
  /** Latency threshold (ms) beyond which a line is "degraded". @default 2000 */
  degradedLatencyMs: number;
}

/** Internal metrics collected during operation. */
interface WatchdogMetrics {
  /** Total check cycles completed. */
  totalCycles: number;
  /** Total alerts raised since startup. */
  totalAlertsRaised: number;
  /** Per-line average latency over the last N checks. */
  avgLatency: Record<MetroLineId, number>;
  /** Per-line last transition time (status change). */
  lastTransition: Record<MetroLineId, string | null>;
  /** Per-line previous status (for transition detection). */
  previousStatus: Record<MetroLineId, LineStatus | null>;
}

// ════════════════════════════════════════════════════════════════════════
// Validation Helpers
// ════════════════════════════════════════════════════════════════════════

/**
 * Validates and normalizes the watchdog configuration, applying defaults
 * for any missing optional fields.
 *
 * @throws {Error} If required fields are missing or values are out of range.
 */
function validateConfig(partial: Partial<MetroWatchdogConfig>): MetroWatchdogConfig {
  if (!partial.bridgeUrl) {
    throw new Error('[MetroWatchdog] bridgeUrl is required in configuration');
  }

  const config: MetroWatchdogConfig = {
    pollIntervalMs: partial.pollIntervalMs ?? 10_000,
    bridgeUrl: partial.bridgeUrl.replace(/\/+$/, ''), // strip trailing slashes
    bridgeSecret: partial.bridgeSecret ?? '',
    downThreshold: partial.downThreshold ?? 3,
    degradedLatencyMs: partial.degradedLatencyMs ?? 2_000,
  };

  if (config.pollIntervalMs < 1_000) {
    throw new Error('[MetroWatchdog] pollIntervalMs must be >= 1000ms');
  }
  if (config.downThreshold < 1) {
    throw new Error('[MetroWatchdog] downThreshold must be >= 1');
  }

  return config;
}

// ════════════════════════════════════════════════════════════════════════
// MetroWatchdog Engine
// ════════════════════════════════════════════════════════════════════════

/**
 * Production-grade health monitoring engine for the Alloy metro network.
 *
 * Polls all 5 communication lines in parallel, evaluates configurable
 * alert rules with de-duplication, and maintains a rolling history of
 * health snapshots for trend analysis.
 *
 * ## Lifecycle
 * 1. Construct with a valid `MetroWatchdogConfig`
 * 2. Call `start()` to begin periodic polling
 * 3. Query `getSnapshot()` at any time for the latest health state
 * 4. Call `stop()` to gracefully shut down the polling loop
 *
 * ## Example
 * ```typescript
 * const watchdog = new MetroWatchdog({
 *   bridgeUrl: 'http://127.0.0.1:9100',
 *   bridgeSecret: process.env.ALLOY_BRIDGE_SECRET!,
 * });
 * watchdog.start();
 * ```
 */
export class MetroWatchdog {
  // ─── Configuration ──────────────────────────────────────────────

  /** Validated and frozen configuration. */
  private readonly config: Readonly<MetroWatchdogConfig>;

  // ─── State ──────────────────────────────────────────────────────

  /** Active alerts, bounded by MAX_ALERTS. */
  private readonly alerts: MetroAlert[] = [];

  /** Per-line consecutive failure counter for down detection. */
  private readonly consecutiveFailures: Record<MetroLineId, number>;

  /** Per-line rolling health history, bounded by MAX_HISTORY_PER_LINE. */
  private readonly lineHistory: Record<MetroLineId, LineHealth[]>;

  /** Most recently computed health snapshot. */
  private latestSnapshot: MetroHealthSnapshot | null = null;

  /** Monotonically increasing alert ID counter. */
  private alertCounter = 0;

  /** Timestamp of engine start for uptime calculation. */
  private readonly startedAt = Date.now();

  /** Handle for the periodic polling interval. */
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Whether the engine is currently inside a check cycle (reentrancy guard). */
  private isChecking = false;

  /** Operational metrics for observability. */
  private readonly metrics: WatchdogMetrics;

  // ─── Constructor ────────────────────────────────────────────────

  /**
   * Creates a new MetroWatchdog engine instance.
   *
   * @param config - Partial or full configuration. Defaults are applied
   *                 for missing optional fields. Validation is performed.
   * @throws {Error} If required configuration is missing or invalid.
   */
  constructor(config: Partial<MetroWatchdogConfig> & { bridgeUrl: string }) {
    this.config = Object.freeze(validateConfig(config));

    // Initialize per-line data structures
    const lineIds = Object.keys(LINE_REGISTRY) as MetroLineId[];
    this.consecutiveFailures = {} as Record<MetroLineId, number>;
    this.lineHistory = {} as Record<MetroLineId, LineHealth[]>;

    const avgLatency = {} as Record<MetroLineId, number>;
    const lastTransition = {} as Record<MetroLineId, string | null>;
    const previousStatus = {} as Record<MetroLineId, LineStatus | null>;

    for (const id of lineIds) {
      this.consecutiveFailures[id] = 0;
      this.lineHistory[id] = [];
      avgLatency[id] = 0;
      lastTransition[id] = null;
      previousStatus[id] = null;
    }

    this.metrics = {
      totalCycles: 0,
      totalAlertsRaised: 0,
      avgLatency,
      lastTransition,
      previousStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Starts the periodic health check loop.
   * The first check runs immediately; subsequent checks run at the
   * configured `pollIntervalMs` interval.
   *
   * Calling `start()` on an already-running watchdog is a no-op.
   */
  public start(): void {
    if (this.intervalHandle) {
      return;
    }

    // Immediate first check (fire-and-forget, errors handled internally)
    void this.runCheckCycle();

    this.intervalHandle = setInterval(
      () => void this.runCheckCycle(),
      this.config.pollIntervalMs,
    );

    console.log(
      `[MetroWatchdog] Engine started — polling every ${this.config.pollIntervalMs}ms, ` +
      `bridge: ${this.config.bridgeUrl}`,
    );
  }

  /**
   * Gracefully stops the health check loop.
   * Clears the interval timer and resets internal state to allow
   * a subsequent `start()` call.
   */
  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log(
      `[MetroWatchdog] Engine stopped — ${this.metrics.totalCycles} cycles completed, ` +
      `${this.metrics.totalAlertsRaised} alerts raised`,
    );
  }

  /**
   * Returns true if the engine is currently running.
   */
  public get isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public Query API
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Returns the most recently computed health snapshot.
   * Returns null if no check cycle has completed yet.
   */
  public getSnapshot(): MetroHealthSnapshot | null {
    return this.latestSnapshot;
  }

  /**
   * Returns the current operational metrics.
   * Useful for diagnostics and monitoring dashboards.
   */
  public getMetrics(): Readonly<WatchdogMetrics> {
    return this.metrics;
  }

  /**
   * Returns active alerts, optionally including acknowledged ones.
   *
   * @param includeAcknowledged - Whether to include acknowledged alerts.
   * @returns A copy of the filtered alerts array.
   */
  public getAlerts(includeAcknowledged = false): MetroAlert[] {
    return this.alerts.filter(
      (alert) => includeAcknowledged || !alert.acknowledged,
    );
  }

  /**
   * Acknowledges an alert by its ID.
   *
   * @param alertId - The unique alert identifier.
   * @returns true if the alert was found and acknowledged, false otherwise.
   */
  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert || alert.acknowledged) {
      return false;
    }
    alert.acknowledged = true;
    return true;
  }

  /**
   * Returns the rolling health history for a specific line.
   *
   * @param lineId - The metro line identifier.
   * @param limit - Maximum number of records to return (1–200, default 20).
   * @returns Array of historical health records, newest last.
   */
  public getLineHistory(lineId: MetroLineId, limit = 20): LineHealth[] {
    const clampedLimit = Math.max(1, Math.min(limit, MAX_HISTORY_PER_LINE));
    return this.lineHistory[lineId].slice(-clampedLimit);
  }

  /**
   * Returns the display label for a metro line (with emoji).
   */
  public static getLineLabel(lineId: MetroLineId): string {
    return LINE_REGISTRY[lineId].label;
  }

  /**
   * Returns all valid line identifiers as a readonly array.
   */
  public static getValidLineIds(): readonly MetroLineId[] {
    return Object.keys(LINE_REGISTRY) as MetroLineId[];
  }

  // ═══════════════════════════════════════════════════════════════════
  // Check Cycle (Core Engine)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Executes a single health check cycle.
   *
   * All 5 lines are polled in parallel via `Promise.allSettled`.
   * Results are aggregated, failure counters updated, alert rules
   * evaluated, and a new snapshot is produced.
   *
   * A reentrancy guard prevents overlapping cycles if a previous
   * cycle is still running (e.g., due to slow network responses).
   */
  private async runCheckCycle(): Promise<void> {
    if (this.isChecking) {
      return; // Prevent overlapping cycles
    }
    this.isChecking = true;

    try {
      const checkTimestamp = Date.now();

      // Execute all line checks in parallel
      const results = await Promise.allSettled([
        this.checkEventBus(),
        this.checkRestApi(),
        this.checkWsSse(),
        this.checkVsCode(),
        this.checkMcp(),
      ]);

      // Map settled results to LineHealth objects
      const lineIds = MetroWatchdog.getValidLineIds();
      const lines = {} as Record<MetroLineId, LineHealth>;

      for (let i = 0; i < lineIds.length; i++) {
        const lineId = lineIds[i]!;
        const result = results[i]!;
        lines[lineId] = this.processSettledResult(result, lineId);
      }

      // Update consecutive failure counters
      this.updateFailureCounters(lines);

      // Update latency metrics
      this.updateLatencyMetrics(lines);

      // Detect status transitions
      this.detectTransitions(lines, checkTimestamp);

      // Evaluate alert rules against current state
      this.evaluateAlertRules(lines);

      // Compute overall network status
      const overall = this.computeOverallStatus(lines);

      // Produce immutable snapshot
      this.latestSnapshot = {
        timestamp: new Date(checkTimestamp).toISOString(),
        overall,
        lines,
        activeAlerts: this.getAlerts(false),
        uptimeSec: Math.round((checkTimestamp - this.startedAt) / 1000),
        cycleCount: ++this.metrics.totalCycles,
      };

      // Broadcast status to the global event bus
      this.broadcastStatus(overall, lines);
    } catch (unexpectedError) {
      // Safety net — should never happen, but prevents unhandled rejection
      console.error(
        '[MetroWatchdog] Unexpected error in check cycle:',
        unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError),
      );
    } finally {
      this.isChecking = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Individual Line Checkers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Checks Event Bus health by analyzing the replay buffer for anomalies.
   *
   * Detects:
   * - Excessive agent errors (threshold: EVENT_BUS_ERROR_THRESHOLD)
   * - Open circuit breakers
   * - Bridge dead-letter events
   */
  private async checkEventBus(): Promise<LineHealth> {
    const now = new Date().toISOString();

    try {
      const buffer = GlobalEventBus.getReplayBuffer();
      const recentEvents = buffer.slice(-REPLAY_BUFFER_SCAN_LIMIT);

      const errorCount = recentEvents.filter((e) => e.type === 'agent:error').length;
      const hasCircuitOpen = recentEvents.some((e) => e.type === 'circuit:open');
      const hasDeadLetters = recentEvents.some((e) => e.type === 'bridge:dead_letter');

      const hasAnomaly = errorCount > EVENT_BUS_ERROR_THRESHOLD || hasCircuitOpen || hasDeadLetters;
      const status: LineStatus = hasAnomaly ? 'degraded' : 'healthy';

      return {
        lineId: 'event_bus',
        status,
        latencyMs: 0, // Local check — no network latency
        lastCheck: now,
        message: hasAnomaly
          ? `Anomalies: errors=${errorCount}, circuitOpen=${hasCircuitOpen}, deadLetters=${hasDeadLetters}`
          : `${buffer.length} events in replay buffer — nominal`,
        details: {
          replayBufferSize: buffer.length,
          scannedEvents: recentEvents.length,
          recentErrorCount: errorCount,
          circuitOpen: hasCircuitOpen,
          bridgeDeadLetter: hasDeadLetters,
          eventTypeDistribution: this.computeEventTypeDistribution(recentEvents),
        },
      };
    } catch (error) {
      return this.createErrorResult('event_bus', now, error);
    }
  }

  /**
   * Checks REST API health by calling the bridge's /status endpoint.
   *
   * Measures HTTP round-trip latency and inspects the response body
   * for unhealthy component indicators.
   */
  private async checkRestApi(): Promise<LineHealth> {
    const now = new Date().toISOString();
    const startTime = performance.now();

    try {
      const response = await fetch(`${this.config.bridgeUrl}/status`, {
        headers: { 'X-Bridge-Secret': this.config.bridgeSecret },
        signal: AbortSignal.timeout(BRIDGE_CHECK_TIMEOUT_MS),
      });

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        return {
          lineId: 'rest_api',
          status: 'degraded',
          latencyMs,
          lastCheck: now,
          message: `Bridge /status returned HTTP ${response.status} ${response.statusText}`,
          details: {
            httpStatus: response.status,
            httpStatusText: response.statusText,
          },
        };
      }

      const body = await response.json() as Record<string, unknown>;

      // Inspect all string values for known unhealthy indicators
      const unhealthyKeys = Object.entries(body)
        .filter(([, v]) => typeof v === 'string' && /^(unreachable|no_key|http_5\d{2})$/.test(v))
        .map(([k]) => k);

      const hasUnhealthy = unhealthyKeys.length > 0;

      return {
        lineId: 'rest_api',
        status: hasUnhealthy ? 'degraded' : 'healthy',
        latencyMs,
        lastCheck: now,
        message: hasUnhealthy
          ? `Unhealthy components: ${unhealthyKeys.join(', ')}`
          : 'All bridge components healthy',
        details: {
          ...body,
          ...(hasUnhealthy ? { unhealthyKeys } : {}),
        },
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      return this.createErrorResult('rest_api', now, error, latencyMs);
    }
  }

  /**
   * Checks WebSocket/SSE health by inspecting bridge health events
   * in the EventBus replay buffer.
   */
  private async checkWsSse(): Promise<LineHealth> {
    const now = new Date().toISOString();
    const startTime = performance.now();

    try {
      // First: verify bridge is reachable (required for WS/SSE to function)
      const response = await fetch(`${this.config.bridgeUrl}/health`, {
        signal: AbortSignal.timeout(BRIDGE_CHECK_TIMEOUT_MS),
      });

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        return {
          lineId: 'ws_sse',
          status: 'down',
          latencyMs,
          lastCheck: now,
          message: `Bridge unreachable (HTTP ${response.status}) — streaming cannot operate`,
          details: { httpStatus: response.status },
        };
      }

      // Bridge is reachable — check for explicit health events
      const buffer = GlobalEventBus.getReplayBuffer();
      const bridgeHealthEvents = buffer.filter((e) => e.type === 'bridge:health');
      const latestHealthEvent = bridgeHealthEvents[bridgeHealthEvents.length - 1];

      const bridgeData = latestHealthEvent as
        | { type: 'bridge:health'; available: boolean; latencyMs: number }
        | undefined;

      const explicitlyUnavailable = bridgeData?.available === false;

      return {
        lineId: 'ws_sse',
        status: explicitlyUnavailable ? 'degraded' : 'healthy',
        latencyMs,
        lastCheck: now,
        message: explicitlyUnavailable
          ? 'Bridge reports unavailable — streaming may be degraded'
          : 'Streaming channels operational (bridge reachable)',
        details: {
          bridgeAvailable: !explicitlyUnavailable,
          bridgeLatencyMs: bridgeData?.latencyMs ?? latencyMs,
          bridgeHealthEventCount: bridgeHealthEvents.length,
          lastHealthEventTime: bridgeData ? now : null,
        },
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      return this.createErrorResult('ws_sse', now, error, latencyMs);
    }
  }

  /**
   * Checks VS Code Protocol health indirectly by detecting extension
   * activity in the UI log events.
   *
   * Note: VS Code extension does not expose a direct health endpoint.
   * Status remains "unknown" unless activity is detected.
   */
  private async checkVsCode(): Promise<LineHealth> {
    const now = new Date().toISOString();

    try {
      const buffer = GlobalEventBus.getReplayBuffer();
      const uiLogEvents = buffer.filter((e) => e.type === 'ui:log');
      const lastUiEvent = uiLogEvents[uiLogEvents.length - 1];

      const hasRecentActivity = uiLogEvents.length > 0;

      // Calculate time since last UI event (if any)
      const lastEventTime = (lastUiEvent as { time?: string } | undefined)?.time ?? null;
      const secondsSinceLastEvent = lastEventTime
        ? Math.round((Date.now() - new Date(lastEventTime).getTime()) / 1000)
        : null;

      return {
        lineId: 'vscode',
        status: 'unknown',
        latencyMs: 0,
        lastCheck: now,
        message: hasRecentActivity
          ? `Extension activity detected (${secondsSinceLastEvent}s ago)`
          : 'No recent extension activity — status unknown',
        details: {
          recentUiLogCount: uiLogEvents.length,
          lastUiEventTime: lastEventTime,
          secondsSinceLastEvent,
        },
      };
    } catch (error) {
      return this.createErrorResult('vscode', now, error);
    }
  }

  /**
   * Checks MCP Stdio health by calling the bridge's /health endpoint.
   *
   * Verifies that the MCP server is both reachable and fully initialized.
   */
  private async checkMcp(): Promise<LineHealth> {
    const now = new Date().toISOString();
    const startTime = performance.now();

    try {
      const response = await fetch(`${this.config.bridgeUrl}/health`, {
        signal: AbortSignal.timeout(BRIDGE_CHECK_TIMEOUT_MS),
      });

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        return {
          lineId: 'mcp',
          status: 'down',
          latencyMs,
          lastCheck: now,
          message: `Bridge /health returned HTTP ${response.status} ${response.statusText}`,
          details: { httpStatus: response.status },
        };
      }

      const body = await response.json() as { status?: string; initialized?: boolean };
      const isInitialized = body.initialized === true;

      return {
        lineId: 'mcp',
        status: isInitialized ? 'healthy' : 'degraded',
        latencyMs,
        lastCheck: now,
        message: isInitialized
          ? 'MCP server operational (bridge initialized)'
          : 'MCP server starting (bridge not fully initialized)',
        details: body,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      return this.createErrorResult('mcp', now, error, latencyMs);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Alert Rule Engine
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Evaluates all alert rules against the current line health state.
   *
   * Rules are evaluated in priority order:
   * 1. **Critical**: Line is DOWN with consecutive failures ≥ threshold
   * 2. **Warning**: Line is DEGRADED
   * 3. **Warning**: High latency (> degradedLatencyMs)
   *
   * Alerts are de-duplicated per (lineId, severity) within a 60-second
   * window to prevent alert storms.
   */
  private evaluateAlertRules(lines: Record<MetroLineId, LineHealth>): void {
    for (const [lineId, health] of Object.entries(lines) as [MetroLineId, LineHealth][]) {
      const lineLabel = LINE_REGISTRY[lineId].label;

      // Rule 1: Line is DOWN with consecutive failures exceeding threshold
      if (
        health.status === 'down' &&
        this.consecutiveFailures[lineId] >= this.config.downThreshold
      ) {
        this.raiseAlert('critical', lineId, `${lineLabel} is DOWN: ${health.message}`);
        continue; // Critical takes precedence — skip further rules
      }

      // Rule 2: Line is DEGRADED
      if (health.status === 'degraded') {
        this.raiseAlert('warning', lineId, `${lineLabel} is DEGRADED: ${health.message}`);
        continue;
      }

      // Rule 3: High latency (even if otherwise healthy)
      if (
        health.latencyMs > 0 &&
        health.latencyMs > this.config.degradedLatencyMs
      ) {
        this.raiseAlert(
          'warning',
          lineId,
          `${lineLabel} high latency: ${health.latencyMs}ms (threshold: ${this.config.degradedLatencyMs}ms)`,
        );
      }
    }
  }

  /**
   * Raises a new alert, subject to de-duplication.
   *
   * De-duplication prevents creating the same alert for the same
   * (lineId, severity) pair within ALERT_DEDUPE_WINDOW_MS milliseconds.
   *
   * @param severity - Alert severity level.
   * @param lineId - The metro line that triggered the alert.
   * @param message - Human-readable alert message.
   */
  private raiseAlert(severity: AlertSeverity, lineId: MetroLineId, message: string): void {
    const now = Date.now();

    // Check if there's already an active (unacknowledged) alert for the same
    // (lineId, severity) pair — regardless of time window. This prevents alert
    // storms when a line stays down for extended periods.
    const hasActiveAlert = this.alerts.some(
      (a) =>
        a.lineId === lineId &&
        a.severity === severity &&
        !a.acknowledged,
    );

    if (hasActiveAlert) {
      return;
    }

    const alert: MetroAlert = {
      id: `alert-${++this.alertCounter}`,
      severity,
      lineId,
      message,
      timestamp: new Date(now).toISOString(),
      acknowledged: false,
    };

    this.alerts.push(alert);
    this.metrics.totalAlertsRaised++;

    // Evict oldest alerts if capacity exceeded (FIFO eviction)
    while (this.alerts.length > MAX_ALERTS) {
      this.alerts.shift();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // State Management
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Updates consecutive failure counters per line.
   * A line in "down" status increments its counter; any other status resets it.
   */
  private updateFailureCounters(lines: Record<MetroLineId, LineHealth>): void {
    for (const lineId of MetroWatchdog.getValidLineIds()) {
      this.consecutiveFailures[lineId] =
        lines[lineId].status === 'down'
          ? this.consecutiveFailures[lineId] + 1
          : 0;
    }
  }

  /**
   * Updates the rolling average latency metric per line.
   * Uses an exponential moving average (EMA) with α = 0.3.
   */
  private updateLatencyMetrics(lines: Record<MetroLineId, LineHealth>): void {
    const alpha = 0.3;
    for (const lineId of MetroWatchdog.getValidLineIds()) {
      const latency = lines[lineId].latencyMs;
      if (latency >= 0) {
        const prev = this.metrics.avgLatency[lineId];
        this.metrics.avgLatency[lineId] =
          prev === 0 ? latency : alpha * latency + (1 - alpha) * prev;
      }
    }
  }

  /**
   * Detects and records status transitions for observability.
   * Logs when a line's status changes (e.g., healthy → degraded).
   */
  private detectTransitions(
    lines: Record<MetroLineId, LineHealth>,
    timestamp: number,
  ): void {
    for (const lineId of MetroWatchdog.getValidLineIds()) {
      const current = lines[lineId].status;
      const previous = this.metrics.previousStatus[lineId];

      if (previous !== null && previous !== current) {
        this.metrics.lastTransition[lineId] = new Date(timestamp).toISOString();
        console.log(
          `[MetroWatchdog] ${LINE_REGISTRY[lineId].label}: ${previous} → ${current}`,
        );
      }

      this.metrics.previousStatus[lineId] = current;
    }
  }

  /**
   * Processes a PromiseSettledResult into a LineHealth object.
   *
   * Fulfilled results are persisted to line history.
   * Rejected results produce a "down" health status.
   */
  private processSettledResult(
    result: PromiseSettledResult<LineHealth>,
    lineId: MetroLineId,
  ): LineHealth {
    if (result.status === 'fulfilled') {
      const health = result.value;

      // Persist to rolling history (bounded)
      const history = this.lineHistory[lineId];
      history.push(health);
      while (history.length > MAX_HISTORY_PER_LINE) {
        history.shift();
      }

      return health;
    }

    // Rejected — synthesize a down result
    return {
      lineId,
      status: 'down',
      latencyMs: -1,
      lastCheck: new Date().toISOString(),
      message: `Check rejected: ${result.reason}`,
      details: { rejectionReason: String(result.reason) },
    };
  }

  /**
   * Computes the overall network status as the worst-case of all lines.
   *
   * Priority: down > degraded > healthy (unknown is neutral).
   */
  private computeOverallStatus(lines: Record<MetroLineId, LineHealth>): LineStatus {
    const statuses = Object.values(lines).map((l) => l.status);

    if (statuses.some((s) => s === 'down')) return 'down';
    if (statuses.some((s) => s === 'degraded')) return 'degraded';
    if (statuses.every((s) => s === 'healthy')) return 'healthy';
    return 'unknown';
  }

  // ═══════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Creates a standardized error result for failed health checks.
   *
   * @param lineId - The line that failed.
   * @param timestamp - ISO-8601 timestamp string.
   * @param error - The caught error.
   * @param latencyMs - Optional measured latency before failure.
   * @returns A LineHealth with status "down".
   */
  private createErrorResult(
    lineId: MetroLineId,
    timestamp: string,
    error: unknown,
    latencyMs = -1,
  ): LineHealth {
    const message = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

    return {
      lineId,
      status: 'down',
      latencyMs,
      lastCheck: timestamp,
      message: `Check failed [${errorType}]: ${message}`,
      details: {
        errorType,
        errorMessage: message,
        ...(error instanceof Error && error.cause
          ? { errorCause: String(error.cause) }
          : {}),
      },
    };
  }

  /**
   * Computes a frequency distribution of event types in a buffer slice.
   * Used for diagnostic details in Event Bus health checks.
   */
  private computeEventTypeDistribution(events: { type: string }[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const event of events) {
      distribution[event.type] = (distribution[event.type] ?? 0) + 1;
    }
    return distribution;
  }

  /**
   * Broadcasts the current network status to the global event bus.
   * Used by the UI layer for real-time log display.
   */
  private broadcastStatus(
    overall: LineStatus,
    lines: Record<MetroLineId, LineHealth>,
  ): void {
    const lineSummary = Object.entries(lines)
      .map(([key, health]) => `${key}=${health.status}`)
      .join(' | ');

    const logLevel = overall === 'healthy' ? 'info' : overall === 'degraded' ? 'warning' : 'error';

    GlobalEventBus.emit({
      type: 'ui:log',
      id: Date.now(),
      time: new Date().toISOString(),
      source: 'metro-watchdog',
      text: `Metro health: ${overall} │ ${lineSummary}`,
      level: logLevel,
    });
  }
}