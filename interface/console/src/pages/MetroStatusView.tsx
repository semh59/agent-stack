/**
 * Metro Status View — Production-grade real-time health monitoring dashboard.
 *
 * Displays the health status of all 5 metro communication lines with
 * live SSE updates, alert management, and responsive layout.
 *
 * ## Features
 * - Real-time SSE health streaming with auto-reconnect
 * - Alert listing with acknowledge capability
 * - Per-line latency and status indicators
 * - Overall network health badge
 * - Responsive design with dark mode support
 *
 * @module MetroStatusView
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useMetroStore, LINE_META, STATUS_META, LINE_ORDER } from '../stores/useMetroStore';
import type { MetroLineId, LineHealth, MetroAlert, ConnectionState } from '../stores/useMetroStore';

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

/** Formats seconds into a human-readable uptime string (e.g., "2h 15m"). */
function formatUptime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}s ${minutes}dk`;
  return `${minutes}dk`;
}

/** Formats an ISO timestamp into a locale-friendly time string. */
function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Returns a relative time description (e.g., "3 dk önce"). */
function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}sn önce`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} dk önce`;
  return `${Math.floor(diffSec / 3600)} saat önce`;
}

// ════════════════════════════════════════════════════════════════════════
// Sub-Components
// ════════════════════════════════════════════════════════════════════════

// ─── Overall Health Badge ────────────────────────────────────────────

/** Displays the overall network health status as a prominent badge. */
const OverallHealthBadge: React.FC<{ status: string }> = React.memo(({ status }) => {
  const meta = STATUS_META[status as keyof typeof STATUS_META] ?? STATUS_META.unknown;

  return (
    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${meta.bg} border`}
         style={{ borderColor: meta.color + '40' }}>
      <span className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: meta.color }} />
      <span className="font-semibold text-sm" style={{ color: meta.color }}>
        {meta.label}
      </span>
    </div>
  );
});
OverallHealthBadge.displayName = 'OverallHealthBadge';

// ─── Connection Indicator ────────────────────────────────────────────

/** Displays the SSE connection state with a visual indicator. */
const ConnectionIndicator: React.FC<{ state: ConnectionState }> = React.memo(({ state }) => {
  const config: Record<ConnectionState, { color: string; label: string; pulse: boolean }> = {
    connected:     { color: '#22c55e', label: 'Canlı',           pulse: true },
    connecting:    { color: '#3b82f6', label: 'Bağlanıyor...',   pulse: true },
    reconnecting:  { color: '#eab308', label: 'Yeniden bağlanıyor', pulse: true },
    disconnected:  { color: '#6b7280', label: 'Bağlantı yok',   pulse: false },
    failed:        { color: '#ef4444', label: 'Bağlantı başarısız', pulse: false },
  };

  const { color, label, pulse } = config[state];

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span
        className={`w-2 h-2 rounded-full ${pulse ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  );
});
ConnectionIndicator.displayName = 'ConnectionIndicator';

// ─── Line Card ───────────────────────────────────────────────────────

/** Displays the health status of a single metro communication line. */
const LineCard: React.FC<{ health: LineHealth }> = React.memo(({ health }) => {
  const meta = LINE_META[health.lineId];
  const statusMeta = STATUS_META[health.status];

  return (
    <div
      className={`rounded-lg border p-4 transition-all duration-300 hover:shadow-lg ${statusMeta.bg}`}
      style={{ borderColor: statusMeta.color + '30' }}
    >
      {/* Header: Emoji + Label + Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{meta.emoji}</span>
          <span className="font-medium text-sm text-gray-200">{meta.label}</span>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: statusMeta.color + '20', color: statusMeta.color }}
        >
          {statusMeta.label}
        </span>
      </div>

      {/* Message */}
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">{health.message}</p>

      {/* Metrics Row */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        {health.latencyMs >= 0 && (
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{health.latencyMs}ms</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <span>Son kontrol: {timeAgo(health.lastCheck)}</span>
        </div>
      </div>
    </div>
  );
});
LineCard.displayName = 'LineCard';

// ─── Alert Card ──────────────────────────────────────────────────────

/** Displays a single alert with acknowledge action. */
const AlertCard: React.FC<{
  alert: MetroAlert;
  onAcknowledge: (id: string) => void;
}> = React.memo(({ alert, onAcknowledge }) => {
  const severityColors: Record<string, { border: string; bg: string; text: string }> = {
    critical: { border: '#ef4444', bg: 'bg-red-500/5', text: '#ef4444' },
    warning:  { border: '#eab308', bg: 'bg-yellow-500/5', text: '#eab308' },
    info:     { border: '#3b82f6', bg: 'bg-blue-500/5', text: '#3b82f6' },
  };

  const colors = severityColors[alert.severity] ?? severityColors.info;
  const lineMeta = LINE_META[alert.lineId];

  return (
    <div
      className={`rounded-lg border p-3 ${colors.bg} ${alert.acknowledged ? 'opacity-50' : ''}`}
      style={{ borderColor: colors.border + '30' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.text }}>
              {alert.severity}
            </span>
            <span className="text-xs text-gray-500">{lineMeta.emoji} {lineMeta.label}</span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">{alert.message}</p>
          <p className="text-xs text-gray-600 mt-1">{formatTime(alert.timestamp)}</p>
        </div>

        {!alert.acknowledged && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-gray-600 text-gray-400
                       hover:bg-gray-700 hover:text-gray-200 transition-colors"
            aria-label={`Acknowledge alert ${alert.id}`}
          >
            Kabul Et
          </button>
        )}

        {alert.acknowledged && (
          <span className="shrink-0 text-xs text-green-500 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Kabul
          </span>
        )}
      </div>
    </div>
  );
});
AlertCard.displayName = 'AlertCard';

// ════════════════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════════════════

/**
 * Metro Status View — Full-page dashboard for monitoring all metro lines.
 *
 * Automatically connects to the SSE health stream on mount and disconnects
 * on unmount. Falls back to a single REST fetch if SSE is unavailable.
 */
const MetroStatusView: React.FC = () => {
  const snapshot = useMetroStore((s) => s.snapshot);
  const isLoading = useMetroStore((s) => s.isLoading);
  const error = useMetroStore((s) => s.error);
  const connectionState = useMetroStore((s) => s.connectionState);
  const lastUpdate = useMetroStore((s) => s.lastUpdate);
  const startStream = useMetroStore((s) => s.startStream);
  const stopStream = useMetroStore((s) => s.stopStream);
  const fetchHealth = useMetroStore((s) => s.fetchHealth);
  const acknowledgeAlert = useMetroStore((s) => s.acknowledgeAlert);

  // Start SSE stream on mount, stop on unmount
  useEffect(() => {
    startStream();
    return () => stopStream();
  }, [startStream, stopStream]);

  // Handle alert acknowledgement
  const handleAcknowledge = useCallback((alertId: string) => {
    void acknowledgeAlert(alertId);
  }, [acknowledgeAlert]);

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    void fetchHealth();
  }, [fetchHealth]);

  // Derived data
  const lines = useMemo(() => {
    if (!snapshot) return [];
    return LINE_ORDER.map((id) => snapshot.lines[id]).filter(Boolean);
  }, [snapshot]);

  const unacknowledgedAlerts = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.activeAlerts.filter((a) => !a.acknowledged);
  }, [snapshot]);

  // ─── Loading State ──────────────────────────────────────────────
  if (isLoading && !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Metro ağı kontrol ediliyor...</p>
        </div>
      </div>
    );
  }

  // ─── Error State (no snapshot at all) ───────────────────────────
  if (error && !snapshot) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold text-gray-200 mb-2">Bağlantı Hatası</h2>
          <p className="text-gray-400 text-sm mb-6">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            Tekrar Dene
          </button>
        </div>
      </div>
    );
  }

  // ─── No Data State ──────────────────────────────────────────────
  if (!snapshot) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center">
          <p className="text-gray-400 text-sm">Henüz sağlık verisi mevcut değil.</p>
          <button
            onClick={handleRefresh}
            className="mt-4 px-4 py-2 bg-gray-700 text-gray-300 text-sm rounded-lg hover:bg-gray-600 transition-colors"
          >
            Veri Çek
          </button>
        </div>
      </div>
    );
  }

  // ─── Main Dashboard ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              🚇 Metro Ağ Durumu
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              Tüm iletişim hatlarının gerçek zamanlı sağlık izleme paneli
            </p>
          </div>

          <div className="flex items-center gap-4">
            <ConnectionIndicator state={connectionState} />
            <OverallHealthBadge status={snapshot.overall} />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Genel Durum" value={STATUS_META[snapshot.overall].label}
                    color={STATUS_META[snapshot.overall].color} />
          <StatCard label="Çevrimiçi Hatlar"
                    value={`${lines.filter((l) => l.status === 'healthy').length}/${lines.length}`}
                    color="#22c55e" />
          <StatCard label="Aktif Alertler" value={String(unacknowledgedAlerts.length)}
                    color={unacknowledgedAlerts.length > 0 ? '#ef4444' : '#22c55e'} />
          <StatCard label="Çalışma Süresi" value={formatUptime(snapshot.uptimeSec)}
                    color="#3b82f6" />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Line Cards Grid */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
            İletişim Hatları
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lines.map((health) => (
              <LineCard key={health.lineId} health={health} />
            ))}
          </div>
        </section>

        {/* Alerts Section */}
        {snapshot.activeAlerts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
              Uyarılar ({snapshot.activeAlerts.length})
            </h2>
            <div className="space-y-2">
              {snapshot.activeAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onAcknowledge={handleAcknowledge}
                />
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="text-center text-xs text-gray-600 pt-4 border-t border-gray-800">
          Son güncelleme: {formatTime(lastUpdate)} · Döngü: #{snapshot.cycleCount} ·
          Çalışma: {formatUptime(snapshot.uptimeSec)}
        </footer>
      </main>
    </div>
  );
};

// ─── Stat Card Helper ────────────────────────────────────────────────

/** Compact stat display for the stats bar. */
const StatCard: React.FC<{
  label: string;
  value: string;
  color: string;
}> = React.memo(({ label, value, color }) => (
  <div className="bg-gray-900 rounded-lg border border-gray-800 px-3 py-2">
    <p className="text-xs text-gray-500 mb-0.5">{label}</p>
    <p className="text-sm font-bold" style={{ color }}>{value}</p>
  </div>
));
StatCard.displayName = 'StatCard';

MetroStatusView.displayName = 'MetroStatusView';
export default MetroStatusView;