# 🚇 Metro Watchdog — Gerçek Zamanlı İletişim Hattı İzleme Sistemi

> Metro haritasındaki tüm iletişim hatlarının sağlığını sürekli izleyen, anormallikleri tespit eden ve alert üreten sistem.
> Son güncelleme: Mayıs 2026

---

## 📌 Genel Bakış

Metro Watchdog, `docs/METRO_MAP.md`'de tanımlanan 5 iletişim hattının sağlığını periyodik olarak kontrol eder:

| Hat | ID | Kontrol Yöntemi |
|-----|----|----|
| 🔴 Event Bus | `event_bus` | Replay buffer analizi (error count, circuit breaker, dead letters) |
| 🔵 REST API | `rest_api` | Bridge `/status` endpoint HTTP çağrısı |
| 🟢 WebSocket/SSE | `ws_sse` | EventBus bridge health event'leri |
| 🟡 VS Code Protocol | `vscode` | UI log event activity varlığı |
| 🟣 MCP Stdio | `mcp` | Bridge `/health` endpoint HTTP çağrısı |

---

## 🏗️ Mimari

```
┌─────────────────────────────────────────────────────────────────┐
│                      CONSOLE (Browser)                          │
│                                                                 │
│   /metro → MetroStatusView.tsx                                  │
│            ├── useMetroStore (Zustand)                          │
│            │   ├── SSE stream ← /api/metro/health/stream        │
│            │   └── REST ← /api/metro/health                    │
│            │                                                    │
│            ├── LineCard × 5 (hat durum kartları)               │
│            ├── MetroMapVisual (mini metro gösterimi)            │
│            └── AlertItem × N (aktif alertler)                  │
│                                                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │ 🟢 SSE / 🔵 REST
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GATEWAY (Fastify)                             │
│                                                                 │
│   metro.router.ts                                               │
│   ├── GET  /api/metro/health        → Anlık snapshot            │
│   ├── GET  /api/metro/health/stream → SSE canlı akış            │
│   ├── GET  /api/metro/alerts        → Aktif alertler            │
│   ├── POST /api/metro/alerts/:id/acknowledge                    │
│   └── GET  /api/metro/lines/:lineId/history                     │
│                                                                 │
│   metro-watchdog.ts (MetroWatchdog class)                       │
│   ├── Her 10s'de 5 hattı paralel kontrol et                    │
│   ├──Alert kurallarını değerlendir                             │
│   ├── Snapshot üret → MetroHealthSnapshot                      │
│   └── EventBus'e ui:log yayınla                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 Dosya Yapısı

```
core/gateway/src/
├── gateway/
│   ├── metro-watchdog.ts          ← Watchdog sınıfı (sağlık kontrol motoru)
│   ├── event-bus.ts               ← EventBus (mevcut, değişiklik yok)
│   └── server.ts                  ← MetroWatchdog başlatma + route kaydı
└── api/routers/
    └── metro.router.ts            ← REST/SSE health API endpoint'leri

interface/console/src/
├── stores/
│   └── useMetroStore.ts           ← Zustand store (SSE + REST + state)
├── pages/
│   └── MetroStatusView.tsx        ← Dashboard UI bileşeni
└── App.tsx                        ← /metro route eklendi

docs/
├── METRO_MAP.md                   ← Metro haritası (mevcut)
└── METRO_WATCHDOG.md              ← Bu dosya
```

---

## 🔌 API Endpoint'leri

### `GET /api/metro/health`

Tüm hatların anlık sağlık durumunu döndürür.

**Yanıt:**
```json
{
  "success": true,
  "data": {
    "timestamp": "2026-05-03T13:00:00.000Z",
    "overall": "healthy",
    "lines": {
      "event_bus": {
        "lineId": "event_bus",
        "status": "healthy",
        "latencyMs": 0,
        "lastCheck": "2026-05-03T13:00:00.000Z",
        "message": "42 events in replay buffer",
        "details": { "replayBufferSize": 42, "recentErrorCount": 0 }
      },
      "rest_api": { "...": "..." },
      "ws_sse": { "...": "..." },
      "vscode": { "...": "..." },
      "mcp": { "...": "..." }
    },
    "activeAlerts": [],
    "uptimeSec": 3600
  }
}
```

### `GET /api/metro/health/stream`

SSE (Server-Sent Events) ile sürekli sağlık akışı. Her 5 saniyede bir snapshot gönderir.

**Format:** `data: <JSON MetroHealthSnapshot>\n\n`

### `GET /api/metro/alerts`

Aktif alertleri listeler.

**Query Params:**
- `includeAcknowledged=true` — Onaylanmış alertleri de dahil et

### `POST /api/metro/alerts/:id/acknowledge`

Bir alerti onayla (acknowledge).

### `GET /api/metro/lines/:lineId/history`

Belirli bir hatın son N sağlık kontrol geçmişi.

**Query Params:**
- `limit=20` — Son 20 kayıt (max: 100)

---

## 🚨 Alert Kuralları

| Kural | Koşul | Severity |
|-------|-------|----------|
| Hat Çöktü | `status === "down"` ve `consecutiveFailures >= downThreshold` | 🔴 `critical` |
| Hat Bozuk | `status === "degraded"` | 🟡 `warning` |
| Yüksek Latency | `latencyMs > degradedLatencyMs` | 🟡 `warning` |

**De-duplication:** Aynı hat + aynı severity için 60 saniye içinde tekrar alert oluşturmaz.

**Alert Yaşam Döngüsü:**
1. Koşul tetiklenir → Alert oluşturulur
2. Dashboard'da görünür → Operatör "Onayla" butonuna basar
3. Alert `acknowledged = true` olur (görünür ama soluk)

---

## ⚙️ Konfigürasyon

### Environment Variables

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `ALLOY_BRIDGE_URL` | `http://127.0.0.1:9100` | Bridge health endpoint base URL |
| `ALLOY_BRIDGE_SECRET` | — | Bridge kimlik doğrulama anahtarı (boşsa watchdog devre dışı) |

### MetroWatchdogConfig

| Parametre | Varsayılan | Açıklama |
|-----------|-----------|----------|
| `pollIntervalMs` | `10000` | Her kontrol arası milisaniye |
| `downThreshold` | `3` | Kaç ardışık başarısızlık sonra "down" |
| `degradedLatencyMs` | `2000` | Latency eşik değeri |

---

## 🔍 Hat Kontrol Detayları

### 🔴 Event Bus Kontrolü

EventBus'un replay buffer'ını analiz eder:
- **Error sayısı:** `agent:error` event sayısı > 3 ise anomali
- **Circuit breaker:** `circuit:open` event varsa anomali
- **Dead letter:** `bridge:dead_letter` event varsa anomali
- **Sonuç:** Anomali yoksa `healthy`, varsa `degraded`

### 🔵 REST API Kontrolü

Bridge'in `/status` endpoint'ine HTTP GET isteği:
- **200 + tüm bileşenler sağlıklı** → `healthy`
- **200 + bazı bileşenler unhealthy** → `degraded`
- **Non-200 veya timeout** → `down`

### 🟢 WebSocket/SSE Kontrolü

EventBus'taki `bridge:health` event'lerini analiz eder:
- **bridge:health.available === true** → `healthy`
- **bridge:health.available === false** → `down`
- **Event yoksa** → `healthy` (varsayılan)

### 🟡 VS Code Protocol Kontrolü

Dolaylı kontrol — UI log activity varlığına bakar:
- **UI log event var** → `unknown` (aktivite tespit edildi)
- **UI log event yok** → `unknown` (aktivite tespit edilmedi)

> Not: VS Code extension'ın doğrudan bir health endpoint'i yoktur. Bu hat `unknown` olarak kalabilir.

### 🟣 MCP Stdio Kontrolü

Bridge'in `/health` endpoint'ine HTTP GET isteği:
- **200 + initialized: true** → `healthy`
- **200 + initialized: false** → `degraded`
- **Non-200 veya timeout** → `down`

---

## 🖥️ Console Dashboard

`/metro` route'unda erişilen gerçek zamanlı dashboard:

### Özellikler

1. **Hat Durum Kartları** — 5 kartlık grid, her hat için:
   - Durum göstergesi (yeşil/sarı/kırmızı/gri)
   - Mesaj ve latency bilgisi
   - Son kontrol zamanı

2. **Mini Metro Gösterimi** — Hatların görsel bağlantı haritası

3. **Alert Paneli** — Aktif alertler:
   - Severity badge (KRİTİK / UYARI / BİLGİ)
   - Tek tek onaylama butonu
   - Onaylanmış alertler soluk gösterim

4. **Canlı Akış** — SSE ile otomatik güncelleme:
   - Bağlantı kesilirse 5s sonra otomatik yeniden bağlanma
   - CANLI / DURDU göstergesi

---

## 🧪 Test Senaryoları

### Senaryo 1: Bridge Çökerse

```
1. Bridge process kapanır
2. Watchdog → checkRestApi() → fetch timeout → status: "down"
3. Watchdog → checkMcp() → fetch timeout → status: "down"
4. consecutiveFailures artar
5. 3. Ardışık başarısızlık → 🔴 CRITICAL alert: "🔵 REST API is DOWN"
6. Dashboard'da kırmızı yanar
```

### Senaryo 2: Circuit Breaker Tetiklenirse

```
1. Provider hata verir
2. EventBus'a circuit:open event yayınlanır
3. Watchdog → checkEventBus() → circuitOpen: true → status: "degraded"
4. 🟡 WARNING alert: "🔴 Event Bus is DEGRADED"
5. Dashboard'da sarı yanar
```

### Senaryo 3: Yüksek Latency

```
1. Bridge /status çağrısı > 2000ms sürer
2. Watchdog → latencyMs > degradedLatencyMs
3. 🟡 WARNING alert: "🔵 REST API high latency: 2500ms"
```

---

## 📊 Veri Akışı

```
MetroWatchdog (10s interval)
    │
    ├── checkEventBus() → GlobalEventBus.getReplayBuffer()
    ├── checkRestApi()  → fetch(bridge/status)
    ├── checkWsSse()    → GlobalEventBus.getReplayBuffer()
    ├── checkVsCode()   → GlobalEventBus.getReplayBuffer()
    ├── checkMcp()      → fetch(bridge/health)
    │
    ├── evaluateAlertRules() → MetroAlert[]
    ├── computeOverallStatus() → "healthy" | "degraded" | "down"
    │
    ├── MetroHealthSnapshot üretilir
    └── EventBus'e ui:log yayınlanır

GET /api/metro/health
    → watchdog.getSnapshot() → JSON yanıt

GET /api/metro/health/stream
    → 5s interval → watchdog.getSnapshot() → SSE data frame

Console /metro
    → SSE stream → useMetroStore → MetroStatusView rerender
```

---

*Bu doküman, Metro Watchdog sisteminin mimarisini, API'lerini ve çalışma mantığını açıklar. Sistemde değişiklik yapıldığında bu dokümanı güncelleyin.*