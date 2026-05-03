# 🚇 Alloy AI Platform — Metro Haritası

> Tüm iletişim ağı, event akışları ve interface sözleşmelerinin görsel haritası.
> Son güncelleme: Mayıs 2026

---

## 📌 Harita Gösterimi

| Sembol | Anlam |
|--------|-------|
| 🔴 | **Event Bus** — Gateway içi typed async olay veri yolu |
| 🔵 | **REST API** — HTTP REST istek/yanıt |
| 🟢 | **WebSocket / SSE** — Gerçek zamanlı çift yönlü / streaming |
| 🟡 | **VS Code Protocol** — `postMessage` ile webview ↔ extension |
| 🟣 | **MCP Stdio** — Model Context Protocol stdin/stdout |
| ⬛ | **LLM Provider** — Dış LLM API çağrısı |
| 🟤 | **Veri Deposu** — SQLite / ChromaDB / LanceDB |

---

## 🗺️ Görsel Metro Haritası

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              KULLANICI KATMANI                                  │
│                                                                                 │
│   🖥️ Browser Console ──────────────── 🧩 VS Code Extension                     │
│   (React SPA)                        (Node Extension Host)                      │
│   Port: 5170/Vite                    Commands:                                  │
│   Routes:                            • alloy.start / alloy.stop                 │
│   • /auth, /projects, /chat          • alloy.openChat / alloy.openSettings      │
│   • /dashboard, /pipeline/*          • alloy.openSettings                       │
│   • /settings                                                                   │
│        │                              │                                         │
│        │ 🔵 REST (HTTP)               │ 🟡 postMessage                          │
│        │ 🔵 SSE (streaming)           │                                         │
│        │                              ▼                                         │
│        │                        📱 Webview Panel                                │
│        │                        (React SPA in VS Code)                          │
│        │                        Transport: vscode.postMessage()                 │
│        │                              │                                         │
└────────┼──────────────────────────────┼─────────────────────────────────────────┘
         │                              │ 🟡 WebviewMessage
         │                              │ (sendMessage, stopGeneration,
         │                              │  updateSettings, clearHistory, getState)
         │                              │
         │    🟡 ExtensionMessage       │
         │    (stateUpdate, chunk,      │
         │     done, error, toolUse)    │
         │ ◄────────────────────────────┘
         │
         │ 🔵 REST + 🔴 Event Bus
         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           GATEWAY KATMANI                                       │
│                                                                                 │
│   🏢 Gateway (TypeScript / Fastify 4)                                           │
│   Port: 3000 (prod) / 51122 (dev)                                               │
│                                                                                 │
│   ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐                   │
│   │ 🔌 OAuth Plugin │  │ 🌐 REST API    │  │ 📡 WebSocket    │                   │
│   │ • Google OAuth  │  │ • /api/health  │  │ • UI Bridge     │                   │
│   │ • Claude OAuth  │  │ • /api/optimize│  │ • Real-time     │                   │
│   │ • Bearer Token  │  │ • /api/mission │  │   updates       │                   │
│   └────────────────┘  │ • /api/chat    │  └─────────────────┘                   │
│                        │ • /api/auth     │         │                              │
│                        │ • /api/pipeline │         │ 🟢 WS/SSE                    │
│                        │ • /api/accounts │         │                              │
│                        │ • /api/system   │         │                              │
│                        │ • /api/autonomy │         │                              │
│                        └───────┬─────────┘         │                              │
│                                │                   │                              │
│   ┌────────────────────────────┼───────────────────┼──────────────────────────┐  │
│   │         🔴 EVENT BUS (AlloyEventBus)          │                          │  │
│   │                                              │                          │  │
│   │  agent:start / complete / error               │                          │  │
│   │  optimization:applied                         │                          │  │
│   │  provider:switch                              │                          │  │
│   │  circuit:open / circuit:close                 │                          │  │
│   │  session:create / session:destroy             │                          │  │
│   │  pipeline:start / complete / error            │                          │  │
│   │  mission:state_change                         │                          │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│   ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐           │
│   │ ⚡ Circuit       │  │ 🎯 Model Router  │  │ 📊 Cost Bridge    │           │
│   │    Breaker       │  │    (Provider     │  │    (Token Usage    │           │
│   │ (per-endpoint)   │  │     Selection)   │  │     Tracking)     │           │
│   └──────────────────┘  └──────────────────┘  └────────────────────┘           │
│                                                                                 │
│   ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐           │
│   │ 🔄 Task          │  │ 🤖 Autonomy      │  │ 🛠️ Skill Engine   │           │
│   │    Delegator     │  │    Session Mgr   │  │    (Orchestration) │           │
│   └──────────────────┘  └──────────────────┘  └────────────────────┘           │
│                                                                                 │
│   ┌──────────────────┐  ┌──────────────────┐                                   │
│   │ 🔐 Auth Server   │  │ 📋 Mission       │                                   │
│   │    (OAuth Flow)  │  │    State Machine │                                   │
│   └──────────────────┘  └──────────────────┘                                   │
│                                                                                 │
└──────────────────────────┬──────────────────────────────────────────────────────┘
                           │
                           │ 🔵 HTTP (X-Bridge-Secret + X-Request-ID)
                           │     Internal VPC
                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            BRIDGE KATMANI                                       │
│                                                                                 │
│   🐍 Bridge (Python / aiohttp)                                                  │
│   Port: 9100                                                                    │
│                                                                                 │
│   ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐                   │
│   │ 🟣 MCP Stdio   │  │ 🔵 HTTP REST   │  │ 📊 Metrics      │                   │
│   │   Server       │  │   (aiohttp)    │  │   (Prometheus)  │                   │
│   │ (9 MCP araç)   │  │ • /health      │  │   Port: 9090    │                   │
│   └────────────────┘  │ • /ready       │  └─────────────────┘                   │
│        │              │ • /status      │         │                              │
│        │ 🟣           │ • /optimize    │         │                              │
│        │              │ • /cache-stats │         │                              │
│        │              │ • /cache-clear │         │                              │
│        │              │ • /cost-report │         │                              │
│        │              └───────┬────────┘         │                              │
│        │                      │                  │                              │
│   ┌────┴──────────────────────┴──────────────────┴──────────────────────────┐  │
│   │                    🔧 OPTİMİZASYON PİPELİNI                             │  │
│   │                                                                         │  │
│   │   1️⃣ Cache Lookup ──► 2️⃣ Classify+Score ──► 3️⃣ Layer Selection (MAB)   │  │
│   │        │                                        │                      │  │
│   │        ▼                                        ▼                      │  │
│   │   ┌─────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐               │  │
│   │   │ Exact   │  │ Semantic  │  │Compress  │  │ Dedup /  │               │  │
│   │   │ Cache   │  │ Cache     │  │LLMLingua │  │ Summarize│               │  │
│   │   │ (SQLite)│  │ (ChromaDB)│  │          │  │ / Filter │               │  │
│   │   └─────────┘  └───────────┘  └──────────┘  └──────────┘               │  │
│   │                                                                         │  │
│   │   4️⃣ Apply Layers ──► 5️⃣ Cost Tracking ──► 6️⃣ Cache Store              │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│   ┌──────────────────┐  ┌──────────────────┐                                   │
│   │ 🎲 MAB Agent     │  │ 📚 RAG Engine    │                                   │
│   │ (Thompson        │  │ (LanceDB +       │                                   │
│   │  Sampling)       │  │  Doc Indexing)   │                                   │
│   └──────────────────┘  └──────────────────┘                                   │
│                                                                                 │
└──────────────────────────┬──────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
              ▼            ▼                ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ 🦙 Ollama    │ │ 🌐 OpenRouter│ │ 🤖 Claude    │
   │ (Local LLM)  │ │ (Cloud API)  │ │ (Anthropic)  │
   │              │ │              │ │              │
   │ qwen2.5-7b   │ │ multi-model  │ │ OAuth + Key  │
   │ llama3       │ │ routing      │ │              │
   └──────────────┘ └──────────────┘ └──────────────┘
         ⬛               ⬛                ⬛

   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ 🧠 Google    │ │ 💬 OpenAI    │ │ ☁️ Azure     │
   │ (Gemini)     │ │ (GPT)        │ │ OpenAI       │
   │ OAuth based  │ │ API Key      │ │ Endpoint+Key │
   └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 🚇 Hat Detayları (Communication Lines)

### 🔴 Hat 1 — Event Bus (AlloyEventBus)

**Tip:** Gateway içi typed async olay veri yolu
**Protokol:** Node.js EventEmitter (strictly typed discriminated union)
**Kapsam:** Gateway süreci içinde — tüm modüller arasında

```
┌─────────────┐    🔴 emit("agent:start")     ┌──────────────┐
│ Skill Engine │ ──────────────────────────────►│  Event Bus   │
│             │    🔴 emit("agent:complete")   │              │
│             │ ──────────────────────────────►│  (Alloy      │
└─────────────┘                                │   EventBus)  │
                                               │              │
┌─────────────┐    🔴 emit("circuit:open")     │  Listeners:  │
│ Circuit      │ ──────────────────────────────►│  • Logger    │
│ Breaker     │                                │  • WS Bridge │
└─────────────┘                                │  • Metrics   │
                                               │  • Session   │
┌─────────────┐    🔴 emit("mission:           │    Manager   │
│ Mission      │         state_change")        │              │
│ State Machine│ ──────────────────────────────►│              │
└─────────────┘                                └──────────────┘

┌─────────────┐    🔴 emit("pipeline:start")
│ Pipeline     │ ──────────────────────────────► ...
│ Optimizer   │    🔴 emit("pipeline:complete")
└─────────────┘
```

### 🔵 Hat 2 — REST API (HTTP)

**Tip:** İstek / Yanıt
**Protokol:** HTTP/1.1 JSON
**Güvenlik:** Bearer token (Gateway), X-Bridge-Secret (Bridge)

```
Browser ──🔵 POST /api/optimize ──► Gateway ──🔵 POST /optimize ──► Bridge
         ◄──🔵 200 { optimized } ───        ◄──🔵 200 { optimized } ──

Browser ──🔵 GET /api/mission ─────► Gateway (SQLite)
         ◄──🔵 200 { missions[] } ───

Extension ─🔵 POST /api/chat ─────► Gateway ──🔴 SSE stream ──► Bridge
          ◄──🟢 SSE { chunk... } ────       ◄──🔵 200 stream ──
```

### 🟢 Hat 3 — WebSocket / SSE (Streaming)

**Tip:** Gerçek zamanlı çift yönlü / sunucu gönderimli olaylar
**Protokol:** WebSocket (upgrade) veya SSE (text/event-stream)
**Kapsam:** Gateway ↔ Console, Gateway ↔ Builder Page

```
Console (Chat)                    Gateway (WS Bridge)
    │                                   │
    │ 🟢 WS connect                     │
    │──────────────────────────────────►│
    │                                   │
    │ 🟢 WS send { type: "message" }   │
    │──────────────────────────────────►│
    │                                   │──🔴 Event Bus
    │                                   │
    │ 🟢 WS { type: "chunk" }          │
    │◄──────────────────────────────────│
    │ 🟢 WS { type: "done" }           │
    │◄──────────────────────────────────│

Builder Page (SSE)                Gateway (SSE)
    │                                   │
    │ 🔵 GET /api/build/stream (SSE)   │
    │──────────────────────────────────►│
    │                                   │
    │ 🟢 SSE event: build:chunk        │
    │◄──────────────────────────────────│
    │ 🟢 SSE event: build:complete     │
    │◄──────────────────────────────────│
```

### 🟡 Hat 4 — VS Code Webview Protocol

**Tip:** Çift yönlü mesajlaşma
**Protokol:** `vscode.postMessage()` / `window.addEventListener('message')`
**Kapsam:** Extension Host ↔ Webview Panel

```
┌─────────────────────┐                     ┌─────────────────────┐
│   📱 Webview Panel   │                     │  🧩 VS Code         │
│   (React SPA)        │                     │     Extension       │
│                      │  🟡 sendMessage     │                     │
│                      │ ──────────────────► │  _handleUserMessage │
│                      │  { type, value }    │                     │
│                      │                     │  ──🔵 REST ──► GW   │
│                      │                     │                     │
│                      │  🟡 stateUpdate     │                     │
│                      │ ◄────────────────── │  ◄──🔵 Response    │
│                      │  { type, state }    │                     │
│                      │                     │                     │
│                      │  🟡 chunk           │                     │
│                      │ ◄────────────────── │  ◄──🟢 SSE chunk   │
│                      │  { type, content }  │                     │
│                      │                     │                     │
│                      │  🟡 done            │                     │
│                      │ ◄────────────────── │                     │
│                      │  { type }           │                     │
│                      │                     │                     │
│  Kullanıcı aksiyonu  │  🟡 stopGeneration  │                     │
│  (buton tıklama)     │ ──────────────────► │  abort controller   │
│                      │                     │                     │
│  Ayar değişikliği    │  🟡 updateSettings  │                     │
│                      │ ──────────────────► │  settings sync      │
└─────────────────────┘                     └─────────────────────┘
```

### 🟣 Hat 5 — MCP Stdio Protocol

**Tip:** Model Context Protocol
**Protokol:** stdin/stdout JSON-RPC
**Kapsam:** Bridge ↔ Claude Code (veya diğer MCP istemciler)

```
Claude Code (MCP Client)          Bridge (MCP Server)
        │                               │
        │ 🟣 tools/list                 │
        │──────────────────────────────►│
        │                               │
        │ 🟣 9 araç tanımı              │
        │◄──────────────────────────────│
        │                               │
        │ 🟣 tools/call                 │
        │  { name: "optimize_context",  │
        │    arguments: {...} }         │
        │──────────────────────────────►│
        │                               │
        │ 🟣 sonuç                      │
        │◄──────────────────────────────│
```

---

## 📋 EVENT KATALOĞU

### 🔴 Event Bus Eventleri (AlloyEventBus)

Gateway içi typed event veri yolu. 13 ayrı event tipi.

| # | Event Tipi | Payload | Yön | Kaynak → Hedef |
|---|-----------|---------|-----|-----------------|
| 1 | `agent:start` | `{ agentId: string, role: string, order: number, modelName: string }` | Emit | SkillEngine → EventBus |
| 2 | `agent:complete` | `{ agentId: string, role: string, tokens: TokenUsage, fromCache: boolean }` | Emit | SkillEngine → EventBus |
| 3 | `agent:error` | `{ agentId: string, role: string, error: Error }` | Emit | SkillEngine → EventBus |
| 4 | `optimization:applied` | `{ agentId: string, report: OptimizationReport }` | Emit | PipelineOptimizer → EventBus |
| 5 | `provider:switch` | `{ from: AIProvider, to: AIProvider, reason: string }` | Emit | ModelRouter → EventBus |
| 6 | `circuit:open` | `{ provider: string, endpoint: string, failures: number }` | Emit | CircuitBreaker → EventBus |
| 7 | `circuit:closed` | `{ provider: string, endpoint: string }` | Emit | CircuitBreaker → EventBus |
| 8 | `session:create` | `{ sessionId: string, missionId: string, autonomyLevel: string }` | Emit | AutonomySessionManager → EventBus |
| 9 | `session:destroy` | `{ sessionId: string, reason: string }` | Emit | AutonomySessionManager → EventBus |
| 10 | `pipeline:start` | `{ pipelineId: string, layers: string[], model: string }` | Emit | PipelineOptimizer → EventBus |
| 11 | `pipeline:complete` | `{ pipelineId: string, tokens: TokenUsage, savings: number, layers: string[] }` | Emit | PipelineOptimizer → EventBus |
| 12 | `pipeline:error` | `{ pipelineId: string, error: Error }` | Emit | PipelineOptimizer → EventBus |
| 13 | `mission:state_change` | `{ missionId: string, from: MissionState, to: MissionState, trigger: string }` | Emit | MissionRouter → EventBus |
| 14 | `ui:log` | `{ type, id, time, source: "metro-watchdog", text, level }` | Emit | MetroWatchdog → EventBus |
| 15 | `bridge:health` | `{ type, available: boolean, latencyMs: number }` | Emit | WS Bridge → EventBus |
| 16 | `bridge:dead_letter` | `{ originalEvent, reason }` | Emit | WS Bridge → EventBus |

**Destekleyen Tipler:**

```
TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
}

OptimizationReport {
  cacheHit: boolean
  originalTokens: number
  optimizedTokens: number
  savingsRatio: number
  compressionTimeMs: number
}

EventBusConfig {
  maxReplaySize: number    // replay buffer for late subscribers
  maxQueueSize: number     // back-pressure limit
}
```

### 🟢 SSE / WebSocket Eventleri

| # | Event Tipi | Payload | Kanal | Yön |
|---|-----------|---------|-------|-----|
| 1 | `chat:chunk` | `{ content: string }` | SSE / WS | Gateway → Console |
| 2 | `chat:done` | `{}` | SSE / WS | Gateway → Console |
| 3 | `chat:error` | `{ message: string }` | SSE / WS | Gateway → Console |
| 4 | `chat:toolUse` | `{ tool: string, input: any }` | SSE / WS | Gateway → Console |
| 5 | `build:chunk` | `{ content: string }` | SSE | Gateway → Builder Page |
| 6 | `build:complete` | `{ result: BuildResult }` | SSE | Gateway → Builder Page |
| 7 | `build:error` | `{ message: string }` | SSE | Gateway → Builder Page |
| 8 | `pipeline:progress` | `{ step: string, status: string }` | SSE | Gateway → Pipeline UI |
| 9 | `mission:update` | `{ missionId: string, state: MissionState }` | WS | Gateway → Dashboard |

### 🟡 Webview ↔ Extension Mesajları

#### Webview → Extension (WebviewMessage)

| # | Mesaj Tipi | Payload | Açıklama |
|---|-----------|---------|----------|
| 1 | `sendMessage` | `{ value: string }` | Kullanıcı chat mesajı gönderir |
| 2 | `stopGeneration` | `{}` | Streaming yanıtı durdur |
| 3 | `updateSettings` | `{ settings: Partial<AlloySettings> }` | Ayar değişikliği |
| 4 | `clearHistory` | `{}` | Sohbet geçmişini temizle |
| 5 | `getState` | `{}` | Mevcut durumu iste |

#### Extension → Webview (ExtensionMessage)

| # | Mesaj Tipi | Payload | Açıklama |
|---|-----------|---------|----------|
| 1 | `stateUpdate` | `{ conversations, activeConversation, settings }` | Tam durum senkronizasyonu |
| 2 | `chunk` | `{ content: string }` | Streaming yanıt parçası |
| 3 | `done` | `{}` | Yanıt tamamlandı |
| 4 | `error` | `{ message: string }` | Hata bildirimi |
| 5 | `toolUse` | `{ tool: string, input: any }` | Araç kullanım bildirimi |

### 🟣 MCP Araç Eventleri (Stdio)

| # | Araç Adı | Girdi | Çıktı | Açıklama |
|---|---------|-------|-------|----------|
| 1 | `optimize_context` | `{ message, context?, force_layers? }` | `{ optimized, tokens, savings_percent, layers, model }` | Prompt optimizasyonu |
| 2 | `search_docs` | `{ query, top_k? }` | `{ results: DocResult[] }` | RAG doküman arama |
| 3 | `index_document` | `{ content, metadata }` | `{ indexed: boolean }` | Vektör DB indeksleme |
| 4 | `get_cost_report` | `{ period }` | `{ period, requests, tokens_original, tokens_sent, savings_percent, cost_usd_estimate }` | Maliyet raporu |
| 5 | `cache_stats` | `{}` | `{ exact: Stats, semantic: Stats }` | Önbellek istatistikleri |
| 6 | `clear_cache` | `{ tier }` | `{ cleared, evicted }` | Önbellek temizleme |
| 7 | `set_model_preference` | `{ provider, model }` | `{ set: boolean }` | Model tercihi |
| 8 | `get_pipeline_status` | `{}` | `{ components: HealthMap }` | Pipeline sağlık durumu |
| 9 | `generate_project_context` | `{ project_path }` | `{ context: string }` | Proje bağlamı üretimi |

---

## 📋 INTERFACE KATALOĞU

### 🔵 Bridge REST API

| Metod | Endpoint | Auth | İstek Body | Yanıt Body | Açıklama |
|-------|----------|------|------------|------------|----------|
| GET | `/health` | Hayır | — | `{ status, timestamp }` | Canlılık kontrolü |
| GET | `/ready` | Hayır | — | `{ ready: bool }` veya `503` | Hazırlık kontrolü |
| GET | `/status` | ✅ Secret | — | `{ ollama, openrouter, exact_cache, semantic_cache, rag, circuit_* }` | Bileşen sağlığı |
| POST | `/optimize` | ✅ Secret | `{ message, context?, force_layers? }` | `{ optimized, tokens, savings_percent, cache_hit, layers, model, metadata }` | Pipeline çalıştır |
| GET | `/cache-stats` | ✅ Secret | — | `{ exact: Stats, semantic: Stats }` | Önbellek istatistikleri |
| POST | `/cache-clear` | ✅ Secret | `{ tier }` | `{ cleared, evicted }` | Önbellek temizle |
| GET | `/cost-report` | ✅ Secret | `?period=today\|week\|month` | `{ period, requests, tokens_*, savings_percent, cost_usd_estimate }` | Maliyet raporu |

**Güvenlik:** `X-Bridge-Secret: <ALLOY_BRIDGE_SECRET>` (hmac.compare_digest, constant-time)

### 🔵 Gateway REST API

| Metod | Endpoint | Auth | Açıklama |
|-------|----------|------|----------|
| GET | `/api/health` | Hayır | Gateway canlılık |
| POST | `/api/optimize` | ✅ Bearer | Bridge proxy (502/503/504 çeviri) |
| GET | `/api/mission` | ✅ Bearer | Mission listesi |
| POST | `/api/mission` | ✅ Bearer | Mission oluştur |
| GET | `/api/mission/:id` | ✅ Bearer | Mission detay |
| PATCH | `/api/mission/:id` | ✅ Bearer | Mission güncelle (state machine) |
| DELETE | `/api/mission/:id` | ✅ Bearer | Mission sil |
| POST | `/api/chat` | ✅ Bearer | Chat mesajı (SSE streaming) |
| GET | `/api/chat/history` | ✅ Bearer | Sohbet geçmişi |
| POST | `/api/auth/login` | ✅ OAuth | OAuth giriş |
| POST | `/api/auth/callback` | ✅ OAuth | OAuth geri dönüş |
| POST | `/api/auth/logout` | ✅ Bearer | Oturum kapatma |
| GET | `/api/pipeline` | ✅ Bearer | Pipeline listesi |
| GET | `/api/pipeline/:id` | ✅ Bearer | Pipeline detay |
| POST | `/api/pipeline/:id/approve` | ✅ Bearer | Plan onayı |
| GET | `/api/accounts` | ✅ Bearer | Hesap listesi |
| POST | `/api/accounts` | ✅ Bearer | Hesap ekle |
| DELETE | `/api/accounts/:id` | ✅ Bearer | Hesap sil |
| GET | `/api/system/status` | ✅ Bearer | Sistem durumu |
| GET | `/api/autonomy/sessions` | ✅ Bearer | Otonom oturumlar |
| POST | `/api/autonomy/start` | ✅ Bearer | Otonom oturum başlat |
| POST | `/api/autonomy/:id/stop` | ✅ Bearer | Otonom oturum durdur |
| GET | `/api/metro/health` | ✅ Bearer | Metro ağı sağlık anlık görüntüsü |
| GET | `/api/metro/health/stream` | ✅ Bearer | SSE canlı sağlık akışı |
| GET | `/api/metro/alerts` | ✅ Bearer | Aktif uyarılar |
| POST | `/api/metro/alerts/:id/acknowledge` | ✅ Bearer | Uyarıyı onayla |
| GET | `/api/metro/lines/:lineId/history` | ✅ Bearer | Hat sağlık geçmişi |
| GET | `/api/metro/metrics` | ✅ Bearer | Watchdog operasyonel metrikleri |

**Güvenlik:** `Authorization: Bearer <ALLOY_GATEWAY_TOKEN>`
**Correlation:** Her yanıtta `X-Request-ID` header'ı

### 🟡 VS Code Extension API

#### Komutlar

| Komut ID | Açıklama | Tetikleyici |
|----------|----------|-------------|
| `alloy.start` | Gateway + Bridge başlat | Command Palette / Status Bar |
| `alloy.stop` | Gateway + Bridge durdur | Command Palette / Status Bar |
| `alloy.openChat` | Chat paneli aç | Command Palette / Side Bar |
| `alloy.openSettings` | Ayarlar paneli aç | Command Palette |

#### ChatViewProvider (Webview View)

```
ChatViewProvider implements WebviewViewProvider
├── resolveWebviewView(webviewView)
│   ├── webview.html = buildWebviewHtml()
│   ├── webview.onDidReceiveMessage → handleMessage()
│   └── alloyStore.subscribe → webview.postMessage()
│
├── _handleUserMessage(task)
│   ├── HTTP POST /api/chat
│   ├── SSE stream oku
│   └── her chunk → webview.postMessage({ type: "chunk" })
│
└── _handleStopGeneration()
    └── AbortController.abort()
```

### 🟣 MCP Stdio Protocol

```
server.py (MCP Server)
├── @server.tool("optimize_context")     → PipelineOrchestrator.optimize()
├── @server.tool("search_docs")          → RAG.search()
├── @server.tool("index_document")       → RAG.index()
├── @server.tool("get_cost_report")      → CostTracker.report()
├── @server.tool("cache_stats")          → Cache.stats()
├── @server.tool("clear_cache")          → Cache.clear()
├── @server.tool("set_model_preference") → ModelCascade.set_preference()
├── @server.tool("get_pipeline_status")  → HealthCheck.status()
└── @server.tool("generate_project_context") → ContextGenerator.generate()
```

### Zustand Store Interface'leri (Console)

```
useAlloyStore (Ana store)
├── State:
│   ├── conversations: Conversation[]
│   ├── activeConversationId: string | null
│   ├── settings: AlloySettings
│   ├── missions: Mission[]
│   ├── pipelines: Pipeline[]
│   ├── accounts: Account[]
│   ├── systemStatus: SystemStatus | null
│   └── isLoading: boolean
│
├── Actions:
│   ├── fetchConversations()          → 🔵 GET /api/chat/history
│   ├── sendMessage(content)          → 🔵 POST /api/chat (SSE)
│   ├── stopGeneration()              → AbortController
│   ├── fetchMissions()               → 🔵 GET /api/mission
│   ├── createMission(data)           → 🔵 POST /api/mission
│   ├── updateMissionState(id, state) → 🔵 PATCH /api/mission/:id
│   ├── fetchPipelines()              → 🔵 GET /api/pipeline
│   ├── approvePlan(id)               → 🔵 POST /api/pipeline/:id/approve
│   ├── fetchAccounts()               → 🔵 GET /api/accounts
│   ├── addAccount(data)              → 🔵 POST /api/accounts
│   ├── removeAccount(id)             → 🔵 DELETE /api/accounts/:id
│   ├── updateSettings(partial)       → 🔵 PATCH /api/settings
│   └── fetchSystemStatus()           → 🔵 GET /api/system/status

useAppStore (Legacy store)
├── chatSlice (localStorage persistence)
│   ├── messages: Message[]
│   ├── addMessage(msg)
│   └── clearMessages()

useMetroStore (Metro Watchdog Store)
├── State:
│   ├── snapshot: MetroHealthSnapshot | null     — 5 hat sağlık durumu
│   ├── isLoading: boolean                         — REST fetch durumu
│   ├── error: string | null                       — Son hata mesajı
│   ├── connectionState: ConnectionState           — SSE bağlantı durumu
│   │   (disconnected | connecting | connected | reconnecting | failed)
│   ├── reconnectAttempts: number                  — SSE yeniden bağlanma sayısı
│   └── lastUpdate: string | null                  — Son snapshot zamanı
│
├── Actions:
│   ├── fetchHealth()                   → 🔵 GET /api/metro/health
│   ├── startStream()                   → 🟢 SSE /api/metro/health/stream
│   ├── stopStream()                    → EventSource.close()
│   ├── acknowledgeAlert(alertId)       → 🔵 POST /api/metro/alerts/:id/acknowledge
│   └── reset()                         → Store sıfırla
│
├── Display Metadata:
│   ├── LINE_META    — { lineId → { label, emoji, color } }
│   ├── STATUS_META  — { status → { label, color, bg } }
│   └── LINE_ORDER   — [event_bus, rest_api, ws_sse, vscode, mcp]
│
└── SSE Auto-Reconnect:
    ├── Exponential backoff: 2s → 4s → 8s → 16s → 30s cap
    ├── Jitter: +0-1000ms random
    └── Max attempts: 10
```

---

## 🔗 İLETİŞİM AĞI MATRİSİ

Kimin kiminle nasıl konuştuğu.

| Kaynak | Hedef | Kanal | Protokol | Format |
|--------|-------|-------|----------|--------|
| Browser Console | Gateway | 🔵 REST | HTTP/JSON | Request/Response |
| Browser Console | Gateway | 🟢 SSE | text/event-stream | Streaming chunks |
| Browser Console | Gateway | 🟢 WS | WebSocket | JSON frames |
| VS Code Extension | Gateway | 🔵 REST | HTTP/JSON | Request/Response |
| VS Code Extension | Gateway | 🟢 SSE | text/event-stream | Streaming chunks |
| Webview Panel | Extension | 🟡 PostMessage | vscode.postMessage | JSON messages |
| Extension | Webview Panel | 🟡 PostMessage | webview.postMessage | JSON messages |
| Gateway (iç) | Gateway (iç) | 🔴 EventBus | Node EventEmitter | Typed discriminated union |
| Gateway | Bridge | 🔵 REST | HTTP/JSON (port 9100) | X-Bridge-Secret auth |
| Bridge | Ollama | ⬛ LLM API | HTTP/JSON | /api/generate, /api/chat |
| Bridge | OpenRouter | ⬛ LLM API | HTTPS/JSON | Bearer token |
| Bridge | Claude | ⬛ LLM API | HTTPS/JSON | OAuth + API Key |
| Bridge | ChromaDB | 🟤 Vector | HTTP (vector ops) | Embeddings |
| Bridge | LanceDB | 🟤 Vector | Local (Lance) | Embeddings |
| Bridge | SQLite | 🟤 DB | async sqlite3 | SQL queries |
| Gateway | SQLite | 🟤 DB | better-sqlite3 | SQL queries |
| Claude Code | Bridge | 🟣 MCP | stdin/stdout JSON-RPC | Tool calls |
| Prometheus | Bridge | 🔵 Scrape | HTTP (:9090/metrics) | Prometheus format |

---

## 🔄 TAM VERİ AKIŞI (End-to-End)

### Senaryo 1: Console'dan Chat Mesajı

```
Kullanıcı (Browser)
    │
    │ 🖱️ "Merhaba, bu kodu optimize et" yazıp gönder
    │
    ▼
AlloyChatShell (React)
    │ 🔵 POST /api/chat { message: "..." }
    │ Authorization: Bearer <token>
    ▼
Gateway (Fastify)
    │ ├── Auth Plugin → Token doğrula ✅
    │ ├── Chat Router → İsteği işle
    │ │   ├── 🔴 emit("agent:start", { agentId, role, model })
    │ │   │
    │ │   ├── 🔵 POST http://bridge:9100/optimize { message, context }
    │ │   │   X-Bridge-Secret: ***
    │ │   │   ▼
    │ │   │   Bridge (PipelineOrchestrator)
    │ │   │   ├── 1. Exact Cache → MISS
    │ │   │   ├── 2. Semantic Cache → MISS
    │ │   │   ├── 3. Classify → "code_optimization" (complexity: 7)
    │ │   │   ├── 4. MAB Layer Selection → ["llmlingua", "dedup"]
    │ │   │   ├── 5. Apply Layers → 29% token tasarrufu
    │ │   │   ├── 6. Cost Tracking → SQLite
    │ │   │   └── 7. Cache Store → SQLite + ChromaDB
    │ │   │       │
    │ │   │       └── ⬛ Ollama / OpenRouter → LLM çağrısı
    │ │   │           │
    │ │   │           ◄── { yanıt }
    │ │   │   ◄── { optimized, tokens, savings: 29.3% }
    │ │   │
    │ │   ├── 🔴 emit("optimization:applied", { report })
    │ │   └── 🔴 emit("agent:complete", { tokens })
    │ │
    │ └── 🟢 SSE stream → chunk, chunk, chunk, done
    │
    ▼
AlloyChatShell
    │ 🟢 SSE event: chat:chunk → mesajı ekrana yazdır
    │ 🟢 SSE event: chat:done → streaming bitti
    │
    ▼
Kullanıcı optimize edilmiş yanıtı görür ✅
```

### Senaryo 2: VS Code Extension'dan Chat

```
Kullanıcı (VS Code)
    │
    │ 🖱️ Chat panelinde mesaj yazar
    │
    ▼
Webview (React)
    │ 🟡 postMessage({ type: "sendMessage", value: "..." })
    ▼
ChatViewProvider (Extension Host)
    │ 🔵 POST /api/chat { message: "..." }
    ▼
Gateway → Bridge → LLM → yanıt
    │
    │ 🟢 SSE stream başlar
    ▼
ChatViewProvider
    │ 🟡 postMessage({ type: "chunk", content: "..." })  (her parça)
    │ 🟡 postMessage({ type: "done" })                     (bitti)
    ▼
Webview (React)
    │
    ▼
Kullanıcı yanışı görür ✅
```

### Senaryo 3: Mission State Machine Geçişi

```
Kullanıcı → POST /api/mission { title, description }
                │
                ▼
Gateway MissionRouter
├── mission.created → 🔴 emit("mission:state_change", { from: null, to: "created" })
│
│ PATCH /api/mission/:id { state: "planning" }
├── validateTransition("created" → "planning") ✅
├── mission.state = "planning"
├── 🔴 emit("mission:state_change", { from: "created", to: "planning" })
│
│ PATCH /api/mission/:id { state: "executing" }
├── validateTransition("planning" → "executing") ✅
├── 🔴 emit("mission:state_change", { from: "planning", to: "executing" })
│
│ ... pipeline çalışır ...
│
│ PATCH /api/mission/:id { state: "completed" }
├── validateTransition("executing" → "completed") ✅
├── 🔴 emit("mission:state_change", { from: "executing", to: "completed" })
```

### Senaryo 4: Provider Failover (Circuit Breaker)

```
Gateway → Ollama isteği
    │
    ◄── HATA (timeout / connection refused)
    │
CircuitBreaker
├── failureCount++
├── failureCount >= threshold?
│   └── EVET → circuit OPEN
│       ├── 🔴 emit("circuit:open", { provider: "ollama", endpoint, failures })
│       └── ModelRouter
│           ├── 🔴 emit("provider:switch", { from: "ollama", to: "openrouter", reason: "circuit_open" })
│           └── OpenRouter'a yönlendir
│
│ ... resetTimeout sonrası ...
│
├── HALF-OPEN → test isteği
│   ├── Başarılı → circuit CLOSED
│   │   └── 🔴 emit("circuit:closed", { provider: "ollama" })
│   └── Başarısız → circuit tekrar OPEN
```

---

## 🏗️ BİLEŞEN İÇ DIŞAKİL BAĞIMLILIK HARİTASI

### Gateway İç Modüller

```
┌──────────────────────────────────────────────────────────────┐
│ GATEWAY                                                       │
│                                                               │
│  server.ts (Fastify başlatma)                                 │
│    ├── auth-server.ts (OAuth akışı)                           │
│    ├── event-bus.ts ←──── tüm modüller bağlanır              │
│    ├── circuit-breaker.ts → model-router.ts                   │
│    ├── task-delegator.ts → autonomy-session-manager.ts        │
│    ├── cost-bridge.ts ←── pipeline-optimizer.ts               │
│    ├── agent-handoff.ts ←── skill engine                      │
│    │                                                           │
│    ├── api/routers/                                            │
│    │   ├── accounts.router.ts                                  │
│    │   ├── auth.router.ts                                      │
│    │   ├── autonomy.router.ts                                  │
│    │   ├── chat.router.ts                                      │
│    │   ├── mission.router.ts                                   │
│    │   ├── pipeline.router.ts                                  │
│    │   ├── system.router.ts                                    │
│    │   └── metro.router.ts        ← Metro Watchdog REST/SSE    │
│    │                                                           │
│    ├── gateway/                                                │
│    │   ├── delegate.ts                                         │
│    │   ├── optimize.ts                                         │
│    │   ├── event-bus.ts                                        │
│    │   ├── metro-watchdog.ts      ← 5 hat sağlık izleme       │
│    │   └── rest-response.ts                                    │
│    │                                                           │
│    └── orchestration/                                          │
│        ├── SkillEngine.ts                                      │
│        ├── autonomous-loop-engine.ts                           │
│        ├── SessionPersistenceManager.ts                        │
│        └── engine/autonomy-session-manager.ts                  │
│                                                               │
│  🟤 SQLite (settings.db, mission state)                       │
└──────────────────────────────────────────────────────────────┘
```

### Bridge İç Modüller

```
┌──────────────────────────────────────────────────────────────┐
│ BRIDGE                                                        │
│                                                               │
│  bridge.py (aiohttp HTTP server)                              │
│  server.py (MCP stdio server)                                 │
│    │                                                           │
│    ├── pipeline/                                               │
│    │   ├── orchestrator.py → ana pipeline mantığı              │
│    │   ├── mab.py → BayesianTSAgent (Thompson Sampling)        │
│    │   └── router.py → structlog logging                       │
│    │                                                           │
│    ├── cache/                                                  │
│    │   ├── exact_cache → SQLite (fingerprint → output)         │
│    │   └── semantic_cache → ChromaDB (embedding → nearest)     │
│    │                                                           │
│    ├── compression/ → LLMLingua token sıkıştırma              │
│    ├── cleaning/ → Prompt temizleme / preprocessing            │
│    ├── rag/ → LanceDB (doküman indeksleme + arama)            │
│    ├── models/ → Pydantic veri modelleri                       │
│    │                                                           │
│    🟤 SQLite: cache.db, mab.db, cost.db                       │
│    🟤 ChromaDB: semantic embeddings                           │
│    🟤 LanceDB: RAG document vectors                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 📊 MISSION STATE MACHINE

```
                    ┌──────────┐
                    │  created │ ◄── POST /api/mission
                    └────┬─────┘
                         │ planla
                         ▼
                    ┌──────────┐
                    │ planning │ ◄── otomatik analiz
                    └────┬─────┘
                         │ onayla
                         ▼
                    ┌──────────┐
                    │approved  │ ◄── kullanıcı onayı
                    └────┬─────┘
                         │ başlat
                         ▼
                    ┌──────────┐
              ┌────►│executing │◄────┐
              │     └────┬─────┘     │
              │          │           │
              │  hata    │ tamam    │ retry
              │          ▼           │
              │    ┌──────────┐     │
              │    │completed │     │
              │    └──────────┘     │
              │                     │
              ▼                     │
        ┌──────────┐               │
        │  failed  │───────────────┘
        └──────────┘
              │
              │ iptal
              ▼
        ┌──────────┐
        │cancelled │
        └──────────┘
```

Her geçiş `mission:state_change` event'i yayar.

---

## 🛡️ GÜVENLİK KATMANI

```
Dış Dünya
    │
    │ HTTPS (ALB:443)
    ▼
┌─────────────────────────────────────────┐
│ ALB (Application Load Balancer)         │
│ • TLS termination                       │
│ • Rate limiting                         │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ Gateway                                 │
│ • Authorization: Bearer <token>         │
│ • ALLOY_GATEWAY_TOKEN doğrulama        │
│ • CORS pinned                           │
│ • Non-root container (UID 10001)        │
└────────────────┬────────────────────────┘
                 │
                 │ HTTP (dahili VPC sadece)
                 │ X-Bridge-Secret (hmac constant-time)
                 ▼
┌─────────────────────────────────────────┐
│ Bridge                                  │
│ • X-Bridge-Secret doğrulama            │
│ • CORS pinned                           │
│ • Non-root container (UID 10001)        │
│ • Asla dışarıya açık değil              │
└─────────────────────────────────────────┘
```

---

## 📈 GÖZLEMLENEBİLİRLİK HATTI

```
Gateway (pino JSON logs)
    │ stdout
    ▼
Bridge (structlog JSON logs)
    │ stdout
    ▼
Container Runtime
    │ log toplama
    ▼
┌─────────────────────────────────────────┐
│ Observability Stack                     │
│ • X-Request-ID correlation              │
│ • Prometheus (:9090/metrics)            │
│ • OpenTelemetry OTLP (opsiyonel)        │
└─────────────────────────────────────────┘
```

---

*Bu harita, Alloy AI Platform'un tüm iletişim ağını, event akışlarını ve interface sözleşmelerini göstermektedir. Herhangi bir değişiklikte bu dokümanı güncelleyin.*