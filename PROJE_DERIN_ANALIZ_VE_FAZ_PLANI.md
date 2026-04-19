# 🏗️ LojiNext AI — Sovereign AI Platform
# Proje Derin Analizi ve Faz Planlaması

**Analiz Tarihi:** 18 Nisan 2026  
**Proje Versiyonu:** AGENT v1.4.6 / ai-stack-mcp v1.0.0  
**Analiz Kapsamı:** Tüm kaynak kodlar, yapılandırma dosyaları, testler, dokümantasyon

---

## 📊 PROJE İSTATİSTİKLERİ

| Bileşen | Dil | Kaynak Dosya | Test Dosyaı | Toplam Satır |
|---------|-----|-------------|-------------|-------------|
| AGENT/src/orchestration/ | TypeScript | 39 | 29 | ~15,000 |
| AGENT/src/plugin/ | TypeScript | ~50 | ~29 | ~25,000 |
| AGENT/src/gateway/ | TypeScript | ~28 | ~8 | ~8,131 |
| AGENT/src/ (diğer) | TypeScript | ~10 | - | ~3,000 |
| AGENT/vscode-extension/ | TypeScript | 11 | - | ~2,000 |
| ai-stack-mcp/ | Python | 39 | - | ~6,778 |
| **TOPLAM** | - | **~177** | **~66** | **~60,000** |

---

## 🧩 BÖLÜM 1: KİMLİK DOĞRULAMA VE TOKEN YÖNETİMİ

### 1.1 Genel Bakış

Google Antigravity OAuth sistemi üzerinden kimlik doğrulama sağlar. Çoklu hesap desteği, otomatik token yenileme, yük dengeleme ve kota koruma mekanizmaları içerir.

### 1.2 Dosya Envanteri

| Dosya | Satır | Boyut | Sorumluluk |
|-------|-------|-------|------------|
| `src/constants.ts` | 270 | 8.2 KB | OAuth sabitleri, endpoint tanımları, başlık stilleri |
| `src/antigravity/oauth.ts` | ~200 | - | OAuth token değişimi (authorize → exchange) |
| `src/plugin/auth.ts` | 46 | 1.8 KB | Token doğrulama ve yenileme yardımcıları |
| `src/plugin/token.ts` | ~150 | - | Access token yenileme mantığı |
| `src/plugin/accounts.ts` | 1.075 | 41.5 KB | Çoklu hesap yönetimi, yük dengeleme, rate limit hesaplama |
| `src/plugin/quota.ts` | 345 | 12 KB | Kota kontrolü (API kullanım istatistikleri) |
| `src/plugin/cache.ts` | 202 | 7.1 KB | Auth ve imza önbellekleme |
| `src/plugin/cache/signature-cache.ts` | ~150 | - | Disk tabanlı imza kalıcılığı |
| `src/plugin/config/schema.ts` | ~200 | - | Zod tabanlı yapılandırma şeması |
| `src/plugin/config/loader.ts` | ~100 | - | Yapılandırma dosya yükleme |
| `src/plugin/persist-account-pool.ts` | 169 | 5.9 KB | Hesap havuzu kalıcılığı |
| `src/plugin/refresh-queue.ts` | 284 | 8.9 KB | Token yenileme kuyruğu |
| `src/plugin/key-manager.ts` | 144 | 5.1 KB | API anahtar yönetimi |
| `src/plugin/fingerprint.ts` | 188 | 5.8 KB | Cihaz parmak izi |
| `src/plugin/server.ts` | ~150 | - | OAuth callback sunucusu |
| `src/plugin/project.ts` | 279 | 9.1 KB | Google Cloud projesi keşfi |
| `src/gateway/auth-server.ts` | 229 | - | Gateway OAuth callback sunucusu |
| `src/gateway/token-store.ts` | 277 | - | Token depolama yönetimi |
| `src/gateway/browser-launcher.ts` | 87 | - | Tarayıcı OAuth akışı başlatma |
| `src/gateway/gateway-auth-manager.ts` | 161 | - | Gateway kimlik doğrulama yöneticisi |
| `src/gateway/oauth-port.ts` | 46 | - | OAuth port yönetimi |

### 1.3 Faz Planlaması

#### Faz 1A: OAuth Temel Akış
- **Amaç:** Google Antigravity ile temel kimlik doğrulama
- **Kapsam:** `constants.ts`, `oauth.ts`, `auth.ts`, `token.ts`
- **İşlevler:**
  - `authorizeAntigravity()` — OAuth URL oluşturma ve CSRF state
  - `exchangeAntigravity()` — Authorization code → access token değişimi
  - `accessTokenExpired()` — Token süre kontrolü
  - `refreshAccessToken()` — Token yenileme akışı
- **Endpoint Yapısı:**
  - Daily: `https://daily-cloudcode-pa.sandbox.googleapis.com`
  - Autopush: `https://autopush-cloudcode-pa.sandbox.googleapis.com`
  - Prod: `https://cloudcode-pa.googleapis.com`
- **Fallback Sırası:** daily → autopush → prod
- ** Sabitler:** Client ID, Client Secret, Scopes, Redirect URI (127.0.0.1:51121)
- **Antigravity Versiyon:** 1.15.8 (tek kaynak)

#### Faz 1B: Çoklu Hesap Yönetimi
- **Amaç:** Birden fazla Google hesabı ile çalışabilme
- **Kapsam:** `accounts.ts`, `persist-account-pool.ts`, `refresh-queue.ts`
- **Stratejiler:**
  - `sticky` — Aynı hesap, rate limit olana kadar
  - `hybrid` — Varsayılan, akıllı geçiş
  - `round-robin` — Sırayla dağıtım
- **Hesap Seçim Parametreleri:**
  - Rate limit durumu
  - Kota kullanımı (yüzde bazlı)
  - Son kullanım zamanı
  - Hata sayısı
- **Model Aileleri:** `gemini`, `claude` (ayrı rate limit takibi)

#### Faz 1C: Kota Koruma ve Rate Limit Yönetimi
- **Amaç:** API kotalarını verimli kullanma ve koruma
- **Kapsam:** `quota.ts`, `cache.ts`, `signature-cache.ts`
- **Özellikler:**
  - Soft quota threshold (varsayılan: %90)
  - Kota önbellek yenileme aralığı (varsayılan: 15 dk)
  - Kota önbellek TTL (varsayılan: auto)
  - Dual quota sistemi (Antigravity + Gemini CLI)
  - `cli_first` modu ile Gemini CLI önceliği
  - `quota_fallback` ile kota tükenince diğer kaynağa geçiş

---

## 🧩 BÖLÜM 2: İSTEK DÖNÜŞÜM PIPELINE'I

### 2.1 Genel Bakış

OpenCode'dan gelen istekleri Antigravity API formatına dönüştürür, yanıtları geri dönüştürür. SSE streaming, thinking bloğu yönetimi, schema temizleme ve oturum kurtarma içerir.

### 2.2 Dosya Envanteri

| Dosya | Satır | Boyut | Sorumluluk |
|-------|-------|-------|------------|
| `src/plugin.ts` | 2.139 | ~85 KB | Ana fetch interceptor, hesap seçimi, tüm akış |
| `src/plugin/request.ts` | ~800 | - | Antigravity API istek dönüşümü |
| `src/plugin/request-helpers.ts` | ~600 | - | Schema temizleme, thinking filtreleme |
| `src/plugin/recovery.ts` | 443 | 15 KB | Oturum kurtarma (tool_result_missing) |
| `src/plugin/thinking-recovery.ts` | ~200 | - | Thinking bloğu kurtarma, turn boundary |
| `src/plugin/event-handler.ts` | 106 | 4.4 KB | Olay işleme |
| `src/plugin/fetch-helpers.ts` | 92 | 3.2 KB | Fetch yardımcıları |
| `src/plugin/errors.ts` | 50 | 1.4 KB | Hata tanımları |
| `src/plugin/image-saver.ts` | 92 | 2.8 KB | Görüntü kaydetme |
| `src/plugin/logger.ts` | 156 | 5.3 KB | Günlük kayıt sistemi |
| `src/plugin/debug.ts` | 483 | 16.5 KB | Debug günlük kaydı |
| `src/plugin/cli.ts` | 130 | 4.3 KB | CLI arabirimi |

### 2.3 Faz Planlaması

#### Faz 2A: İstek Yakalama ve Yönlendirme
- **Amaç:** OpenCode fetch isteklerini yakalayıp Antigravity API'ye yönlendirme
- **İşlev:** `isGenerativeLanguageRequest()` → hesap seçimi → endpoint fallback
- **Hesap Seçim Akışı:**
  1. Model ailesini belirle (gemini/claude)
  2. Header stilini belirle (antigravity/gemini-cli)
  3. Aktif hesabı al veya döndür
  4. Token süresini kontrol et, gerekirse yenile
  5. İsteği hazırla ve gönder
- **Endpoint Fallback:** daily → autopush → prod (otomatik)

#### Faz 2B: Claude Özel İşlem
- **Amaç:** Claude modellerinin Antigravity üzerinden çalışması için özel dönüşümler
- **Dönüşümler:**
  - Model algılama (URL'den Claude/Gemini)
  - Thinking konfigürasyonu ekleme
  - Tüm thinking bloklarını çıkarma (imza hatası önleme)
  - Araç normalizasyonu (`functionDeclarations[]` formatına)
  - JSON Schema temizleme (izin verilen: type, properties, required, description, enum, items)
  - Dönüşümler: `const` → `enum`, boş object → placeholder
- **Tool Hallucination Prevention:** Claude'nin eğitim verisinden parametre tahmin etmesini önleyen sistem talimatı

#### Faz 2C: SSE Streaming ve İmza Önbellekleme
- **Amaç:** Gerçek zamanlı yanıt akışı ve thinking imza yönetimi
- **Özellikler:**
  - SSE TransformStream ile satır satır işleme
  - `thoughtSignature` önbellekleme (disk tabanlı)
  - Format dönüşümü: `thought: true` → `type: "reasoning"`
  - Envelope çıkarma: iç `response` objesi
- **Skip Thought Signature:** `skip_thought_signature_validator` sentinel değeri

#### Faz 2D: Oturum Kurtarma Mekanizmaları
- **Amaç:** Hata durumlarında otomatik kurtarma
- **Kurtarma Türleri:**
  1. **Tool Result Missing:** `tool_use` ids without `tool_result` → sentetik tool_result enjeksiyonu
  2. **Thinking Block Order:** "Expected thinking but found text" → turn kapatma + fresh turn
  3. **Session Error:** Genel oturum hataları → otomatik devam ("continue")
- **Konfigürasyon:** `session_recovery: true`, `auto_resume: true`, `resume_text: "continue"`

---

## 🧩 BÖLÜM 3: SIRALI PIPELINE ORKESTRASYONU

### 3.1 Genel Bakış

18 uzman ajansın sıralı/paralel olarak çalıştığı katmanlı pipeline sistemi. Her ajans önceki ajansların çıktılarını kullanır, `.ai-company/` dizininde paylaşılan bellek üzerinden iletişim kurar.

### 3.2 Dosya Envanteri

| Dosya | Satır | Boyut | Sorumluluk |
|-------|-------|-------|------------|
| `orchestration/agents.ts` | 394 | 13.5 KB | 18 ajans tanımı, 5 katman |
| `orchestration/sequential-pipeline.ts` | 877 | 38.2 KB | Ana pipeline motoru |
| `orchestration/shared-memory.ts` | 404 | 12.5 KB | Dosya tabanlı paylaşımlı bellek |
| `orchestration/prompts.yaml` | 255 | 6.5 KB | Ajans system prompt'ları |
| `orchestration/rarv-engine.ts` | ~200 | - | Reason-Act-Refine-Verify döngüsü |
| `orchestration/verification-engine.ts` | 222 | 8.2 KB | Fiziksel doğrulama motoru |
| `orchestration/checkpoint-manager.ts` | ~150 | - | Geri alma noktaları |
| `orchestration/event-bus.ts` | ~100 | - | Olay veri yolu |
| `orchestration/schemas.ts` | ~150 | - | Zod çıktı şemaları |
| `orchestration/skill-mapper.ts` | 207 | 8.1 KB | Beceri haritalama |
| `orchestration/skill-generator.ts` | 224 | 9.2 KB | Beceri üretimi |
| `orchestration/terminal-executor.ts` | 390 | 13.2 KB | Terminal komut çalıştırma |
| `orchestration/pipeline-tools.ts` | 311 | 14.8 KB | Pipeline araçları |
| `orchestration/antigravity-client.ts` | 135 | - | Antigravity API istemcisi |
| `orchestration/antigravity-api.ts` | 219 | - | Antigravity API sınıfı |
| `orchestration/antigravity-utils.ts` | 184 | - | Yardımcı fonksiyonlar |

### 3.3 Ajans Katmanları

#### Katman 1: Yönetim (Management) — Sıra 1-3
| Sıra | Rol | Ad | Model | Süre | Girdi | Çıktı |
|------|-----|----|-------|------|-------|-------|
| 1 | ceo | CEO | GEMINI_PRO | 5dk | - | ceo-brief.md |
| 2 | pm | Project Manager | GEMINI_PRO | 5dk | ceo-brief.md | pm-plan.md |
| 3 | architect | Architect | OPUS | 8dk | ceo-brief, pm-plan | architecture.md |

#### Katman 2: Tasarım (Design) — Sıra 4-6
| Sıra | Rol | Ad | Model | Süre | Girdi | Çıktı |
|------|-----|----|-------|------|-------|-------|
| 4 | ui_ux | UI/UX Designer | SONNET | 5dk | ceo, pm, arch | design-system.md |
| 5 | database | Database Designer | SONNET | 5dk | pm-plan, arch | db-schema.md |
| 6 | api_designer | API Designer | SONNET | 5dk | arch, db-schema | api-contracts.md |

#### Katman 3: Geliştirme (Development) — Sıra 7-10
| Sıra | Rol | Ad | Model | Süre | Girdi | Çıktı |
|------|-----|----|-------|------|-------|-------|
| 7 | backend | Backend Developer | SONNET | 10dk | arch, db, api | backend-report.md |
| 8 | frontend | Frontend Developer | SONNET | 10dk | design, api, arch | frontend-report.md |
| 9 | auth | Auth Developer | SONNET | 5dk | arch, api, backend | auth-report.md |
| 10 | integration | Integration Developer | SONNET | 5dk | backend, frontend, auth | integration-report.md |

#### Katman 4: Kalite (Quality) — Sıra 11-15
| Sıra | Rol | Ad | Model | Süre | Girdi | Çıktı |
|------|-----|----|-------|------|-------|-------|
| 11 | unit_test | Unit Tester | GEMINI_FLASH | 5dk | backend, frontend | unit-test-report.md |
| 12 | integration_test | Integration Tester | GEMINI_FLASH | 5dk | integration, api | integration-test-report.md |
| 13 | security | Security Auditor | OPUS | 5dk | auth, api, backend | security-audit.md |
| 14 | performance | Performance Engineer | GEMINI_FLASH | 3dk | backend, frontend, db | performance-report.md |
| 15 | code_review | Code Reviewer | OPUS | 5dk | tüm raporlar | code-review.md |

#### Katman 5: Çıkış (Output) — Sıra 16-18
| Sıra | Rol | Ad | Model | Süre | Girdi | Çıktı |
|------|-----|----|-------|------|-------|-------|
| 16 | docs | Documentation Writer | GEMINI_FLASH | 3dk | arch, api, review | documentation.md |
| 17 | tech_writer | Tech Writer | GEMINI_FLASH | 3dk | docs, pm-plan | changelog-entry.md |
| 18 | devops | DevOps Engineer | SONNET | 5dk | arch, review, security | deployment-plan.md |

**Toplam Tahmini Süre:** ~93 dakika (tam pipeline)

### 3.4 Paralel Aşama Gruplama

```
Stage 1: [CEO] (sıralı)
Stage 2: [PM] (sıralı)
Stage 3: [Architect] (sıralı)
Stage 4: [UI/UX, Database] (paralel - aynı katman)
Stage 5: [API Designer] (sıralı)
Stage 6: [Backend] (sıralı)
Stage 7: [Frontend, Auth] (paralel - özel kural)
Stage 8: [Integration] (sıralı)
Stage 9: [Unit Test, Integration Test] (paralel - aynı katman)
Stage 10: [Security, Performance] (paralel - aynı katman)
Stage 11: [Code Review] (sıralı)
Stage 12: [Docs, Tech Writer] (paralel - aynı katman)
Stage 13: [DevOps] (sıralı)
```

### 3.5 Faz Planlaması

#### Faz 3A: Temel Pipeline İskeleti
- **Amaç:** Ajans tanımları ve sıralı çalıştırma
- **İşlevler:**
  - `start(userTask, options)` — Pipeline başlatma
  - `executeAgent(agent, ...)` — Tek ajans çalıştırma
  - `buildAgentPrompt(agent, context, ...)` — Prompt oluşturma
  - `executeLlmCall(agent, prompt, ...)` — LLM API çağrısı
- **Plan Modları:** full, management_only, dev_only, quality_only, custom

#### Faz 3B: Paralel Aşama ve Geri Alma
- **Amaç:** Paralel ajans çalıştırma ve hata durumunda geri alma
- **İşlevler:**
  - `groupIntoStages(agents)` — Paralel gruplama
  - `executeAgentWithRetry(agent, ...)` — 3 deneme + backtrack
  - `findBacktrackTarget(failedAgent, ...)` — Geri alma hedefi bulma
  - `recordBacktrack(from, to, reason)` — Geri alma kaydı

#### Faz 3C: RARV Döngüsü ve Doğrulama
- **Amaç:** Reason-Act-Refine-Verify döngüsü ile kalite güvencesi
- **Bileşenler:**
  - RARV Engine (Reason → Act → Refine → Verify)
  - Verification Engine (terminal komut çalıştırma + doğrulama)
  - Checkpoint Manager (git tabanlı geri alma noktaları)
- **Doğrulama Komutları:** `npm run build`, `npm run test`, `npm run typecheck`, `npm audit`

#### Faz 3D: Beceri ve Optimizasyon
- **Amaç:** Pipeline sonrası beceri üretimi ve optimizasyon
- **Bileşenler:**
  - Skill Mapper — `.agent/skills/` dizininden beceri enjeksiyonu
  - Skill Generator — Pipeline çıktılarından beceri önerileri
  - Pipeline Optimizer — Model seçimi, prompt optimizasyonu, önbellek
  - Terminal Executor — Terminal komut çalıştırma ve raporlama

---

## 🧩 BÖLÜM 4: OTONOM AJANS SİSTEMİ

### 4.1 Genel Bakış

Görev tabanlı otonom döngü motoru. Dinamik model seçimi, bütçe takibi, kalite kapıları, kapsam sınırlama ve Git otomasyonu ile tam otomatik yazılım geliştirme süreçlerini yönetir.

### 4.2 Dosya Envanteri

| Dosya | Satır | Boyut | Sorumluluk |
|-------|-------|-------|------------|
| `orchestration/autonomous-loop-engine.ts` | 1.315 | 45.8 KB | Otonom döngü motoru (ana dosya) |
| `orchestration/autonomy-types.ts` | 275 | 5.9 KB | Tip tanımları (27 tip) |
| `orchestration/autonomy-model-router.ts` | ~200 | - | Akıllı model seçici |
| `orchestration/autonomy-gate-runner.ts` | 285 | 10.6 KB | Kalite kapıları |
| `orchestration/autonomy-scope-engine.ts` | ~200 | - | Kapsam sınırlama motoru |
| `orchestration/autonomy-git-manager.ts` | ~200 | - | Git otomasyonu |
| `orchestration/GateEngine.ts` | 309 | 12.4 KB | Kapı motoru |
| `orchestration/PhaseEngine.ts` | ~200 | - | Durum makinesi motoru |
| `orchestration/GearEngine.ts` | ~150 | - | Gear yönetimi |
| `orchestration/BudgetTracker.ts` | 373 | 14.7 KB | Bütçe takip sistemi |
| `orchestration/TaskGraphManager.ts` | ~200 | - | Görev grafiği yönetimi |
| `orchestration/SkillEngine.ts` | ~150 | - | Beceri motoru |

### 4.3 Durum Makinesi

```
queued → init → plan → execute → verify → reflect → (done | retry)
                ↓        ↓         ↓
              paused   stopped   failed
```

**Durumlar:** queued, init, plan, execute, verify, reflect, paused, retry, done, failed, stopped

### 4.4 Görev Türleri

| Tür | Açıklama |
|-----|----------|
| analysis | Kod analizi, değişiklik planı |
| implementation | Gerçek kod yazma |
| refactor | Kod yeniden yapılandırma |
| test-fix | Test hatalarını düzeltme |
| verification | Kalite kontrol |
| finalize | Sonuçlandırma |

### 4.5 Gear Sistemi

| Gear | Model Kriteri | Kullanım |
|------|--------------|----------|
| fast | flash içeren modeller | Hızlı görevler |
| standard | varsayılan | Normal görevler |
| elite | opus/thinking/high içeren | Ağır görevler |

### 4.6 Bütçe Sistemi

| Parametre | Açıklama |
|-----------|----------|
| maxCycles | Maksimum döngü sayısı |
| maxDurationMs | Maksimum süre |
| maxInputTokens | Maksimum girdi token |
| maxOutputTokens | Maksimum çıktı token |
| maxTPM | Token/dakika limiti |
| maxRPD | İstek/gün limiti |

**Uyarı eşikleri:** %90 TPM veya %90 RPD → uyarı + model düşürme  
**Hard stop:** %100 TPM veya %100 RPD → görev başarısız

### 4.7 Model Geçiş Nedenleri

| Neden | Açıklama |
|-------|----------|
| INITIAL | İlk başlangıç |
| ROUTER_POLICY | Yönlendirici politikası |
| RATE_LIMIT | Rate limit sonrası |
| TIMEOUT | Zaman aşımı |
| FORMAT_ERROR | Format hatası |
| QUALITY_FAIL_RECOVERY | Kalite kapı hatası |
| BUDGET_EXCEEDED | Bütçe aşımı |

### 4.8 Faz Planlaması

#### Faz 4A: Durum Makinesi ve Görev Döngüsü
- **Amaç:** Temel otonom döngü altyapısı
- **Akış:** init → plan → execute → verify → reflect → finalize
- **Kontrol Noktaları:**
  - Wall-clock timeout kontrolü
  - Stop isteği kontrolü
  - Maksimum döngü kontrolü
  - Maksimum süre kontrolü

#### Faz 4B: Model Yönlendirme ve Bütçe
- **Amaç:** Akıllı model seçimi ve bütçe yönetimi
- **Model Politikaları:** smart_multi, fast_only, pro_only
- **Bütçe Takibi:** TPM, RPD, token sayacı, USD takibi
- **Gear Yönetimi:** fast → standard → elite geçişleri

#### Faz 4C: Kalite Kapıları ve Kapsam
- **Amaç:** Kod kalitesi güvencesi ve kapsam kontrolü
- **Kapı Türleri:** Build, TypeCheck, Lint, Test, Security Scan
- **Kapsam Politikası:** `selected_only` modu
- **Bypass Kuralları:** Dosya değişikliği yoksa veya analysis/finalize görevleri
- **Üst üste 3 kapı hatası → görev başarısız**

#### Faz 4D: Git Otomasyonu ve Beceri
- **Amaç:** Otomatik Git işlemleri ve beceri öğrenme
- **Git Modları:** auto_branch_commit, patch_only
- **Branch Stratejisi:** auto_branch/{session-id}
- **Beceri Motoru:** Görevlerden beceri çıkarma ve yeniden kullanım

---

## 🧩 BÖLÜM 5: GATEWAY VE REST API

### 5.1 Genel Bakış

Fastify tabanlı HTTP/WebSocket sunucusu. Mission REST API, WebSocket olayları, oturum yönetimi, kimlik doğrulama ve SQLite kalıcılığı sağlar.

### 5.2 Dosya Envanteri

| Dosya | Satır | Sorumluluk |
|-------|-------|------------|
| `gateway/server.ts` | 1.660 | Ana Fastify sunucusu |
| `gateway/autonomy-session-manager.ts` | 655 | Oturum yöneticisi |
| `gateway/gateway.ts` | 152 | Gateway başlatma |
| `gateway/auth-server.ts` | 229 | OAuth callback sunucusu |
| `gateway/token-store.ts` | 277 | Token depolama |
| `gateway/agent-handoff.ts` | 112 | Agent devri |
| `gateway/pipeline-optimizer.ts` | 310 | Pipeline optimizasyonu |
| `gateway/model-router.ts` | 311 | Model yönlendirici |
| `gateway/task-delegator.ts` | 271 | Görev delege edici |
| `gateway/circuit-breaker.ts` | 257 | Devre kesici |
| `gateway/claude-provider.ts` | 314 | Claude sağlayıcı |
| `gateway/google-provider.ts` | 123 | Google sağlayıcı |
| `gateway/rest-middleware.ts` | 135 | REST ara katmanı |
| `gateway/rest-response.ts` | 256 | REST yanıt formatı |
| `gateway/auth-gateway.ts` | 247 | Kimlik doğrulama geçidi |
| `gateway/cost-bridge.ts` | 144 | Maliyet köprüsü |
| `gateway/webview-bootstrap.ts` | 218 | WebView önyükleme |
| `gateway/routes/optimize.ts` | 195 | Optimizasyon rotası |
| `gateway/routes/delegate.ts` | 160 | Delege rotası |
| `gateway/event-bus.ts` | 101 | Olay veri yolu |

### 5.3 Mission REST API (10 Endpoint)

| # | Method | Path | Auth | Açıklama |
|---|--------|------|------|----------|
| 1 | POST | /api/missions | Bearer/SameOrigin | Görev oluştur |
| 2 | GET | /api/missions/:id | Bearer/SameOrigin | Görev detayı |
| 3 | GET | /api/missions/:id/plan | Bearer/SameOrigin | Plan al |
| 4 | POST | /api/missions/:id/approve | **Explicit Bearer** | Plan onayla |
| 5 | POST | /api/missions/:id/pause | Bearer/SameOrigin | Duraklat |
| 6 | POST | /api/missions/:id/resume | Bearer/SameOrigin | Devam ettir |
| 7 | POST | /api/missions/:id/cancel | Bearer/SameOrigin | İptal |
| 8 | GET | /api/missions/:id/artifacts | Bearer/SameOrigin | Artefaktlar |
| 9 | GET | /api/missions/:id/timeline | Bearer/SameOrigin | Zaman çizelgesi |
| 10 | GET | /api/missions/:id/budget | Bearer/SameOrigin | Bütçe durumu |

**Yanıt Formatı:** `{ data, meta, errors: [] }`  
**Hata Formatı:** `{ data: null, meta, errors: [{ code, message }] }`

### 5.4 WebSocket Olayları

| Olay | Açıklama |
|------|----------|
| created | Görev oluşturuldu |
| state | Durum geçişi |
| step | Aşama tamamlama |
| model_switch | Model değişimi |
| gear_completed | Gear başarılı |
| gear_failed | Gear başarısız |
| gate_result | Kalite kapı sonucu |
| gate_bypass | Kapı atlandı |
| budget | Bütçe anlık görüntüsü |
| artifact | Artefakt güncelleme |
| decision_log | Karar günlüğü |
| diff_ready | Dosya değişikliği |
| done | Görev tamamlandı |
| failed | Görev başarısız |
| stopped | Görev durduruldu |
| interrupted | Kullanıcı durdurdu |

### 5.5 SQLite Kalıcılığı

- **Veritabanı:** `~/.config/lojinext/missions.db`
- **Mod:** WAL, foreign_keys=ON, busy_timeout=5000
- **Tablolar:** missions, mission_gate_results, mission_timeline, mission_budget_snapshots
- **Kurtarma:** Başlangıçta kesintiye uğramış görevleri tara
- **Bozukluk:** `.corrupt.{timestamp}` olarak yedekle + temiz DB oluştur

### 5.6 Faz Planlaması

#### Faz 5A: Gateway İskeleti
- Fastify sunucusu, CORS, WebSocket, statik dosya hizmeti
- Token store, auth server, browser launcher
- Rate limiting (100 req/60s per identity)

#### Faz 5B: REST API ve WebSocket
- 10 mission endpoint
- WebSocket olay kataloğu
- Snapshot-only reconnect tasarımı
- İlk bağlantıda anlık durum gönderimi

#### Faz 5C: Kalıcılık ve Kurtarma
- SQLite WAL modu
- Runtime snapshot kayıt/geri yükleme
- Başlangıç kurtarma mekanizması
- SIGKILL sonrası kurtarma prosedürü

---

## 🧩 BÖLÜM 6: MCP SUNUCUSU (ai-stack-mcp/)

### 6.1 Genel Bakış

Python tabanlı Model Context Protocol sunucusu. Token optimizasyonu, RAG, önbellekleme, sıkıştırma ve temizleme işlemleri sağlar.

### 6.2 Dosya Envanteri

| Dizin | Dosyalar | Satır | Sorumluluk |
|-------|----------|-------|------------|
| kök/ | server.py, bridge.py, config.py, metrics.py | 805 | Sunucu, köprü, yapılandırma, metrikler |
| agent/ | workflow_engine.py, skill_manager.py | 217 | İş akışı ve beceri yönetimi |
| cache/ | exact.py, semantic.py, partial.py | 464 | Tam, anlamsal, kısmi önbellek |
| cleaning/ | cli_cleaner.py, dedup.py, summarizer.py, noise_filter.py | 725 | Veri temizleme |
| compression/ | caveman.py, llmlingua.py | 350 | Token sıkıştırma |
| models/ | (model dosyaları) | - | Model tanımları |
| pipeline/ | (pipeline modülleri) | - | İşlem hattı |
| rag/ | (RAG modülleri) | - | Bilgi getirme |
| tests/ | (test dosyaları) | - | Birim ve entegrasyon testleri |

**Toplam:** ~39 dosya, ~6.778 satır

### 6.3 Bağımlılıklar

| Paket | Sürüm | Amaç |
|-------|-------|------|
| mcp | >=1.0.0 | Model Context Protocol |
| chromadb | >=0.4.22 | Vektör veritabanı |
| lancedb | >=0.5.0 | Lance veritabanı |
| pyarrow | >=14.0.0 | Arrow formatı |
| llmlingua | >=0.2.2 | Token sıkıştırma |
| spacy | >=3.7.0 | NLP |
| httpx | >=0.27.0 | HTTP istemci |
| pydantic | >=2.0.0 | Veri doğrulama |
| structlog | >=23.2.0 | Yapılandırılmış günlük |
| scikit-learn | >=1.3.2 | Makine öğrenmesi |
| prometheus-client | >=0.17.0 | Metrikler |

### 6.4 Faz Planlaması

#### Faz 6A: MCP Sunucu İskeleti
- MCP protokol uygulaması
- Temel araçlar (tools)
- Bridge bağlantısı (port 9100)
- Yapılandırma yönetimi

#### Faz 6B: Önbellekleme ve RAG
- Tam eşleşme önbelleği (exact.py)
- Anlamsal önbellek (semantic.py)
- Kısmi eşleşme (partial.py)
- RAG pipeline'ı

#### Faz 6C: Sıkıştırma ve Temizleme
- Caveman sıkıştırma
- LLMLingua sıkıştırma
- CLI çıktı temizleme
- Tekilleştirme (dedup)
- Özetleme
- Gürültü filtresi

---

## 🧩 BÖLÜM 7: VS CODE EKLENTİSİ

### 7.1 Dosya Envanteri

| Dosya | Sorumluluk |
|-------|------------|
| `src/extension.ts` | Eklenti giriş noktası |
| `src/mission-panel.ts` | Görev paneli |
| `src/models.ts` | Model tanımları |
| `src/bridge-client.ts` | Bridge istemcisi |
| `src/commands.ts` | VS Code komutları |
| `src/webview/` | WebView bileşenleri |
| `resources/` | Simge dosyaları |

### 7.2 Faz Planlaması

#### Faz 7A: Eklenti İskeleti
- VS Code API entegrasyonu
- Komut kayıtları
- Durum çubuğu

#### Faz 7B: Görev Paneli
- Mission Control UI
- WebView tabanlı panel
- Gerçek zamanlı güncelleme

---

## 📋 GENEL FAZ HARİTASI VE ÖNCELİK MATRİSİ

### Faz Öncelik Sırası

```
Faz 1A ─→ Faz 1B ─→ Faz 1C (Kimlik Doğrulama)
                                    ↓
Faz 2A ─→ Faz 2B ─→ Faz 2C ─→ Faz 2D (İstek Pipeline)
                                    ↓
Faz 3A ─→ Faz 3B ─→ Faz 3C ─→ Faz 3D (Sıralı Pipeline)
                                    ↓
Faz 4A ─→ Faz 4B ─→ Faz 4C ─→ Faz 4D (Otonom Sistem)
                                    ↓
Faz 5A ─→ Faz 5B ─→ Faz 5C (Gateway & REST API)
                                    ↓
Faz 6A ─→ Faz 6B ─→ Faz 6C (MCP Sunucusu)
                                    ↓
Faz 7A ─→ Faz 7B (VS Code Eklentisi)
```

### Mevcut Durum

| Faz | Durum |
|-----|-------|
| 1A-C | ✅ Tamamlandı |
| 2A-D | ✅ Tamamlandı |
| 3A-D | ✅ Tamamlandı |
| 4A-D | ✅ Tamamlandı |
| 5A-C | ✅ Tamamlandı |
| 6A-C | ✅ Tamamlandı |
| 7A-B | ✅ Tamamlandı (v0.1.1) |

### Test Kapsamı

| Bileşen | Test Dosyası | Satır |
|---------|-------------|-------|
| Otonom Döngü | autonomous-loop-engine.test.ts | 768 |
| Budget Tracker | BudgetTracker.test.ts | 539 |
| Sequential Pipeline | sequential-pipeline.test.ts | 334 |
| Hesaplar | accounts.test.ts | 1.534 |
| İstek Yardımcıları | request-helpers.test.ts | 1.710 |
| Event Bus | event-bus.test.ts | 247 |
| API | antigravity-api.test.ts | 242 |
| Gateway | server.websocket.test.ts | 490 |
| Token Store | token-store.test.ts | 387 |

---

## 🔑 KRİTİK TASARIM KARARLARI

### 1. Thinking Bloğu Stratejisi (v2.0)
- **Karar:** Tüm thinking bloklarını çıkarma
- **Neden:** İmza bozulması riskini sıfıra indirmek
- **Sonuç:** Her turda fresh thinking, kalite kaybı yok

### 2. Paylaşılan Bellek Tasarımı
- **Karar:** Dosya tabanlı (`.ai-company/`)
- **Neden:** Süreçler arası güvenli iletişim
- **Kilitleme:** proper-lockfile + AsyncLock çift katmanlı

### 3. Dual Kota Sistemi
- **Karar:** Antigravity + Gemini CLI kotaları
- **Neden:** Toplam kota kapasitesini artırmak
- **Geçiş:** `cli_first` ve `quota_fallback` ile kontrol

### 4. Snapshot-Only Reconnect
- **Karar:** WebSocket yeniden bağlantıda olay tekrarı yok
- **Neden:** Deterministik davranış, tutarsızlık riski yok
- **Sonuç:** Bağlantıda anlık durum gönderimi

### 5. Bütçe Monotonik Tasarımı
- **Karar:** Token maliyetleri sadece artar, hiç azalmaz
- **Neden:** Muhasebe deterministikliği
- **Sonuç:** Retry/backtrack sırasında harcanan token iade edilmez

---

*Bu doküman, LojiNext AI projesinin tüm kaynak kodlarının satır satır incelenmesiyle oluşturulmuştur.*