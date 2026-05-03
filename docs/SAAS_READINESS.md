# Alloy Platform — SaaS Hazırlık Raporu

> **Tarih:** 28 Nisan 2026
> **Kapsam:** `core/`, `interface/`, `infra/`, mevcut planlar (`PLAN_01..06`), `docs/AUDIT.md`
> **Soru:** Bu proje SaaS bir ürün hâline gelmesi için neler eksik ve neler hatalı?
> **Kısa cevap:** Proje bilinçli olarak self-hosted single-tenant olarak tasarlandı; SaaS için yeniden mimari + altı yeni dikey katman gerekiyor.

---

## 0. Yönetici Özeti

`docs/PLATFORM_PLAN.md §11` (Non-goals) açıkça söylüyor:

- "No team/org features, SSO, RBAC in Phase 1–2."
- "No billing UI. Cost telemetry yes; payments no."
- "Cursor → Open stack, no SaaS lock-in."

Yani Alloy bugünkü hâliyle **bir geliştiricinin kendi makinesinde / kendi ECS hesabında çalıştırdığı bir araç**. SaaS'a dönüştürmek için altı dikey katmanın hepsi sıfırdan eklenmeli:

1. Multi-tenancy (veri modeli + izolasyon)
2. Kimlik & hesap yönetimi (signup, RBAC, SSO, API key)
3. Faturalandırma & ölçüm (Stripe, plan/abonelik, usage metering)
4. Operasyon (per-tenant gözlemlenebilirlik, rate-limit, backup, auto-scale)
5. Uyum (GDPR/KVKK, audit log, data residency, redaction)
6. Müşteri yüzü (landing/pricing, onboarding, e-posta, destek)

Ayrıca `docs/AUDIT.md` mevcut kod tabanında 3 kritik (build kırık), 9 yüksek (runtime risk) hata listeliyor; bunlar SaaS'a giden yolda zaten kapatılmalı.

---

## 1. Mimari Blokerler

### 1.1 Single-tenant veri modeli

**Tespit:**
- `core/gateway/src/persistence/migrations/004_chat_persistence.sql` — `chat_conversations` tablosunda yalnızca `owner_account TEXT NOT NULL`. `tenant_id` / `organization_id` yok.
- `mission`, `quota`, `settings`, `settings_secrets`, `chat_messages`, `cost`, `mab` — hiçbirinde tenant ayrımı yok.
- ChromaDB ve LanceDB tek koleksiyon olarak kullanılıyor (`core/bridge/rag/`); tenant başına koleksiyon yok.
- L1 exact cache anahtarı tenant ile prefix'lenmiyor (`apps/bridge/pipeline/orchestrator.py` Stage 1) → bir müşterinin cevabı diğerine dönebilir.

**Etki:** İki müşteriyi aynı kurulumda barındırırsanız veri sızıntısı kaçınılmaz.

**Yapılacak:**
- Tüm domain tablolarına `tenant_id UUID NOT NULL` + `(tenant_id, ...)` composite index.
- Cache key formatı: `cache:{tenant_id}:{fingerprint}`.
- ChromaDB: `collection_name = f"alloy_rag_{tenant_id}"`.
- Repository katmanında **enforced tenant scoping** (her query `WHERE tenant_id = :tenant`).

### 1.2 Persistence — SQLite + lokal dosya

**Tespit:**
- `docs/ARCHITECTURE.md` "State" tablosu: tüm DB'ler `${ALLOY_DATA_DIR}` altında SQLite veya lokal dosya.
- ECS task'ında `/data` volume mount; multi-instance senkronizasyonu yok.
- `ARCHITECTURE.md §What this monorepo does NOT include`: "mission state lives in SQLite inside the gateway container".

**Etki:** Yatay ölçek yok. Task restart'ta state kaybı. İki gateway task'ı tutarsız.

**Yapılacak:**
- Postgres (Aurora veya RDS) + `pgvector` → `cache.db`, `mab.db`, `cost.db`, settings, missions, chats.
- S3 → RAG corpus + diagnostic bundle.
- Redis (ElastiCache) → exact cache, MAB state, rate-limit token bucket, session store.
- ChromaDB/LanceDB → managed Qdrant veya pgvector (Chroma'yı SaaS'ta self-host etmek operasyonel külfet).

### 1.3 Bridge "trusted internal" varsayımı

**Tespit:** `core/bridge/bridge.py` tek `ALLOY_BRIDGE_SECRET` ile auth ediyor. Tenant kavramı yok. Per-tenant kuyruk, kota, izolasyon yok.

**Etki:** Bir müşterinin uzun bir LLMLingua çağrısı tüm bridge'i bloklar.

**Yapılacak:**
- Bridge isteklerine `X-Tenant-Id` header (gateway'den geliyor, HMAC ile imzalı).
- Per-tenant concurrency limit (semaphore veya `asyncio.Queue` per tenant).
- Bridge'de orchestrator state'i tenant-scoped instance.

### 1.4 Tek master key

**Tespit:** `PLATFORM_PLAN.md §6` — `ALLOY_MASTER_KEY` (32 byte env var) tüm `settings_secrets` rows'unu AES-256-GCM ile şifreliyor.

**Etki:** Tek anahtar tüm müşterilerin sırlarını koruyor; sızdığında her şey sızar.

**Yapılacak:**
- AWS KMS CMK + envelope encryption: master key KMS'te, her tenant için **data key** generate et, şifrelenmiş data key tenant kaydında dursun.
- `alloy keys rotate` CLI'sı tenant-bazlı çalışsın.

---

## 2. Kimlik & Hesap Yönetimi — Yok

### 2.1 Mevcut "auth" yanlış katman

**Tespit:** `core/gateway/src/gateway/auth-*.ts`, `core/gateway/src/google-gemini/oauth.ts`, `plugin/auth*.ts` — bunların hepsi **Alloy'un kullanıcı adına LLM provider'larına bağlanması** için. Son müşterinin Alloy'a giriş yapması için değil.

### 2.2 Eksikler

- **Kullanıcı modeli yok:** `users`, `organizations`, `memberships`, `invitations`, `roles`, `sessions`, `password_reset_tokens`, `verification_tokens`, `audit_log`.
- **Signup / signin / parola sıfırlama** yok.
- **MFA / TOTP** yok.
- **Session yönetimi** yok (revoke, "diğer cihazlardan çıkış yap").
- **RBAC** yok (Owner / Admin / Member / Viewer).
- **SSO (SAML / OIDC) ve SCIM** yok — enterprise plan satarken zorunlu.
- **API key sistemi** yok: `sk_live_xxx`/`sk_test_xxx`, scope, rotate, revoke, son-kullanım tarihi, IP allowlist.
- **OAuth-as-server** yok: 3rd party uygulamalar Alloy'a auth olamaz.
- **Davet (invite teammate)** akışı yok.

### 2.3 Yapılacak

- Auth-as-a-service (Auth.js / Clerk / WorkOS) entegrasyonu — kendiniz yazmak SOC2 için ekstra yük.
- `tenants` (org), `users`, `memberships(tenant_id, user_id, role)` tabloları.
- `api_keys(tenant_id, hashed_key, prefix, scopes, last_used_at, expires_at, revoked_at)`.
- Gateway middleware: `Authorization: Bearer sk_live_...` veya session cookie → tenant context'i request'e koy.

---

## 3. Faturalandırma & Ölçüm — Sıfır

### 3.1 Mevcut

- `cost.db` SQLite tablosu — yalnızca raporlama (token + spend), müşteri faturalandırmasına bağlı değil.
- `quota.ts` ve `rate-limit-state.ts` — provider account kotası için, müşteri planı için değil.

### 3.2 Eksikler

- **Stripe (veya Iyzico/Paddle/Lemon Squeezy) entegrasyonu** yok.
- **Plan / Subscription / Invoice modelleri** yok.
- **Usage event akışı** yok: "tenant X, modeli Y için Z token kullandı, $W faturalandırılacak".
- **Plan-bazlı feature gating** yok (free → 1 user, pro → MCP, team → SSO, enterprise → SAML+SCIM+VPC).
- **Hard limits + grace + suspension** yok.
- **Stripe webhook receiver** yok (`invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`).
- **Trial / kupon / prorate / dunning** yok.
- **TR pazarı için e-fatura (GIB) entegrasyonu** yok (Iyzico veya Logo bağlantısı gerekli).
- **"Bring your own key" vs "Alloy provides keys"** iş modeli kararı verilmemiş; iki mod birden çalışıyor ama hangisinden ne kadar para alacağı belirsiz.

### 3.3 Yapılacak

- `subscriptions(tenant_id, stripe_subscription_id, plan, status, current_period_end)`.
- `usage_events(tenant_id, kind, quantity, unit, occurred_at, idempotency_key)` → cron işi Stripe `usage_records`'a forward eder.
- `entitlements(tenant_id, feature, value)` — feature flag + plan limit kombinasyonu.
- Gateway middleware: her endpoint'te `entitlements` kontrolü.
- Soft + hard limit + 7 günlük grace.

---

## 4. Operasyonel (Day-2) Eksiklikler

### 4.1 Gözlemlenebilirlik tenant-aware değil

**Tespit:** `docs/ARCHITECTURE.md §Observability` — `X-Request-ID` her log satırında, ama `tenant_id` yok.

**Yapılacak:** Tüm structured log emitter'larına `tenant_id` enrichment. SOC2 için audit log'u ayrı, append-only store'a (CloudWatch + S3 WORM bucket).

### 4.2 Auto-scaling ve target group eksik

**Tespit:**
- `docs/ARCHITECTURE.md`: "ECS service is fixed-count (`desired_count`)".
- `PLAN_06_INFRA.md §Görev 5`: bridge için target group `arn = ""`.
- `infra/terraform/envs/staging/` production ile senkronize değil.

**Yapılacak:**
- ECS service auto-scaling: CPU + custom metric (queue depth, request P99).
- Bridge için ALB target group + path-based routing veya internal NLB.
- Staging tam parite.

### 4.3 Backup / DR

**Tespit:** SQLite + lokal volume → resmi backup yok. ChromaDB/LanceDB de aynı.

**Yapılacak:** RDS automated snapshots (PITR ≥7 gün), S3 versioning, cross-region replica (kurumsal plan).

### 4.4 Multi-region yok

**Tespit:** `ARCHITECTURE.md`: "single region only".

**Etki:** AB müşterileri için data residency (GDPR Art. 44) sorunu. TR müşterileri için latency.

**Yapılacak:** En az iki bölge (eu-central-1 + us-east-1). Tenant'a region atanır; data o region'da kalır.

### 4.5 Per-tenant rate limit yok

**Tespit:** `core/gateway/src/plugin/core/rate-limit-state.ts` ve `plugin/quota.ts` — provider account başına. Müşteri başına değil.

**Yapılacak:** Redis token bucket per `(tenant_id, route_class)`. Plan'ın limit'ini `entitlements` tablosundan al.

### 4.6 Statuspage / SLA / SLO yok

**Yapılacak:** statuspage.io, SLI tanımları (gateway P95, bridge P95, cache hit rate), SLO + error budget.

---

## 5. Compliance & Güvenlik

### 5.1 GDPR / KVKK

- DPA (Data Processing Addendum) yok.
- Sub-processor listesi yok.
- "Veri sahibi hakları" akışı yok: erişim (Art. 15), düzeltme (Art. 16), silme (Art. 17), taşınabilirlik (Art. 20).
- Cookie consent, privacy policy, terms of service yok.

### 5.2 SOC2 / ISO27001

- Vendor management, change management, access review prosedürleri tanımlı değil.
- `docs/OPERATIONS.md` taslak; tenant-aware değil.
- Pen-test raporu yok.
- Threat model dokümanı yok.

### 5.3 PII / log redaction

**Tespit:** Yapısal log default `INFO`. Prompt'lar log'a düşüyor (özellikle bridge'de).

**Etki:** Bir müşterinin müşterisinin verisi log'a kaçabilir → veri ihlali.

**Yapılacak:**
- Log emit eden yerlerde redaction layer (e-posta, kart no, JWT, OpenAI key regex'leri).
- Log retention politikası: 90 gün.
- Test ortamında müşteri verisi yok prensibi.

### 5.4 Tenant izolasyon kanıtı

**Yapılacak:** Tenant-isolation test suite'i — bir tenant API key'i ile başka tenant'ın resource'una hiçbir endpoint'in cevap vermediğini kanıtlayan parametrize fuzz testleri.

---

## 6. Müşteri Yüzü (UX) Eksikleri

| Eksik | Notlar |
|-------|--------|
| Landing site + pricing | Bugün sadece in-app console (≥1280 px). |
| Onboarding wizard | Yeni kullanıcının ilk 90 saniyesi tanımsız. |
| Hesap ayarları sayfası | Profile, password, MFA, sessions, billing. |
| Davet (teammate) akışı | E-posta + magic link + role atama. |
| Self-service plan değişimi | Stripe Customer Portal embed. |
| In-app destek | Help Scout, Intercom veya custom ticket. |
| E-posta altyapısı | Resend/Postmark/SES — verification, fatura, alert. |
| i18n | `PLAN_03_CONSOLE.md` Faz 3'e bırakmış; TR pazarı varsa Faz 1. |
| Mobile-friendly read-only | Plan açıkça "desktop only". Dashboard görüntülenememesi sıkıntı. |
| Statuspage | status.alloy.app gibi. |

---

## 7. Plan-vs-Gerçeklik Tutarsızlıkları

- `PLAN_05_USER_LAYER.md` — "%0 → %100" başlığı ile **henüz başlanmamış** olduğunu söylüyor. SaaS'ın asıl katmanı bu.
- `PLAN_06_INFRA.md` — %70'te. Provider key'leri Secrets Manager'da değil; bridge `/ready` tam değil; staging eksik.
- `PLATFORM_PLAN.md` — Phase 1-2 SaaS değil, açıkça yazılı.
- `core/bridge/error_trace*.txt`, `chaos_error.txt`, `gateway_*.log`, `rust_benchmark.txt` — repo'da geçici dosyalar var. CI/CD temizliği yok.
- `interface/console/build_log.txt`, `ts_errors.txt`, `test-results/` — aynı sorun.

---

## 8. Kod Tabanı Hata Listesi (AUDIT.md'den onaylı)

### 8.1 Kritik (build kırık)

1. `core/gateway/src/orchestration/shared-memory.ts` — 8 method eksik (`clean`, `appendLog`, `readLogTail`, `updateState`, `getState`, `readAgentOutput`, `getRelevantContext`, `getTimeline`).
2. `core/gateway/src/orchestration/autonomy-scope-engine.ts:19` — `IToolExecutionEngine.runCommand()` implement edilmemiş.
3. `core/gateway/src/plugin/core/fetch-interceptor.ts:212-1009` — ~50 tanımsız referans, zod import yok.

### 8.2 Yüksek (runtime risk)

4. `auth.router.ts:45` race condition.
5. `csrf.ts:34` Map sınırsız büyüyor.
6. `chat.router.ts:79` non-null assertion bombası.
7. `chat.router.ts:194` JSON cast doğrulanmamış.
8. `mission.router.ts:145` array bounds check yok.
9. `mission.model.ts:169` exhaustive default eksik.
10. `pipeline-tools.ts:152` implicit any.
11. `mission.router.ts:113` silent default → hata gizleme.
12. `privacy.router.ts:33` setInterval sızıntısı.

Detaylar için `docs/AUDIT.md`.

---

## 9. Önerilen Yol Haritası

### Sprint 0 — Temizlik (1-2 hafta)

- AUDIT.md'deki 3 kritik + 9 yüksek hata.
- Repo'yu `error_trace*.txt`, `*.log`, `test-results/` artıklarından temizle, `.gitignore`'a ekle.
- CI'da `tsc --noEmit && eslint && pytest` yeşil olsun.

### Sprint 1-2 — Multi-tenant Temel

- Postgres göçü (Aurora). Migration: `001_tenants.sql`, `002_users.sql`, tüm tablolara `tenant_id`.
- Redis (ElastiCache) → exact cache + MAB state.
- ChromaDB → tenant-scoped collection.
- Repository katmanında enforced tenant scoping (mock leak testleri).

### Sprint 3-4 — Kimlik

- WorkOS / Clerk / Auth.js entegrasyonu.
- `users`, `organizations`, `memberships`, `invitations`, `audit_log`, `api_keys`.
- RBAC middleware (Owner/Admin/Member/Viewer).
- Magic link signup, MFA, parola sıfırlama.

### Sprint 5-6 — Faturalandırma

- Stripe Billing + Customer Portal.
- `plans`, `subscriptions`, `usage_events`, `invoices`, `entitlements` tabloları.
- Stripe webhook receiver.
- Plan-bazlı feature gating (free/pro/team/enterprise).
- Hard + soft limit, grace, suspension.

### Sprint 7 — Operasyon

- Per-tenant rate limit (Redis token bucket).
- Tenant-aware structured logging + redaction.
- Audit log → S3 WORM.
- RDS automated backup + PITR.
- ECS auto-scaling policy.
- Statuspage + SLO dashboard.

### Sprint 8 — Compliance + GTM

- DPA, privacy policy, ToS, sub-processor list.
- "Delete my data" akışı + export endpoint.
- Landing + pricing sayfası (Next.js).
- Onboarding wizard (3 adım: org adı, faturalandırma, ilk provider).
- Resend/Postmark e-posta şablonları (verification, invite, invoice, alert).
- i18n (TR + EN).

### Sprint 9 — Enterprise (opsiyonel)

- SAML SSO + SCIM (WorkOS).
- VPC peering / private link.
- Ek bölge (eu-central-1).
- Custom contract + DPA.
- SOC2 Type 1 hazırlığı.

---

## 10. İş Modeli Kararları (Henüz Verilmedi)

1. **Pricing modeli:** seat-based mi, token-usage mi, hybrid mi?
2. **BYOK (Bring Your Own Key) vs Alloy keys:** her ikisi mi, hangisi default mı, Alloy keys'te markup ne olacak?
3. **Free plan var mı?** Varsa abuse koruması (e-posta verify + rate limit + IP heuristic) gerekiyor.
4. **Hedef segment:** indie geliştirici mi, takım (5-50 kişi) mi, enterprise mi? Üçü farklı UX, farklı pricing, farklı GTM gerektirir.
5. **Self-host opsiyonu kalacak mı?** "Open core" modeli için açık kaynak gateway + kapalı kaynak SaaS katmanı (billing, SSO) ayrımı kararlaştırılmalı.

Bu kararlar verilmeden Sprint 5'e (faturalandırma) başlanamaz.

---

## Kapanış

Bugünkü Alloy iyi bir teknik temel: gateway + bridge + console + extension + terraform tek monorepo'da yaşıyor, optimization pipeline ciddi bir IP. Ama SaaS'a giden yol "biraz daha kod" değil — yukarıdaki altı dikey katmanın hepsinin eklenmesi gerekiyor. En riskli iki nokta: (a) SQLite/lokal-dosya temelli persistence'ı Postgres+Redis+S3'e taşımak, (b) tüm domain modelinin retroactively `tenant_id` kazanması.
