# TASK_MASTER.md

Kaynak önceliği: `ROADMAP_FULL.md` > `task.md.resolved`  
Baz alınan tracker sürümü: `task.md.resolved` — `2026-03-11 03:08`, `7596` bayt

## Bölüm 1: Tamamlananlar (Faz 0 + Faz 1 core)

Tamamlanan: 31 / Toplam: 31  
⛔ Başlamak için şunlar tamamlanmalı: Yok — bu bölüm tamamlanmış çekirdek fazları ve mevcut baz durumu tanımlar.

### Faz 0 — Temizlik ve Temel Hazırlık

- [x] 0.1 Dosya Hijyeni (tmpclaude-*, loglar, test çıktıları, .gitignore)
- [x] 0.2 BUG_REPORT.md Triage (34 bug durum kontrolü)
- [x] 0.3 plugin.ts Monolith Parçalama (2714 satır → modüller)
- [x] 0.4 appStore.ts Monolith Parçalama (1835 satır → slice'lar)
- [x] 0.4.1 Mağaza Derinlemesine Refactor & Teknik Borç Temizliği
- [x] 0.5 Dokümantasyon & Mimari Senkronizasyon (Faz 0.5)

### Faz 1 — Orkestratör Motor

- [x] 1.1 Mission-Pipeline Senkronizasyonu & State Machine
- [x] 1.2 Phase Engine (State Machine + Transition Guards)
- [x] 1.3 Gear Engine (Prompt Construction + History Squeezing)
- [x] 1.4 Gate Engine + Gate Tanımları
- [x] 1.5 Skill Sistemi (Planlama/Kodlama/Test)
- [x] 1.6 Budget Tracker (TPM/RPD Circuit Breaker)
- [x] 1.7 Event Bus Hardening (DLQ + Race Condition protection)

### 1.8 — Orkestratör test suite

- [x] 1.8 Orkestratör test suite
- [x] TaskGraphManager.test.ts
- [x] BudgetTracker.test.ts
- [x] PhaseEngine.test.ts
- [x] GearEngine.test.ts
- [x] SkillEngine.test.ts
- [x] GateEngine.test.ts
- [x] SessionPersistenceManager.test.ts
- [x] autonomous-loop-engine.test.ts migration
- [x] OrchestratorService.test.ts

### 1.9 — Hardening & Refactoring (Bridge to Phase 2)

- [x] 1.9 Hardening & Refactoring (Bridge to Phase 2)
- [x] AutonomousLoopEngine: Extract loop stages to sub-methods (Modularization)
- [x] AutonomousLoopEngine: Fix session registration & state transitions
- [x] AutonomousLoopEngine: 15+ high-coverage test suite stabilization (275/275 passed)
- [x] GateEngine: Unit tests for SecretGate, ScopeGate, ArchitectGate
- [x] Persistence: Path normalization & error recovery tests
- [x] GateEngine: Interface unification (run/runAll aliasing) & Lint fix
- [x] Interrupt Responsiveness: 3 check-points per cycle & 'stop' verify test

## Bölüm 2: Açık Borçlar — Önce Bunlar Kapatılır (PRE-FAZ-3 BLOCKER)

Tamamlanan: 27 / Toplam: 27  
⛔ Başlamak için şunlar tamamlanmalı: Bölüm 1 tamamlanmış olmalı.

Bu dört blok tamamlanmadan Faz 3'e geçilemez.  
Not: B-1, B-2, B-3 ve B-4 tamamlandı; Faz 3 başlatılabilir.

### B-1 — WebSocket Reconnect Senaryosu

Aktif bir mission çalışırken WebSocket bağlantısı kopar ve yeniden bağlanır. Bu senaryo hiçbir fazda test edilmedi.

- [x] Mock WebSocket server ile bağlantı kesme simülasyonu yaz
- [x] Bağlantı koptuğu anda aktif mission state'inin ne olduğunu kaydet
- [x] Yeniden bağlantı sonrası state'in aynı kaldığını doğrula
- [x] `missionSlice` ve `pipelineSlice` senkronizasyonunun kopmadan sonra tutarlı kaldığını doğrula
- [x] WebSocket listener'ın yeniden bağlantıda tekrar oluşturulmadığını (memory leak yok) doğrula
- [x] "Yeniden bağlantıda kaçırılan event'ler beklenmez, sadece mevcut state snapshot gönderilir" davranışını test et ve `ARCHITECTURE.md`'ye belgele
- [x] Test sonuçlarını `websocketSlice.test.ts`'e ekle

### B-2 — BudgetTracker Token Boundary

999.500 token kullanılmış, limit 1.000.000. Sıradaki istek geldiğinde sistem ne yapıyor? Bu senaryo test edilmedi.

- [x] 999.500 token kullanılmış durumu simüle et
- [x] Sıradaki istek 600 token gerektiriyorsa (limit aşılır) → soft fail: model downgrade tetiklenir, mission devam eder
- [x] Sıradaki istek 100 token gerektiriyorsa (limit içinde) → normal devam
- [x] Limit aşıldığında `budget:warning` eventi yayınlandığını doğrula
- [x] Hard stop eşiği: limit %110 aşılırsa `mission:failed` eventi yayınlandığını doğrula
- [x] Bu davranışları `BudgetTracker.test.ts`'e ekle
- [x] Soft fail → hard stop eşik değerlerini `ARCHITECTURE.md`'ye belgele

### B-3 — BudgetTracker TPM/RPD Kalibrasyonu

Sistem Antigravity üzerinde çalışıyor. USD maliyeti yok. Gerçek limit TPM ve RPD.

- [x] `BudgetLimits` interface'ine `maxTPM` ve `maxRPD` alanları ekle
- [x] USD bazlı circuit breaker'ı kaldır
- [x] TPM bazlı circuit breaker yaz: dakika içinde kullanılan token `maxTPM`'e yaklaşınca `budget:warning` yayınla
- [x] RPD bazlı circuit breaker yaz: günlük request sayısı `maxRPD`'ye yaklaşınca `budget:warning` yayınla
- [x] Dashboard'daki BudgetWidget'ı TPM/RPD gösterecek şekilde güncelle
- [x] `BudgetTracker.test.ts`'i yeni metriklerle güncelle
- [x] `ARCHITECTURE.md`'deki budget bölümünü güncelle

### B-4 — Mock Latency Simülasyonu

Gerçek Antigravity bağlantısına geçilmeden önce gerçek model davranışını simüle et.

- [x] 10 saniye gecikme simülasyonu yaz (gerçek LLM yanıt sürelerini taklit eder)
- [x] Gecikme süresinde interrupt (STOP) gelirse AbortController'ın network üzerinde doğru çalıştığını doğrula
- [x] Mission ortasında OAuth token expire simülasyonu yaz
- [x] Token expire sonrası sistemin graceful hata verdiğini (crash değil) doğrula
- [x] TPM limitine takılan mission simülasyonu yaz (dakikada çok fazla istek)
- [x] Rate limit sonrası retry-after stratejisinin doğru çalıştığını doğrula

## Bölüm 3: Faz 2 — UI Yenileme

Tamamlanan: 47 / Toplam: 49  
⛔ Başlamak için şunlar tamamlanmalı: Bölüm 1 tamamlanmış olmalı.

Not: Faz 2 roadmap alt maddeleri `ROADMAP_FULL.md` içinde bulunmadığı için bu bölüm son `task.md.resolved` sürümü ve repo yüzeyindeki UI/store izleri kullanılarak normalize edildi.

### 2.1 — Store slice entegrasyonu

- [x] Real-time telemetry ingestion
- [x] `missionSlice`: detaylı sub-phase/state enrichment
- [x] Selected-session derived maps (`sessionsById`, `timelineBySession`, `gateBySession`, `budgetBySession`, `diffBySession`)
- [x] `websocketSlice`: orchestrator event throttling (100ms)
- [x] WebSocket reconnect ve lock safety hardening
- [x] `AutonomyEvent` tipine `decision_log` event type eklenmesi
- [x] Decision confidence backend feed + WebSocket publish
- [x] BudgetTracker session snapshot refactor

### 2.2 — Dashboard yenileme

- [x] LojiNext Elite Design System
- [x] `DashboardView` ana ekranı
- [x] High-density terminal timeline
- [x] Magic Toolbar model kontrolleri
- [x] Magic Toolbar bütçe kontrolleri entegrasyonu
- [x] `DecisionMatrix`
- [x] Token velocity & efficiency analytics
- [x] `TokenUsageChart`
- [x] High-density telemetry virtualization
- [x] Gate bypass logic UI
- [x] Telemetry transparency (`DEMO` labels)
- [x] Dashboard keyboard shortcuts (`Cmd+Enter`, `Esc`)
- [x] Premium micro-animations
- [x] `prefers-reduced-motion` desteği
- [x] Explicit faz göstergesi kartı roadmap terminolojisine göre normalize edildi
- [x] Explicit dişli durumu kartı roadmap terminolojisine göre normalize edildi

### 2.3 — Plan onay ekranı

- [x] Plan onay ekranı için route/page shell
- [x] Plan summary görünümü
- [x] Approve flow
- [x] Reject/back flow
- [x] Auth/pending/error states
- [x] Plan onay ekranı testleri

### 2.4 — Mission detail + timeline sayfası

- [x] `ActivePipelineView`
- [x] `PipelineHistoryView`
- [x] Session search/select akışı
- [x] Canlı mission timeline görünümü
- [x] Artifacts / touched files paneli
- [x] Gate paneli
- [x] Budget paneli
- [x] Pause/resume/cancel kontrolleri

### 2.5 — Faz 2 doğrulama

- [x] Tasarım uyumluluk testleri
- [~] Timeline performance / virtualization testi (Gerçek `@tanstack/react-virtual` entegrasyonu yerine kontrollü mock ile doğrulanıyor; live adapter testi eksik.)
- [x] Full-cycle orchestration & telemetry sync testi
- [x] Adversarial PII masking resilience
- [x] State Machine: Illegal Transition Guard Verification
- [x] UX: Keyboard Shortcuts & Focus Management Validation
- [x] Consolidated Deep Audit Report
- [~] ArchitectGate real LLM integration (Mevcut testler bypass ve fake-client yolunu doğruluyor; canlı sağlayıcı handshake/response contract testi yok.)
- [x] taskExecutor interrupt checkpoints
- [x] touchedFiles resume re-validation
- [x] SecretGate false-negative improvement

## Bölüm 4: Faz 3 — Gateway API Genişleme

Tamamlanan: 134 / Toplam: 134  
⛔ Başlamak için şunlar tamamlanmalı: Bölüm 2 ve Bölüm 3 tamamlanmış olmalı.

### 3.1 — Persistence Kararı ve Temeli

- [x] Persistence stratejisini belgele: **SQLite + WAL + runtime snapshot source-of-truth**
  - DB dosyası `xdg-basedir` config root altında tutulur
  - `better-sqlite3` senkron driver kullanır, ama repository dış kontratı async kalır
  - `missions`, `mission_gate_results`, `mission_timeline`, `mission_budget_snapshots` tabloları migration ile açılır
  - `runtime_snapshot_json` exact resume için kalıcı tutulur
  - Üst katmanlar yalnız `MissionRepository` kontratına bağlıdır
- [x] `MissionRepository` interface'ini yaz ve genişlet (async kontrat korunur)
  ```typescript
  interface MissionRepository {
    create(mission: Mission): Promise<Mission>
    findById(id: string): Promise<Mission | null>
    update(id: string, updates: Partial<Mission>): Promise<Mission>
    list(filter?: MissionFilter): Promise<Mission[]>
    saveGateResult(...): Promise<void>
    getGateResults(...): Promise<GateResult[]>
    saveEvent(...): Promise<void>
    getTimeline(...): Promise<CursorPage<TimelineEvent>>
    saveBudgetSnapshot(...): Promise<void>
    getLatestBudget(...): Promise<BudgetStatus | null>
    saveRuntimeSnapshot(...): Promise<void>
    getRuntimeSnapshot(...): Promise<AutonomySession | null>
    findInterrupted(): Promise<Mission[]>
  }
  ```
- [x] `SQLiteMissionRepository` yaz; `InMemoryMissionRepository` test/izolasyon için korunur
  - SQLite implementasyonu her public method'da `try/catch` ile sync driver hatalarını `MissionRepositoryError` olarak sarmalar
  - WAL, foreign key, busy timeout ve bozuk DB rename/recreate davranışı aktiftir
- [x] `MissionModel` ve recovery primitive'lerini genişlet
  - Mission domain modeli ayrı tutulur; `touchedFiles`, `completedAt`, budget/gate/timeline alanları kalıcıdır
  - `MissionPersistenceSubscriber`, `StartupRecoveryCoordinator`, gateway recovery endpoint'leri ve extension startup prompt akışı eklenmiştir
- [x] Database / repository / subscriber / recovery testlerini yaz

### 3.2 — UnitOfWork Katmanı

- [x] `UnitOfWork` interface'ini yaz
- [x] `InMemoryUnitOfWork` implement et; production için `SQLiteUnitOfWork` thin facade ekle
- [x] Her servis çağrısı UoW üzerinden geçer — servis katmanı repository'e doğrudan erişemez
- [x] UoW testlerini yaz

### 3.3 — MissionService

- [x] `MissionService` yaz — Gateway ile runtime control-plane arasındaki köprü
- [x] `create(input: CreateMissionInput): Promise<Mission>` — runtime mission başlatır ve persistence bootstrap yapar
- [x] `getById(id: string): Promise<Mission>` — anlık durum, gerekirse live runtime snapshot ile overlay edilir
- [x] `getPlan(id: string): Promise<MissionPlan>` — planlama çıktısı, yoksa `PLAN_NOT_AVAILABLE`
- [x] `approve(id: string): Promise<void>` — plan onayı review checkpoint'i açar
- [x] `pause(id: string): Promise<void>` — yalnız geçerli aktif state'lerde runtime pause isteği yollar
- [x] `resume(id: string): Promise<void>` — review pending değilse runtime resume isteği yollar
- [x] `cancel(id: string): Promise<void>` — runtime cancel/stop isteği yollar
- [x] `getArtifacts(id: string, cursor?: string, limit?: number): Promise<CursorPage>` — artifact listesi service içinde cursor'lanır
- [x] `getTimeline(id: string, cursor?: string, limit?: number): Promise<CursorPage>` — repository timeline cursor page aynen döner
- [x] `getBudget(id: string): Promise<BudgetStatus>` — runtime → snapshot → mission row fallback sırasıyla çalışır
- [x] Her method UoW üzerinden repository'e erişir
- [x] MissionService testlerini yaz (UoW mock + runtime mock + logger spy ile izole)

### 3.4 — Middleware Katmanı

**FormatWrapperMiddleware:**
- [x] Tüm REST yanıtlarını `{ data, meta, errors }` formatına sar
- [x] Başarılı yanıt: `{ data: <payload>, meta: { timestamp, requestId }, errors: [] }`
- [x] Hata yanıtı: `{ data: null, meta: { timestamp, requestId }, errors: [{ code, message }] }`
- [x] 404 için özel hata kodu: `MISSION_NOT_FOUND`
- [x] 422 için özel hata kodu: `INVALID_STATE_TRANSITION`
- [x] FormatWrapperMiddleware testlerini yaz

**RateLimitMiddleware:**
- [x] API Key bazlı rate limiting implement et (IP bazlı değil)
  - Sebep: VS Code extension, Telegram bot ve CLI üç farklı kaynaktan gelir, aynı IP'de olmayabilir
- [x] Default: 100 request/dakika per API key
- [x] Limit aşılınca 429 response: `{ data: null, meta: {}, errors: [{ code: "RATE_LIMIT", retryAfter: <saniye> }] }`
- [x] RateLimitMiddleware testlerini yaz
- [x] 429 davranışını `ARCHITECTURE.md`'ye ekle

**AuthMiddleware:**
- [x] `POST /api/missions/:id/approve` endpoint'i için auth middleware yaz
  - Sebep: Plan onayı kullanıcı kararı gerektirir, otonom tetiklenemez
- [x] Auth token doğrulama mantığı
- [x] Yetkisiz istek için 401 response
- [x] AuthMiddleware testini yaz

### 3.5 — REST Endpoints

`src/api/routers/mission.router.ts` dosyasına eklenir.

**POST /api/missions**
- [x] Request body: `{ prompt: string, model?: ModelPreference }`
- [x] Validation: prompt boş olamaz, max 2000 karakter
- [x] MissionService.create() çağrısı
- [x] Response: `{ data: { id, state: "received", createdAt }, meta, errors }`
- [x] Test: geçerli prompt → 201
- [x] Test: boş prompt → 422

**GET /api/missions/:id**
- [x] MissionService.getById() çağrısı
- [x] Mission bulunamazsa → 404 `MISSION_NOT_FOUND`
- [x] Response: tam Mission objesi (state, currentPhase, currentGear, gateResults dahil)
- [x] Test: var olan mission → 200
- [x] Test: olmayan mission → 404

**GET /api/missions/:id/plan**
- [x] MissionService.getPlan() çağrısı
- [x] Plan henüz yoksa → 404 `PLAN_NOT_READY`
- [x] Response: MissionPlan objesi
- [x] Test: plan hazır → 200
- [x] Test: plan hazır değil → 404

**POST /api/missions/:id/approve**
- [x] AuthMiddleware çalışır
- [x] Mission state `plan_review` değilse → 422 `INVALID_STATE_TRANSITION`
- [x] MissionService.approve() → PhaseEngine transition tetiklenir
- [x] Response: `{ data: { id, state: "coding" }, meta, errors }`
- [x] Test: geçerli state'te onay → 200
- [x] Test: yanlış state'te onay → 422
- [x] Test: auth token yok → 401

**POST /api/missions/:id/pause**
- [x] Zaten `paused` state'indeyse → 422
- [x] MissionService.pause() çağrısı
- [x] Response: `{ data: { id, state: "paused" }, meta, errors }`
- [x] Test: çalışan mission durdurulur → 200
- [x] Test: zaten durmuş mission → 422

**POST /api/missions/:id/resume**
- [x] Sadece `paused` state'inden çalışır
- [x] MissionService.resume() → revalidateTouchedFiles (git status) → devam
- [x] Response: `{ data: { id, state: <önceki faz> }, meta, errors }`
- [x] Test: paused mission devam eder → 200
- [x] Test: paused olmayan mission → 422

**POST /api/missions/:id/cancel**
- [x] `completed` veya `failed` state'indeyse → 422
- [x] MissionService.cancel() → AbortController tetikler
- [x] Response: `{ data: { id, state: "cancelled" }, meta, errors }`
- [x] Test: aktif mission iptal → 200
- [x] Test: tamamlanmış mission iptali → 422

**GET /api/missions/:id/artifacts**
- [x] Cursor-based pagination
- [x] Query params: `?cursor=<artifact_id>&limit=50` (max 200)
- [x] Response: `{ data: [...artifacts], meta: { nextCursor, hasMore, total }, errors }`
- [x] Test: artifact listesi döner
- [x] Test: limit=200 üstü istek → 422
- [x] Test: pagination cursor doğru çalışıyor

**GET /api/missions/:id/timeline**
- [x] **Cursor-based pagination** (offset-based değil)
  - Sebep: yeni event geldiğinde offset-based'de page kayar, event atlanır
- [x] Query params: `?cursor=<event_id>&limit=50` (max 200)
- [x] Olaylar zaman sıralı (ascending)
- [x] Response: `{ data: [...events], meta: { nextCursor, hasMore }, errors }`
- [x] Test: timeline olayları döner
- [x] Test: cursor ile pagination doğru çalışıyor
- [x] Test: yeni event geldiğinde cursor'dan sonraki olaylar kaçırılmıyor

**GET /api/missions/:id/budget**
- [x] MissionService.getBudget() çağrısı
- [x] Response: `{ data: { tpm: { used, limit, percentage }, rpd: { used, limit, percentage }, cycles: { used, limit }, efficiency }, meta, errors }`
- [x] Test: budget durumu döner
- [x] Test: limit yaklaşınca warning flag var

### 3.6 — WebSocket Endpoint

`ws://127.0.0.1:51122/ws/mission/:id`

- [x] WebSocket route'u implement et
- [x] EventBus olaylarını WebSocket'e bağla:
  - [x] `mission:created`
  - [x] `phase:started`
  - [x] `phase:completed`
  - [x] `gear:started`
  - [x] `gear:completed`
  - [x] `gear:failed`
  - [x] `gate:passed`
  - [x] `gate:failed`
  - [x] `budget:warning`
  - [x] `mission:completed`
  - [x] `mission:failed`
  - [x] `decision_log` (DecisionMatrix için)
  - [x] `gate_bypass` (GateEngine bypass olayı)
  - [x] `interrupted` (kullanıcı STOP)
- [x] **Reconnect state recovery** implement et:
  - [x] İstemci bağlandığında mevcut Mission state snapshot'ını gönder
  - [x] "Kaçırılan event'ler replay edilmez, sadece mevcut state gönderilir" davranışını uygula
  - [x] Bu kararı `ARCHITECTURE.md`'deki WebSocket kataloguna yaz
- [x] Bağlantı koptuğunda WebSocket listener cleanup (memory leak yok)
- [x] Aynı mission için birden fazla client bağlanabilmeli
- [x] WebSocket testlerini yaz
- [x] B-1'deki reconnect test senaryosunu bu endpoint üzerinde çalıştır

### 3.7 — State Machine Illegal Transition Testleri (Gateway Üzerinden)

PhaseEngine'in illegal geçişleri Gateway API üzerinden da engellediğini doğrula.

- [x] `init → done` (plan ve execute atlanmış) → 422
- [x] `plan → verify` (execute atlanmış) → 422
- [x] `execute → done` (verify atlanmış) → 422
- [x] `stopped → execute` (resume olmadan) → 422
- [x] `failed → execute` (reset olmadan) → 422
- [x] `cancelled → <herhangi>` → 422
- [x] Her illegal transition için `INVALID_STATE_TRANSITION` hata kodu döner

### 3.8 — Faz 3 Doğrulama

- [x] `curl` ile tüm 10 REST endpoint'i manuel test et
- [x] `wscat` veya benzeri araç ile WebSocket mesaj akışını doğrula
- [x] Rate limit 429 response'unu doğrula
- [x] `{ data, meta, errors }` format uyumunu her endpoint için doğrula
- [x] Cursor-based pagination'ın doğru çalıştığını timeline üzerinde doğrula
- [x] `ARCHITECTURE.md`'yi güncelle:
  - [x] Tüm endpoint'leri belgele
  - [x] WebSocket event kataloğunu güncelle (yeni event'ler dahil)
  - [x] Rate limiting stratejisini belgele
  - [x] Reconnect davranışını belgele
  - [x] Persistence kararını belgele

## Bölüm 5: Faz 4 — VS Code Extension Entegrasyonu

Tamamlanan: 0 / Toplam: 50  
⛔ Başlamak için şunlar tamamlanmalı: Bölüm 4 tamamlanmış olmalı.

### 4.1 — Extension Temel Yapısı

- [ ] Extension dizin yapısını oluştur (Faz 0'da parçalanan `plugin/` yapısıyla uyumlu)
- [ ] `package.json` komut tanımları ekle
- [ ] Extension host ile Gateway arasında WebSocket bağlantısı kur
- [ ] Bağlantı kopunca otomatik reconnect mekanizması (B-1'deki reconnect stratejisini kullan)
- [ ] Extension aktivasyon ve deaktivasyon lifecycle'ını implement et
- [ ] Extension testlerini yaz

### 4.2 — Komutlar

- [ ] `lojinext.startMission` — input box aç, prompt al, `POST /api/missions` çağır
- [ ] `lojinext.viewMission` — aktif mission detayını Webview'da aç
- [ ] `lojinext.approvePlan` — plan onay ekranını aç, `POST /api/missions/:id/approve` çağır
- [ ] `lojinext.pauseMission` — aktif mission'ı durdur
- [ ] `lojinext.resumeMission` — duraklatılmış mission'ı devam ettir
- [ ] `lojinext.cancelMission` — mission'ı iptal et
- [ ] Her komut için Command Palette kaydı
- [ ] Komut testlerini yaz

### 4.3 — Status Bar

- [ ] Status bar item oluştur
- [ ] WebSocket'ten gelen `phase:started` ve `gear:started` olaylarını dinle
- [ ] Format: `● <state> — <currentGear>` (örn: `● Kodlanıyor — backend-coder`)
- [ ] Mission yokken: `○ LojNext — Hazır`
- [ ] Tıklanınca `lojinext.viewMission` komutu tetiklenir
- [ ] Status bar testini yaz

### 4.4 — Output Panel

- [ ] "LojNext" adlı Output Channel oluştur
- [ ] WebSocket'ten gelen tüm olayları Output panel'e yaz
- [ ] Log formatı: `[HH:MM:SS] [PHASE/GEAR] mesaj`
- [ ] Gate sonuçları için özel format: `✅ GATE: <gate_name> PASSED` / `❌ GATE: <gate_name> FAILED`
- [ ] Budget uyarıları için özel format: `⚠️ BUDGET: TPM %<percentage> kullanıldı`
- [ ] Output panel testini yaz

### 4.5 — Webview Panel

- [ ] Faz 2'de tamamlanan Dashboard UI'ını Webview içine taşı
- [ ] Terminal Timeline Webview'da çalışır (React Virtual virtualization dahil)
- [ ] DecisionMatrix Webview'da çalışır (decision_log event'lerini dinler)
- [ ] BudgetWidget Webview'da çalışır (TPM/RPD gösterir)
- [ ] GateStatusCard Webview'da çalışır
- [ ] MissionTimeline Webview'da çalışır
- [ ] Plan Onay Ekranı Webview'da çalışır (`approvePlan` komutu bu ekranı açar)
- [ ] Webview ile Extension host arasında mesajlaşma implement et
- [ ] Webview testlerini yaz

### 4.6 — Sequential Thinking MCP Entegrasyonu

- [ ] `@modelcontextprotocol/server-sequential-thinking` kur
- [ ] VS Code MCP konfigürasyonuna ekle
- [ ] `ArchitectGate`'in reasoning steps'ini MCP üzerinden al
- [ ] DecisionMatrix bileşenini MCP thought steps ile zenginleştir:
  - [ ] `thought` adımları timeline'da görünür
  - [ ] Her adım: "Düşünce N: ..." formatında
  - [ ] Branch kararları (alternatif yol denemeleri) ayrı renkte gösterilir
- [ ] MCP entegrasyonu testlerini yaz

### 4.7 — Faz 4 Doğrulama

- [ ] VS Code debug mode ile `lojinext.startMission` komutu çalıştır
- [ ] Status bar'ın phase değişimlerini doğru yansıttığını doğrula
- [ ] Output panel'de log akışının kesilmeden geldiğini doğrula
- [ ] Webview'da tüm bileşenlerin doğru render ettiğini doğrula
- [ ] Plan Onay Ekranının çalıştığını doğrula
- [ ] Sequential Thinking reasoning steps'in Webview'da göründüğünü doğrula
- [ ] Extension deaktive edilince tüm listener'ların temizlendiğini doğrula

## Bölüm 6: Faz 5 — Telegram Bot

Tamamlanan: 0 / Toplam: 32  
⛔ Başlamak için şunlar tamamlanmalı: Bölüm 5 tamamlanmış olmalı.

### 5.1 — Bot Temel Yapısı

- [ ] `telegram/bot.ts` oluştur
- [ ] `telegram/handlers/` dizinini oluştur
- [ ] `telegram/middleware/` dizinini oluştur
- [ ] Bot token'ı güvenli sakla:
  - [ ] `.env` içine koy
  - [ ] `SecretGate`'in taradığı pattern listesine bot token formatını ekle
  - [ ] Kod içine asla hardcode edilmez
- [ ] Bot'u `server.ts` bootstrap aşamasında başlat
- [ ] Bot testlerini yaz (mock Telegram API ile)

### 5.2 — PIN Koruması (Seviye 2 Komutlar İçin)

- [ ] PIN doğrulama middleware'i yaz (`telegram/middleware/pin-auth.ts`)
- [ ] PIN güvenli saklanır (bot token ile aynı kural)
- [ ] 3 yanlış PIN denemesi sonrası 15 dakika blok
- [ ] PIN middleware testini yaz

### 5.3 — Seviye 1: Bildirim ve İzleme

- [ ] Mission başladı bildirimi: `🚀 Mission başladı: <prompt özeti>`
- [ ] Mission tamamlandı bildirimi: `✅ Mission tamamlandı: <artifact sayısı> dosya üretildi`
- [ ] Mission hata bildirimi: `❌ Mission başarısız: <hata sebebi>`
- [ ] Gate failed bildirimi: `⚠️ Gate başarısız: <gate_name> — Onay gerekiyor` + Onayla/Reddet butonları
- [ ] `/status` komutu → aktif mission özeti (state, currentPhase, budget kullanımı)
- [ ] `/quota` komutu → TPM/RPD kota durumu (kullanılan/limit/yüzde)
- [ ] Seviye 1 testlerini yaz

### 5.4 — Seviye 2: Komutlar (PIN Korumalı)

- [ ] `/start <prompt>` → `POST /api/missions` çağırır, mission başlatır
- [ ] `/pause` → aktif mission'ı durdurur
- [ ] `/resume` → duraklatılmış mission'ı devam ettirir
- [ ] `/cancel` → aktif mission'ı iptal eder
- [ ] PIN middleware her Seviye 2 komutundan önce çalışır
- [ ] Seviye 2 testlerini yaz

### 5.5 — Faz 5 Doğrulama

- [ ] Gerçek Telegram botunda `/status` komutu → yanıt gelir
- [ ] Mission başlatılınca bildirim Telegram'a düşer
- [ ] Gate failed → Telegram'da onay/red butonları görünür
- [ ] PIN korumasız Seviye 2 komut reddedilir
- [ ] PIN ile Seviye 2 komut çalışır
- [ ] `ARCHITECTURE.md`'ye Telegram event akışını ve komut listesini ekle

## Bölüm 7: Post-Faz-5 Evrim

Tamamlanan: 0 / Toplam: 31  
⛔ Başlamak için şunlar tamamlanmalı: Bölüm 6 tamamlanmış olmalı.

### P-1 — Pilot Mission (Gerçek Antigravity Bağlantısı)

Tüm fazlar tamamlandıktan sonra yapılır. İlk kez gerçek OAuth token'ları kullanılır.

- [ ] OAuth token'larını gerçek hesaplara bağla
- [ ] Küçük ve somut bir mission seç: "Mevcut projeye basit bir utility fonksiyonu ekle ve testi yaz"
- [ ] Mission çalışırken şunları gözlemle ve kaydet:
  - [ ] TPM limitine takılıyor mu?
  - [ ] Rate limit sonrası retry-after stratejisi doğru çalışıyor mu?
  - [ ] Gerçek model yanıt sürelerinde AbortController interrupt doğru çalışıyor mu?
  - [ ] OAuth token expire oluyor mu, oluşursa sistem nasıl tepki veriyor?
  - [ ] WebSocket bağlantısı gerçek ortamda stabil mi?
- [ ] Gözlemlenen her sorunu belgele ve sonraki adımlara ekle

### P-2 — Gerçek Ortam Kalibrasyonu

Pilot mission sonrası gerçek limitler görüldükten sonra yapılır.

- [ ] Gerçek TPM limitini ölç (hesap başına)
- [ ] Gerçek RPD limitini ölç (hesap başına)
- [ ] BudgetTracker'daki default limit değerlerini gerçek değerlerle güncelle
- [ ] Soft fail eşiğini gerçek verilere göre kalibre et
- [ ] Multi-account rotation'ın (mevcut Antigravity özelliği) gerçek ortamda çalıştığını doğrula
- [ ] Her hesap için ayrı TPM/RPD sayacı olduğunu doğrula

### P-3 — SkillGenerator Dişlisi

- [ ] `GearEngine`'e yeni dişli ekle: `SkillGenerator`
- [ ] `SkillGenerator` skill dosyasını yaz (`skills/shared/skill-generator.md`)
- [ ] Çalışma mantığı:
  - [ ] GearEngine mevcut skill'leri tarar
  - [ ] Gelen görev için uygun skill bulunamazsa `SkillGenerator` tetiklenir
  - [ ] `SkillGenerator` görevi analiz eder ve yeni skill dosyası yazar
  - [ ] Yazılan skill `ArchitectGate`'den geçer (ARCHITECTURE.md ile tutarlı mı?)
  - [ ] Gate geçerse `skills/` klasörüne kaydedilir ve `SkillEngine`'e register edilir
  - [ ] Gate geçmezse düzeltilir ve tekrar gönderilir
- [ ] SkillGenerator testlerini yaz

### P-4 — Self-Improvement Mode

- [ ] `MissionController`'a `self-target` flag'i ekle
- [ ] `ScopeGate`'e kural ekle: self-target modunda sistem kendi `skills/*.md` dosyalarını değiştirebilir, `src/orchestration/*.ts` dosyalarına dokunamaz
- [ ] Restart-aware mekanizma: değişiklik disk'e yazılır, aktif instance'ı etkilemez, restart'tan sonra aktif olur
- [ ] Self-target mode için özel budget limiti (daha düşük — sistem kendini optimize ederken savurgan olamaz)
- [ ] İlk self-improvement mission'ı çalıştır: "Skill dosyalarını incele, zayıf olanları tespit et ve zenginleştir"
- [ ] Self-improvement mode testlerini yaz

## Bölüm 8: Doğrulama Tablosu

Tamamlanan: 0 / Toplam: 0  
⛔ Başlamak için şunlar tamamlanmalı: Önceki tüm bölümler derlenmiş olmalı.

Her fazın tamamlandığı bu koşullarla onaylanır:

| Faz | Tamamlanma Koşulu |
|---|---|
| B-1 | WebSocket reconnect testi geçiyor, `ARCHITECTURE.md`'de belgelenmiş |
| B-2 | Token boundary testi geçiyor, soft/hard stop davranışı belgelenmiş |
| B-3 | TPM/RPD circuit breaker çalışıyor, Dashboard TPM/RPD gösteriyor |
| B-4 | Mock latency, token expire, TPM limit senaryoları test geçiyor |
| Faz 3 | Tüm 10 endpoint çalışıyor, WebSocket akışı doğrulandı, tüm testler geçiyor, `ARCHITECTURE.md` güncel |
| Faz 4 | VS Code'dan mission başlatılabiliyor, tüm UI bileşenleri Webview'da çalışıyor, testler geçiyor |
| Faz 5 | Telegram'dan mission yönetilebiliyor, bildirimler geliyor, testler geçiyor |
| P-1 | Gerçek mission çalıştırıldı, gözlemler belgelendi |
| P-2 | Gerçek limit değerleri sisteme işlendi |
| P-3 | SkillGenerator en az bir yeni skill üretti ve sisteme ekledi |
| P-4 | Sistem kendi skill dosyalarını değiştirebildi, çalışan kod etkilenmedi |

## Bölüm 9: Mimari Kararlar (Değişmez)

Tamamlanan: 0 / Toplam: 0  
⛔ Başlamak için şunlar tamamlanmalı: Önceki tüm bölümler derlenmiş olmalı.

Bu kararlar alındı ve belgelendi. Yeniden tartışılmaz.

| Karar | Açıklama |
|---|---|
| LLM erişimi | Antigravity üzerinden — kanal değişebilir, orkestratör değişmez |
| State ownership | Backend Orchestrator → Source of Truth. Frontend → Authoritative Mirror |
| Rate limiting | API Key bazlı (IP değil) |
| Timeline pagination | Cursor-based (offset değil) |
| Persistence | In-memory şimdi, interface DB-ready |
| WebSocket reconnect | State snapshot gönderilir, event replay yapılmaz |
| Skill sayısı | Az ve derin (ihtiyaç olunca SkillGenerator üretir) |
| Budget birimi | TPM/RPD (USD değil) |

*Bu doküman yaşayan bir plan. Her adım tamamlandığında checkbox işaretlenir, yeni bulgular eklenir.*

## ⚠️ TUTARSIZLIK RAPORU

1. BudgetTracker çelişkisi: `task.md.resolved` içinde `[x]` görünen `BudgetTracker.test.ts`, roadmap B-3 ile USD bazlı circuit breaker'dan TPM/RPD bazlı sınırlara geçtiği için yeniden açıldı ve geçici olarak `[~]` işaretlendi. B-3 tamamlandıktan sonra maxTPM/maxRPD ile güncellenip yeniden `[x]` olarak kapatıldı.
2. Faz sırası düzeltildi: B-1, B-2, B-3 ve B-4 blokları Faz 2 ile Faz 3 arasına yerleştirildi. Bu dört blok tamamlanmadan Faz 3'e geçilemez.
3. Faz 2 eksikliği giderildi: `task.md.resolved` içindeki dağınık Faz 2 maddeleri `2.1 Store slice entegrasyonu`, `2.2 Dashboard yenileme`, `2.3 Plan onay ekranı`, `2.4 Mission detail + timeline sayfası`, `2.5 Faz 2 doğrulama` başlıkları altında yeniden düzenlendi.
4. `task.md.resolved` içinde hiç bulunmayan bölümler eklendi: `P-1`, `P-2`, `P-3`, `P-4`.
5. ROADMAP önsözü iç tutarsız: Faz 3 öncesi borçlar açıklamasında "iki senaryo" denmesine rağmen gerçek görev yapısı dört bloktan (`B-1` / `B-2` / `B-3` / `B-4`) oluşuyor. Otorite olarak gerçek blok listesi esas alındı.
6. Tracker yapısal kayması düzeltildi: Faz 2 ile ilgili çok sayıda UI/telemetri maddesi yanlışlıkla Faz 1.8 test suite bölümü içine gömülmüştü. Bunlar Bölüm 1'den çıkarılıp Bölüm 3 altında doğru faza taşındı.
7. Faz 2 kaynak eksikliği notu: `ROADMAP_FULL.md` başlığında Faz 2 tamamlanmış görünse de Faz 2 alt maddeleri dosyada yer almıyor. Bu nedenle Faz 2 görevleri son `task.md.resolved` sürümü ve repo yüzeyindeki UI/store izleriyle normalize edildi.
8. Carry-over kapsamı genişletildi: Güncel tracker yalnız B-1/B-2 benzeri Faz 3 öncesi carry-over'ları ima ederken roadmap B-3 (TPM/RPD kalibrasyonu) ve B-4 (mock latency simülasyonu) bloklarını da zorunlu açık borç olarak tanımlıyor; master dosyada bu iki blok da eklendi.
