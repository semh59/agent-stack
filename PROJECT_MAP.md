# 🗺️ Alloy AI Platform — Detaylı Proje Haritası

> Son güncelleme: Nisan 2026

---

## 📌 Proje Özeti

**Alloy AI Platform** (`alloy-ai-platform`, v1.0.0), çok-sağlayıcılı bir LLM gateway'i ve canlı prompt optimizasyon pipeline'ıdır. Prompt token'larını LLM sağlayıcılarına göndermeden önce optimize eder — sıkıştırır, önbelleğe alır ve akıllıca yönlendirir. TypeScript Gateway + Python Bridge'den oluşan **2 süreçli polyglot monorepo** mimarisine sahiptir.

**Hedef Ortam:** AWS ECS Fargate

### Yüksek Seviye Mimari

```
İstemci (Browser/CLI/VS Code)
    │
    ▼
[ALB:443]
    │
    ▼
┌─────────────────────────────────────────────┐
│  Gateway (TypeScript/Fastify, Port 3000)    │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │  OAuth   │ │  REST    │ │  WebSocket  │ │
│  │  Plugin  │ │  API     │ │  UI Bridge  │ │
│  └──────────┘ └────┬─────┘ └─────────────┘ │
│                    │                        │
└────────────────────┼────────────────────────┘
                     │ HTTP (dahili VPC)
                     ▼
┌─────────────────────────────────────────────┐
│  Bridge (Python/aiohttp, Port 9100)        │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │  MCP     │ │  Cache   │ │  RAG        │ │
│  │  Server  │ │  (Lance) │ │  (Chroma)   │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │Compress  │ │ Pipeline │ │  MAB/Bandit │ │
│  │LLMLingua │ │ Engine   │ │  Routing    │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
└────────────────────┬────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       Ollama    OpenRouter   Claude
       (Local)   (API)       (API)
```

---

## 📁 Kök Dizin Yapısı

```
alloy-core/
├── .gitignore
├── .mcp.json                        # MCP sunucu konfigürasyonu
├── infra/docker/docker-compose.unified.yml  # Birleşik Docker Compose
├── package.json                     # Monorepo root package.json
├── package-lock.json
├── README.md                        # Proje tanıtım dosyası
│
├── core/
│   ├── gateway/                     # 🟦 TypeScript/Fastify AI Gateway
│   └── bridge/                      # 🐍 Python/aiohttp Optimizasyon Köprüsü
├── interface/
│   ├── console/                     # ⚛️ React + Vite Dashboard
│   └── extension/                   # 🧩 VS Code Extension
├── docs/                            # 📚 Platform dokümantasyonu
├── infra/
│   ├── terraform/                   # ☁️ AWS IaC
│   └── docker/                      # 🐳 Docker Compose & Dockerfile'lar
├── tools/                           # 🔧 Geliştirme araçları
└── context/                         # 🧠 Agent bağlam dosyaları
```

---

## 🟦 Gateway (`core/gateway/`) — TypeScript/Fastify

### Genel Bakış
Gateway, platformun ana giriş noktasıdır. 3 ana yetenek katmanı vardır:

1. **Alloy Plugin** — OAuth doğrulama ve model proxy
2. **Fastify HTTP/WS Server** — REST API + WebSocket + statik UI serving
3. **Orchestration Engine** — Otonom görev yönetimi ve skill motoru

### Dizin Yapısı

```
core/gateway/
├── package.json                     # @alloy/gateway paket tanımı
├── tsconfig.json                    # TypeScript konfigürasyonu (ESNext, strict)
├── tsconfig.build.json              # Build-tipi TypeScript konfigürasyonu
├── vitest.config.ts                 # Vitest test konfigürasyonu
├── eslint.config.mjs                # ESLint konfigürasyonu
├── index.ts                         # Ana giriş noktası
├── Dockerfile                       # Konteyner imajı
├── README.md / ARCHITECTURE.md / CHANGELOG.md / CONTRIBUTING.md / LICENSE
│
├── src/                             # Kaynak kodu
│   ├── main.ts                      # Uygulama başlatma
│   ├── plugin.ts                    # Alloy OAuth Plugin (AlloyCLIOAuthPlugin, GoogleOAuthPlugin)
│   ├── constants.ts                 # Uygulama sabitleri
│   ├── shims.d.ts                   # TypeScript tip shims
│   │
│   ├── api/                         # REST API Katmanı
│   │   └── routers/
│   │       ├── accounts.router.ts       # Hesap yönetimi endpoint'leri
│   │       ├── auth.router.ts           # Kimlik doğrulama endpoint'leri
│   │       ├── autonomy.router.ts       # Otonom oturum endpoint'leri
│   │       ├── chat.router.ts           # Chat endpoint'leri
│   │       ├── mission.router.ts        # Mission CRUD + state machine
│   │       ├── pipeline.router.ts       # Optimizasyon pipeline proxy
│   │       └── system.router.ts         # Sistem durumu endpoint'leri
│   │
│   ├── gateway/                     # Çekirdek Gateway Modülleri
│   │   ├── agent-handoff.ts            # Agent devri
│   │   ├── auth-gateway.ts             # Auth gateway mantığı
│   │   ├── auth-server.ts              # OAuth sunucu implementasyonu
│   │   ├── auth-server.test.ts         # Auth sunucu testleri
│   │   ├── autonomy-session-manager.ts # Otonom oturum yöneticisi
│   │   ├── autonomy-session-manager.test.ts
│   │   ├── browser-launcher.ts         # Tarayıcı başlatma (OAuth flow)
│   │   ├── circuit-breaker.ts          # Circuit breaker deseni (per-endpoint)
│   │   ├── claude-provider.ts          # Claude sağlayıcı adaptörü
│   │   ├── cost-bridge.ts              # Maliyet köprüsü
│   │   ├── event-bus.ts                # Olay veri yolu
│   │   ├── gateway.ts                  # Ana gateway mantığı
│   │   ├── gateway-auth-manager.ts     # Gateway auth yöneticisi
│   │   ├── google-provider.ts          # Google/Gemini sağlayıcı adaptörü
│   │   ├── index.ts                    # Modül dışa aktarımları
│   │   ├── model-router.ts             # Sağlayıcıya özgü model routing
│   │   ├── oauth-port.ts               # OAuth port yönetimi
│   │   ├── pipeline-optimizer.ts       # Pipeline optimizasyonu
│   │   ├── pkce.ts                     # PKCE (Proof Key for Code Exchange)
│   │   ├── provider-types.ts           # Sağlayıcı tip tanımları
│   │   ├── rest-middleware.ts          # REST ara katman
│   │   ├── rest-response.ts            # REST yanıt yardımcıları
│   │   ├── server.ts                   # Fastify sunucu kurulumu
│   │   ├── task-delegator.ts           # Görev delege sistemi
│   │   ├── token-store.ts              # Token depolama
│   │   ├── webview-bootstrap.ts        # WebView başlatma
│   │   ├── routes/
│   │   │   ├── delegate.ts             # Delege route'ları
│   │   │   └── optimize.ts             # Optimizasyon route'ları
│   │   └── *.test.ts                   # Çeşitli test dosyaları
│   │
│   ├── orchestration/               # Orkestrasyon Motoru
│   │   ├── SkillEngine.ts              # Yetenek (skill) motoru
│   │   ├── autonomous-loop-engine.ts   # Otonom döngü motoru
│   │   ├── SessionPersistenceManager.ts # Oturum kalıcılıık yönetimi
│   │   └── engine/
│   │       └── autonomy-session-manager.ts # Alt seviye oturum yöneticisi
│   │
│   └── utils/                       # Yardımcı fonksiyonlar
```

---

## 🐍 Bridge (`core/bridge/`) — Python/aiohttp

### Genel Bakış
Bridge, prompt optimizasyon pipeline'ının kalbidir. 2 çalışma modu vardır:

1. **Stdio MCP Sunucusu** — Claude Code ile stdio üzerinden iletişim
2. **HTTP REST Köprüsü** — Gateway ile HTTP üzerinden iletişim (auth: `ALLOY_BRIDGE_SECRET` header)

### Dizin Yapısı

```
core/bridge/
├── server.py                        # Stdio MCP sunucusu (9 araç kaydı)
├── bridge.py                        # HTTP REST köprüsü (aiohttp)
├── config.py                        # Pydantic Settings (ALLOY_ env prefix)
├── dependencies.py                  # Bağımlılık sağlık denetleyicisi
├── metrics.py                       # Performans metrikleri
├── Dockerfile                       # Konteyner imajı
├── docker-compose.yml               # Bridge Docker Compose
├── pyproject.toml                   # Python proje tanımı
├── requirements.txt                 # Python bağımlılıkları
├── pyrightconfig.json               # Pyright tip denetimi konfigürasyonu
├── README.md                        # Bridge dokümantasyonu
├── .mcp.json                        # MCP konfigürasyonu
│
├── agent/                           # Agent entegrasyon katmanı
├── cache/                           # Semantik önbellek (Lance + Chroma)
├── cleaning/                        # Prompt temizleme/preprocessing
├── compression/                     # LLMLingua token sıkıştırma
├── models/                          # Pydantic veri modelleri
├── pipeline/                        # Optimizasyon pipeline motoru
├── rag/                             # Retrieval-Augmented Generation
├── scripts/                         # Yardımcı betikler
└── tests/                           # Python test suiteleri
```

### 9 MCP Aracı

| # | Araç Adı | Açıklama |
|---|---|---|
| 1 | `optimize_context` | Prompt optimizasyonu (sıkıştırma + önbellek + routing) |
| 2 | `search_docs` | Doküman arama (RAG tabanlı) |
| 3 | `index_document` | Doküman indeksleme (vektör DB'ye) |
| 4 | `get_cost_report` | Maliyet analizi raporu |
| 5 | `cache_stats` | Önbellek istatistikleri |
| 6 | `clear_cache` | Önbellek temizleme |
| 7 | `set_model_preference` | Model tercihi ayarlama |
| 8 | `get_pipeline_status` | Pipeline sağlık durumu |
| 9 | `generate_project_context` | Proje bağlamı oluşturma |

### Yapılandırma (`config.py`)
- Tüm ayarlar `ALLOY_` ortam değişkeni prefix'i ile
- Ollama URL/modelleri, OpenRouter API anahtarı
- Önbellek eşikleri, MAB parametreleri, sıkıştırma oranları

---

## 📚 Dokümantasyon (`docs/`)

| Dosya | İçerik |
|---|---|
| `ARCHITECTURE.md` | Sistem mimarisi detayları (2-süreçli yapı, veri akışı) |
| `API.md` | REST API endpoint referansı |
| `PLATFORM_PLAN.md` | Platform yol haritası ve gelecek planlar |
| `UI_ARCHITECTURE.md` | React UI bileşen mimarisi |
| `CONSOLE_UX.md` | Konsol UX tasarım rehberi |
| `SETTINGS.md` | Yapılandırma seçenekleri detayları |
| `OPERATIONS.md` | Operasyonel rehber (deploy, monitoring, troubleshooting) |
| `CONTINUOUS_IMPROVEMENT.md` | Sürekli iyileştirme planı ve süreçleri |

---

## ☁️ Altyapı (`infra/terraform/`)

```
infra/terraform/
├── README.md                        # Terraform dokümantasyonu
├── docs/                            # Altyapı dokümantasyonu
├── modules/                         # Yeniden kullanılabilir Terraform modülleri
└── envs/                            # Ortam bazlı konfigürasyon (dev, staging, prod)
```

**Hedef:** AWS ECS Fargate üzerinde konteynerize deployment

---

## 🔧 Geliştirme Araçları (`tools/`)

| Dosya | Amaç |
|---|---|
| `tools/dev-runner.js` | Geliştirme ortamı başlatıcı |
| `tools/smoke.sh` | Bash smoke test betiği |
| `tools/smoke_test.py` | Python smoke test |

---

## 🧪 Test Yaklaşımı

| Bileşen | Framework | Konum | Kapsam |
|---|---|---|---|
| Gateway API | Vitest | `core/gateway/src/**/*.test.ts` | Router'lar, server logic |
| Gateway UI | Vitest | `interface/console/src/**/*.test.tsx` | React bileşen testleri |
| Bridge | Python unittest/pytest | `core/bridge/tests/` | Pipeline, cache, RAG |
| Mission Router | Vitest | `mission.router.test.ts`, `mission.router.illegal-transition.test.ts` | State machine geçişleri |
| Auth Server | Vitest | `auth-server.test.ts` | OAuth akışları |
| Autonomy Session | Vitest | `autonomy-session-manager.test.ts` | Oturum yönetimi |

---

## 📊 Teknoloji Yığını

| Katman | Teknoloji | Versiyon |
|---|---|---|
| **Gateway Runtime** | TypeScript + Fastify 4 + tsx | ESNext |
| **Bridge Runtime** | Python + aiohttp | 3.11 |
| **UI Framework** | React + Vite | — |
| **Vektör Veritabanı** | Lance + Chroma | — |
| **ML Sıkıştırma** | LLMLingua | — |
| **ML Routing** | Thompson Sampling (MAB) | — |
| **Konteynerizasyon** | Docker + Docker Compose | — |
| **Orchestration** | AWS ECS Fargate | — |
| **IaC** | Terraform | — |
| **Test (TS)** | Vitest | — |
| **Test (PY)** | pytest/unittest | — |

### Desteklenen LLM Sağlayıcıları

| Sağlayıcı | Tip | Endpoint |
|---|---|---|
| Ollama | Yerel | `ALLOY_OLLAMA_URL` |
| OpenRouter | API | API Key tabanlı |
| Claude (Anthropic) | API | OAuth + API Key |
| OpenAI | API | API Key tabanlı |
| Google (Gemini) | API | OAuth tabanlı |
| LM Studio | Yerel | URL tabanlı |
| Azure OpenAI | Bulut | Endpoint + Key |

---

## 🔄 Veri Akışı

```
1. Kullanıcı → Gateway (REST/WS)
2. Gateway → Auth doğrulama (OAuth/Bearer)
3. Gateway → Mission/Session yönetimi
4. Gateway → Bridge HTTP proxy (/api/optimize)
5. Bridge → Önbellek kontrolü (Lance/Chroma)
6. Bridge → Prompt sıkıştırma (LLMLingua)
7. Bridge → Model seçimi (Thompson Sampling/MAB)
8. Bridge → LLM sağlayıcıya istek
9. Bridge → Yanıtı önbelleğe al + döndür
10. Gateway → Streaming yanıt → Kullanıcı
```

---

## 📋 Build & Çalıştırma

### Docker ile (Birleşik)
```bash
docker compose -f infra/docker/docker-compose.unified.yml up
```

### Geliştirme Ortamı
```bash
# Gateway
cd core/gateway && npm install && npm run dev

# Bridge
cd core/bridge && pip install -r requirements.txt && python bridge.py
```

### Test
```bash
# Gateway testleri
cd core/gateway && npm test

# Smoke test
bash tools/smoke.sh
```
