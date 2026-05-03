#!/usr/bin/env node
/**
 * Metro Chaos Test — Akıllı yoğun trafik simülasyonu
 *
 * Rate limiter'a saygılı, gerçekçi kullanıcı davranışı simüle eder.
 * Her rol adaptive backoff kullanır — 429 görünce yavaşlar.
 *
 * Kullanım: node tools/metro-chaos-test.js
 */

const BASE = 'http://127.0.0.1:51122';
const BRIDGE = 'http://127.0.0.1:9100';
const TOKEN = 'dev-local-token';
const AUTH = { 'Authorization': `Bearer ${TOKEN}` };

// ═══════════════════════════════════════════════════════════════
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};
const tag = (emoji, label, color) => `${color}[${emoji} ${label}]${C.reset}`;
const log = (prefix, msg) => console.log(`${prefix} ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ═══════════════════════════════════════════════════════════════
// İstatistikler
// ═══════════════════════════════════════════════════════════════
const stats = {
  totalRequests: 0,
  successCount: 0,
  rateLimitedCount: 0,
  errorCount: 0,
  alertsAcknowledged: 0,
  statusChanges: 0,
  sseEvents: 0,
  historyQueries: 0,
  bridgeFlaps: 0,
  startTime: Date.now(),
  lastOverall: null,
};

function printDashboard() {
  const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
  const rpm = stats.totalRequests > 0 ? Math.round(stats.totalRequests / (elapsed / 60)) : 0;
  console.log('\n' + '═'.repeat(60));
  console.log(`${C.bold}  📊 METRO CHAOS DASHBOARD${C.reset}  (${elapsed}s elapsed)`);
  console.log('─'.repeat(60));
  console.log(`  🔄 Total requests:    ${stats.totalRequests}`);
  console.log(`  ✅ Success:           ${C.green}${stats.successCount}${C.reset}`);
  console.log(`  ⏳ Rate limited:      ${C.yellow}${stats.rateLimitedCount}${C.reset}`);
  console.log(`  ❌ Real errors:       ${C.red}${stats.errorCount}${C.reset}`);
  console.log(`  ⚡ Req/min:            ${C.cyan}${rpm}${C.reset}`);
  console.log(`  🚨 Alerts ack'd:      ${C.yellow}${stats.alertsAcknowledged}${C.reset}`);
  console.log(`  🔀 Status changes:    ${C.magenta}${stats.statusChanges}${C.reset}`);
  console.log(`  📡 SSE events:        ${C.blue}${stats.sseEvents}${C.reset}`);
  console.log(`  📜 History queries:   ${stats.historyQueries}`);
  console.log(`  🔌 Bridge flaps:      ${C.red}${stats.bridgeFlaps}${C.reset}`);
  console.log(`  🏥 Last overall:      ${stats.lastOverall || '—'}`);
  console.log('═'.repeat(60) + '\n');
}

// ═══════════════════════════════════════════════════════════════
// Akıllı API çağrısı — rate limiter'a saygılı
// ═══════════════════════════════════════════════════════════════
let globalBackoff = 0;

async function apiCall(method, path, body = null) {
  // Global backoff bekle
  const now = Date.now();
  if (globalBackoff > now) {
    await sleep(globalBackoff - now);
  }

  stats.totalRequests++;
  try {
    const opts = { method, headers: { ...AUTH, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);

    if (res.status === 429) {
      stats.rateLimitedCount++;
      // Exponential backoff: 3s → 6s → 12s
      const wait = Math.min(12000, 3000 * Math.pow(2, Math.min(stats.rateLimitedCount % 5, 4)));
      globalBackoff = Date.now() + wait;
      return { status: 429, rateLimited: true };
    }

    const json = await res.json();
    if (res.ok) {
      stats.successCount++;
      // Başarılı istek backoff'u sıfırla
      globalBackoff = 0;
    } else {
      stats.errorCount++;
    }
    return { status: res.status, data: json };
  } catch (err) {
    stats.errorCount++;
    return { status: 0, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Simülasyon rolleri
// ═══════════════════════════════════════════════════════════════

async function passenger(id) {
  const prefix = tag('🚇', `Yolcu-${id}`, C.cyan);
  while (true) {
    const res = await apiCall('GET', '/api/metro/health');
    if (res.rateLimited) {
      log(prefix, `${C.yellow}⏳ rate limit — yavaşlıyorum${C.reset}`);
      await sleep(rand(5000, 10000));
      continue;
    }
    if (res.data?.data?.overall) {
      const overall = res.data.data.overall;
      if (stats.lastOverall && stats.lastOverall !== overall) {
        stats.statusChanges++;
        log(prefix, `${C.yellow}STATUS DEĞİŞTİ: ${stats.lastOverall} → ${overall}${C.reset}`);
      }
      stats.lastOverall = overall;
      const lines = Object.entries(res.data.data.lines || {})
        .map(([k, v]) => `${k}=${v.status}`)
        .join(' | ');
      log(prefix, `overall=${C.bold}${overall}${C.reset} │ ${C.dim}${lines}${C.reset}`);
    } else if (res.error) {
      log(prefix, `${C.red}bağlantı hatası: ${res.error}${C.reset}`);
    }
    await sleep(rand(8000, 15000));
  }
}

async function operator() {
  const prefix = tag('👨‍💼', 'Operatör', C.yellow);
  while (true) {
    const res = await apiCall('GET', '/api/metro/alerts');
    if (res.rateLimited) {
      await sleep(rand(5000, 10000));
      continue;
    }
    const alerts = res.data?.data?.alerts || [];
    if (alerts.length > 0) {
      log(prefix, `${C.red}${alerts.length} aktif alert!${C.reset}`);
      for (const alert of alerts) {
        log(prefix, `  ${alert.severity.toUpperCase()}: ${alert.message}`);
        if (alert.severity === 'warning') {
          const ack = await apiCall('POST', `/api/metro/alerts/${alert.id}/acknowledge`);
          if (ack.data?.data?.success) {
            stats.alertsAcknowledged++;
            log(prefix, `  ${C.green}✓ Acknowledged: ${alert.id}${C.reset}`);
          }
        }
      }
    } else {
      log(prefix, `${C.green}Alert yok — sistem temiz${C.reset}`);
    }
    await sleep(rand(10000, 20000));
  }
}

async function analyst() {
  const prefix = tag('📊', 'Analist', C.magenta);
  const lineIds = ['event_bus', 'rest_api', 'ws_sse', 'vscode', 'mcp'];
  while (true) {
    const metricsRes = await apiCall('GET', '/api/metro/metrics');
    if (metricsRes.rateLimited) { await sleep(5000); continue; }
    if (metricsRes.data?.data?.metrics) {
      const m = metricsRes.data.data.metrics;
      const topLine = Object.entries(m.avgLatency).sort(([,a], [,b]) => b - a)[0];
      log(prefix, `cycle #${m.totalCycles} │ en yavaş: ${topLine?.[0]}=${topLine?.[1]?.toFixed(1)}ms`);
    }

    const lineId = pick(lineIds);
    const histRes = await apiCall('GET', `/api/metro/lines/${lineId}/history?limit=10`);
    if (!histRes.rateLimited) {
      stats.historyQueries++;
      const records = histRes.data?.data?.records || histRes.data?.data || [];
      if (Array.isArray(records) && records.length > 0) {
        const statuses = records.map(r => r.status).join(' → ');
        log(prefix, `${lineId} (son ${records.length}): ${C.dim}${statuses}${C.reset}`);
      } else {
        log(prefix, `${lineId}: ${C.dim}veri bekleniyor...${C.reset}`);
      }
    }
    await sleep(rand(10000, 20000));
  }
}

let bridgeKilled = false;
async function chaosAgent() {
  const prefix = tag('🔌', 'Kaos', C.red);
  while (true) {
    const action = Math.random();
    if (action < 0.25 && !bridgeKilled) {
      log(prefix, `${C.red}⚡ BRIDGE KESİNTİSİ${C.reset}`);
      bridgeKilled = true;
      stats.bridgeFlaps++;
      await sleep(rand(15000, 25000));
      log(prefix, `${C.green}🔌 Bridge geri geldi!${C.reset}`);
      bridgeKilled = false;
    } else if (action < 0.45) {
      try {
        const res = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(2000) });
        const body = await res.json();
        log(prefix, `bridge: ${body.status}`);
      } catch {
        log(prefix, `${C.red}bridge ULAŞILAMAZ!${C.reset}`);
      }
    } else {
      log(prefix, `${C.dim}sistem izleniyor...${C.reset}`);
    }
    await sleep(rand(15000, 30000));
  }
}

async function sseListener() {
  const prefix = tag('📡', 'SSE', C.blue);
  while (true) {
    try {
      log(prefix, `${C.blue}SSE bağlanıyor...${C.reset}`);
      const res = await fetch(`${BASE}/api/metro/health/stream`, {
        headers: AUTH,
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) {
        log(prefix, `${C.yellow}⏳ rate limit — 10s bekliyorum${C.reset}`);
        await sleep(10000);
        continue;
      }
      if (!res.ok) {
        log(prefix, `${C.red}SSE hatası: ${res.status}${C.reset}`);
        await sleep(5000);
        continue;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data:')) {
            stats.sseEvents++;
            const data = line.slice(5).trim();
            try {
              const parsed = JSON.parse(data);
              log(prefix, `event: ${parsed.overall || 'snapshot'}`);
            } catch {
              log(prefix, `${C.dim}${data.substring(0, 60)}${C.reset}`);
            }
          }
        }
      }
    } catch (err) {
      log(prefix, `${C.yellow}SSE koptu → reconnect (${err.message})${C.reset}`);
    }
    await sleep(5000);
  }
}

async function ticketInspector() {
  const prefix = tag('🎫', 'Bilet', C.green);
  while (true) {
    const res = await apiCall('GET', '/api/health');
    if (res.rateLimited) { await sleep(5000); continue; }
    if (res.data?.data?.status === 'ok') {
      const uptime = res.data.data.uptimeSec;
      log(prefix, `gateway UP (${Math.floor(uptime/60)}dk ${uptime%60}s)`);
    } else {
      log(prefix, `${C.red}GATEWAY DOWN!${C.reset}`);
    }
    await sleep(rand(10000, 20000));
  }
}

async function floodAgent() {
  const prefix = tag('🌊', 'Flood', C.blue);
  const endpoints = [
    '/api/metro/health',
    '/api/metro/alerts',
    '/api/metro/metrics',
    '/api/metro/lines/rest_api/history?limit=5',
    '/api/metro/lines/ws_sse/history?limit=5',
    '/api/metro/lines/mcp/history?limit=5',
  ];
  while (true) {
    const count = rand(3, 6);
    log(prefix, `${count} paralel istek...`);
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => apiCall('GET', pick(endpoints)))
    );
    const ok = results.filter(r => r.status === 'fulfilled' && !r.value.rateLimited && r.value.status !== 429).length;
    const limited = results.filter(r => r.status === 'fulfilled' && r.value.rateLimited).length;
    const fail = results.filter(r => r.status === 'rejected').length;
    log(prefix, `${C.green}${ok} OK${C.reset} / ${C.yellow}${limited} rate-limited${C.reset} / ${C.red}${fail} fail${C.reset}`);
    
    // Flood sonrası uzun bekle — rate limit doldurma
    await sleep(rand(8000, 15000));
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(`${C.bold}${C.magenta}  🚇 METRO CHAOS TEST — Akıllı Yoğun Trafik${C.reset}`);
  console.log('═'.repeat(60));
  console.log(`  Gateway: ${BASE}`);
  console.log(`  Bridge:  ${BRIDGE}`);
  console.log('─'.repeat(60));

  // Gateway kontrol
  try {
    const check = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!check.ok) throw new Error(`HTTP ${check.status}`);
    log(tag('✅', 'Init', C.green), 'Gateway ayakta!');
  } catch {
    console.error(`${C.red}❌ Gateway ${BASE} çalışmıyor!${C.reset}`);
    process.exit(1);
  }

  // Bridge kontrol
  try {
    const check = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(2000) });
    if (check.ok) log(tag('✅', 'Init', C.green), 'Bridge ayakta!');
  } catch {
    log(tag('⚠️', 'Init', C.yellow), 'Bridge yok — bazı testler başarısız olabilir');
  }

  setInterval(printDashboard, 15000);

  const roles = [
    passenger(1), passenger(2),
    operator(),
    analyst(),
    chaosAgent(),
    sseListener(),
    ticketInspector(),
    floodAgent(),
  ];

  log(tag('🚀', 'Init', C.green), `${roles.length} rol başlatıldı! 🚇\n`);
  await Promise.all(roles);
}

main().catch(err => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  process.exit(1);
});