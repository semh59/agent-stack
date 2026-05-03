# Alloy — Prod-Hazır Lansman Planı

> **Tarih:** 28 Nisan 2026
> **Hedef:** Alloy'u **production-ready** SaaS yapmak ve **Cline, Kilo Code, Continue.dev, Cursor** karşısında ölçülebilir biçimde daha iyi konumlamak.
> **Süre:** 18-22 hafta (T-shirt: ~5 ay full-time, 4 mühendis + 1 designer + 0.5 PM).
> **İlişkili dokümanlar:** `SAAS_READINESS.md` (eksiklerin tam dökümü), `AUDIT.md` (kod hataları), `PLATFORM_PLAN.md` (mevcut yön).

---

## 0. "Prod-Ready" Tanımı (Kabul Kriterleri)

Aşağıdaki **24 madde**nin tamamı yeşil olduğu gün lanse edilir. Hiçbiri "phase 2" değil — hepsi launch'tan önce.

### 0.1 Reliability
- [ ] **SLO:** Gateway p95 < 250 ms (cache hit hariç çağrıların kendi süresi), bridge p95 < 1.5 s, uptime ≥ 99.9% son 30 gün.
- [ ] **Error budget** tanımlı, alarmlar PagerDuty'ye gidiyor.
- [ ] **Graceful degradation:** bridge ölü → gateway "raw passthrough" moduna düşüyor, kullanıcı 500 görmüyor.
- [ ] **DR drill** tamamlandı: RDS PITR'den restore + S3 cross-region replica testi geçti.

### 0.2 Quality
- [ ] **CI yeşil:** `tsc --noEmit && eslint && pytest && playwright` — `main`'e push'ta.
- [ ] **Coverage** unit ≥ 70%, integration ≥ 50%, E2E kritik 12 flow.
- [ ] **Eval suite:** 200+ prompt fixture, gold-output diff, regression alarmı.
- [ ] **Load test:** 500 RPS gateway, 100 concurrent bridge, 10 dakika sürdürülebilir.

### 0.3 Security
- [ ] **Pen-test** (3rd party) raporu — kritik+yüksek bulgular kapalı.
- [ ] **SSRF / SQLi / XSS** otomatik tarama yeşil (Snyk veya ZAP).
- [ ] **Dependency audit:** `npm audit --audit-level=high` ve `pip-audit` temiz.
- [ ] **Secret rotation:** otomatik 90 günde bir, sıfır downtime.
- [ ] **Tenant izolasyon testi:** parametrize fuzz suite, başka tenant'ın resource'una erişim sıfır.

### 0.4 Compliance & legal
- [ ] **Privacy Policy / ToS / DPA** hukuki onaylı, sitede yayında.
- [ ] **Sub-processor** listesi public.
- [ ] **GDPR/KVKK self-service:** export + delete endpoint'leri çalışıyor, e-posta tetikli.
- [ ] **Cookie consent** banner (TR + EU için).

### 0.5 Observability & Ops
- [ ] **Tenant-aware structured log** + OTEL trace + Prometheus metric — hepsi prod'da.
- [ ] **Statuspage** (status.alloy.ai) public, otomatik update.
- [ ] **Runbook** her alarm için var (`docs/runbooks/`).
- [ ] **On-call rotation** PagerDuty'de tanımlı, 2 kişi.

### 0.6 Customer experience
- [ ] **Marketing site** (landing + pricing + docs + blog) yayında.
- [ ] **Onboarding wizard** — sıfırdan ilk başarılı çağrı medyan ≤ 90 saniye.
- [ ] **Self-service billing** (Stripe Customer Portal) çalışıyor.
- [ ] **Support kanalı** (e-posta + in-app chat) — SLA: ilk yanıt < 4 saat.

---

## 1. Mevcut Durum vs Hedef (Açık Boşluk)

| Kategori | Bugün | Hedef | Boşluk |
|----------|-------|-------|--------|
| Build | TS derleme kırık (3 kritik hata) | CI yeşil | 1 hafta |
| Persistence | SQLite + lokal dosya | Postgres + Redis + S3 | 4 hafta |
| Multi-tenancy | Yok | Tüm tablolarda `tenant_id` + izolasyon testi | 3 hafta |
| Auth | Provider OAuth (yanlış katman) | Kullanıcı/org/RBAC/API-key/SSO | 4 hafta |
| Billing | Yok | Stripe + plan + usage metering | 3 hafta |
| Observability | Tek-tenant log + opsiyonel metrics | Tenant-aware + OTEL + Prometheus + alarms | 2 hafta |
| Compliance | Yok | DPA + privacy + GDPR akışı | 2 hafta |
| Marketing | Yok | Landing + pricing + docs + blog | 2 hafta |
| Müşteri yüzü | Yok | Onboarding + account + billing UI | 3 hafta |
| Eval/QA | Manuel smoke | 200+ prompt eval suite + load test | 2 hafta |
| **Toplam** | | | **~22-26 hafta**, paralel çalışmayla **18-22 hafta** |

---

## 2. Rakip Analizi — Nasıl Daha İyi Olunur

### 2.1 Cline (VS Code agent)

**Onların güçlü yanı:** Approval UX, checkpoint sistemi, model-provider breadth, açık kaynak topluluğu.

**Zayıf noktaları:**
- Cost telemetry "after-the-fact" — kullanıcı pahalıya çağrı yaptıktan sonra görüyor.
- Optimization yok; her prompt full-token.
- Multi-user / team yok; tamamen lokal.
- Eval / quality regression suite yok.
- Telemetri opt-out, ama gerçek dashboard yok.

**Alloy'un farkı (gerçekleştirilebilir):**
- **Pre-flight cost preview:** kullanıcı "send"e basmadan önce tahmini token + $ + cache-hit olasılığı görüyor.
- **MAB-driven layer selection:** her prompt için pipeline otomatik en uygun kompresyonu seçiyor; kullanıcı dokunmuyor.
- **Live optimization metrics:** "%42 token saved this week, $312 saved" dashboard — Cline'da yok.
- **Hard budget:** günlük/aylık dolar sınırı; hit edince akış durur, override tek tıkla.

### 2.2 Kilo Code

**Onların güçlü yanı:** Per-mode prompts, rich rules files (`.kilorules`), aktif dev.

**Zayıf noktaları:**
- Kuralları dosyada tutmak versioning + paylaşım derdine sokuyor.
- Telemetri yok.
- Multi-tenant ekosistemi yok.
- Eval yok.

**Alloy'un farkı:**
- **`.alloyrules` (workspace) + UI editor (user-global) + team-shared rules** üç katmanlı.
- **Rules eval:** her kural değişikliği 200 fixture'da çalıştırılıp diff gösterilir.
- **Rules marketplace** (uzun vadeli) — topluluk paylaşımlı kural setleri.

### 2.3 Continue.dev

**Onların güçlü yanı:** Config-as-code (`config.json`), per-role model routing, OSS.

**Zayıf noktaları:**
- YAML/JSON gymnastics — onboarding 30+ dakika.
- UI'sız ayar = non-developer için kullanılamaz.
- Tüm ayarlar lokal, takım paylaşımı zor.
- Cost optimization yok.

**Alloy'un farkı:**
- **Her ayarın UI'ı var** (`PLATFORM_PLAN.md §4`), `.env` debug backdoor.
- **Settings export/import** + team-level senkronizasyon.
- **Provider testleri tek tıkla** (`POST /api/settings/providers/:id/test`).
- **Onboarding wizard:** sıfırdan ilk çağrıya ≤ 90 sn.

### 2.4 Cursor

**Onların güçlü yanı:** Fast, editor-native, polished UX, büyük marketing.

**Zayıf noktaları:**
- SaaS lock-in (kendi modelleri, kendi infra'sı).
- BYOK var ama kısıtlı.
- Multi-provider routing kısıtlı (Anthropic + OpenAI + Cursor-tier).
- Open stack değil → kurumsal müşteriler için VPC self-host yok.
- Optimization layer'ı kapalı kutu.

**Alloy'un farkı:**
- **Open-core:** gateway + bridge MIT, SaaS katmanı kapalı; kurumsal müşteri kendi VPC'sinde çalıştırabilir.
- **Multi-provider gerçekten:** Ollama, OpenAI, Anthropic, Google (Antigravity OAuth), OpenRouter, Azure, LM Studio, Groq, Cerebras, SambaNova, Mistral, DeepSeek, Together, Fireworks (`PLAN_06_INFRA.md`).
- **Şeffaf optimization:** her layer'ın ne yaptığı, ne kazandırdığı UI'da görünür.
- **VS Code + Web + CLI** üçü tek hesap.

### 2.5 Alloy'un kazanma denklemi (özet)

> **Alloy = Cursor'un cilası + Cline'ın açıklığı + Continue'nun esnekliği + benzersiz prompt-optimization katmanı + gerçek SaaS operasyonu.**

Üç ölçülebilir vaad:
1. **%40-60 token tasarrufu** rakip baseline'a karşı (eval suite kanıtlı, public benchmark).
2. **≤ 90 saniye onboarding** (sıfırdan ilk başarılı chat).
3. **Multi-provider gerçek BYOK** — 14+ provider, tek arayüz, sıfır YAML.

---

## 3. 6-Sprint Yol Haritası (T-22 hafta → T-0 launch)

> Sprint = 2 hafta. Tarihler launch-date'e göre geriye sayım.

### Sprint A (T-22 → T-20): Stabilizasyon

**Hedef:** Build yeşile dön, repo temizliği, eval altyapısı kur.

- AUDIT.md kritik 3 + yüksek 9 hatayı kapat.
- Repo temizliği: `error_trace*.txt`, `*.log`, `test-results/`, `dist/` artıklarını sil; `.gitignore` sıkıştır.
- CI pipeline: `tsc --noEmit && eslint && pytest && playwright`. Branch protection: yeşil gerekli.
- Eval framework: `tools/eval/` — 50 başlangıç prompt fixture, gold-output diff, JSON çıktı.
- **Çıktı:** her PR yeşil CI ile mergelenir; eval suite skoru release notlarında.

### Sprint B (T-20 → T-18): Persistence Göçü

**Hedef:** SQLite/lokal-dosya → Postgres + Redis + S3.

- `infra/terraform/modules/rds/` — Aurora Postgres, multi-AZ.
- `infra/terraform/modules/elasticache/` — Redis.
- `infra/terraform/modules/s3/` — `alloy-rag-{env}` ve `alloy-audit-{env}` (WORM).
- `core/gateway/src/persistence/` — SQLite repository'leri Postgres'e taşı (Prisma veya Kysely).
- `core/bridge/` — `cache.db`, `mab.db`, `cost.db` Postgres'e; ChromaDB → managed Qdrant veya pgvector.
- **Migration tool** + downtime-free dual-write window.
- **Çıktı:** prod'daki tek state lokal disk'te değil.

### Sprint C (T-18 → T-14): Multi-Tenancy + Kimlik

**Hedef:** Multi-tenant veri modeli + son-müşteri kimliği.

- DB migration: `001_tenants_users.sql` — `tenants`, `users`, `memberships`, `invitations`, `audit_log`, `api_keys`, `sessions`.
- Tüm domain tablolarına `tenant_id UUID NOT NULL` ekle + composite index.
- Repository layer: enforced tenant scoping (her query `WHERE tenant_id = :tenant`).
- Auth: WorkOS veya Clerk entegrasyonu — magic link + Google + GitHub OAuth + MFA.
- RBAC middleware: Owner/Admin/Member/Viewer.
- API key sistemi: `sk_live_...` / `sk_test_...`, scope, rotate, revoke.
- **Tenant izolasyon test suite:** parametrize fuzz, başka tenant resource'una erişim 0/N olmalı.
- **Çıktı:** iki ayrı org tek kurulumda yan yana çalışıyor, hiçbir şekilde birbirini görmüyor.

### Sprint D (T-14 → T-10): Faturalandırma + Plans + Onboarding

**Hedef:** Stripe entegrasyonu, plan-bazlı gating, onboarding wizard.

- Stripe Billing + Customer Portal entegrasyonu.
- Tablolar: `plans`, `subscriptions`, `usage_events`, `invoices`, `entitlements`.
- Plan tanımları:
  - **Free:** 1 user, 10K request/ay, BYOK, sadece OSS providers (Ollama, OpenRouter, Groq, Cerebras).
  - **Pro $29/seat/ay:** unlimited request, all providers, MCP, RAG.
  - **Team $59/seat/ay:** SSO (Google), shared rules, audit log.
  - **Enterprise (kontrat):** SAML+SCIM, VPC peering, custom DPA, dedicated support.
- Stripe webhook receiver: `invoice.paid`, `subscription.updated`, `subscription.deleted`.
- Hard limit + soft limit + 7 günlük grace + suspension.
- **Onboarding wizard** — 3 adım: org adı, ilk provider (BYOK veya "use Alloy keys, $5 free credit"), ilk chat.
- **Çıktı:** kullanıcı kart bilgisi olmadan signup → 90 sn'de ilk başarılı çağrı; pro'ya upgrade tek tıkla.

### Sprint E (T-10 → T-6): Operasyon, Compliance, Eval

**Hedef:** Prod operasyon altyapısı + compliance + eval/QA.

- **Per-tenant rate limit** (Redis token bucket).
- **OTEL tracing** gateway + bridge + LLM calls.
- **Prometheus** + Grafana dashboard (per-tenant kesim).
- **PagerDuty** alarmları: SLO breach, error rate spike, queue depth.
- **Statuspage** + automated incident updates.
- **Per-tenant log redaction** (e-posta, kart, JWT, OpenAI key regex).
- **Audit log** → S3 WORM bucket + tamper-evident hash chain.
- **GDPR self-service:** `/api/account/export`, `/api/account/delete` — async job, e-posta tetikli.
- **Privacy policy, ToS, DPA** hukuki review + onay.
- **Sub-processor** listesi (`status.alloy.ai/sub-processors`).
- **Eval suite genişletme:** 200+ prompt, 5 kategori (code, debug, refactor, doc, agent), nightly run.
- **Load test:** k6 — 500 RPS, 10 dk sustained.
- **Pen-test** (Cure53 / NCC veya yerel).
- **Çıktı:** SOC2 Type 1 hazırlığı %80+; ölçülebilir SLO.

### Sprint F (T-6 → T-2): Müşteri Yüzü + Differentiator'lar

**Hedef:** Marketing, public eval benchmark, lansman differentiator'ları.

- **Marketing site** (Next.js + Tailwind): landing, pricing, docs, blog, changelog.
- **Public benchmark page** (`alloy.ai/benchmark`): MAB optimizer'ın token tasarrufunu Cursor/Cline/Continue baseline'larına karşı **canlı** gösterir, 200 prompt suite, otomatik nightly update.
- **Pre-flight cost preview** UI (composer'da, send'den önce).
- **Live cost dashboard** (savings widget): "this week saved 42% / $312" homepage'de.
- **Rules editor** (Monaco) + per-team shared rules.
- **VS Code extension webview parity** — tüm console feature'ları extension'da da var.
- **CLI** (`npx alloy`) — chat, run mission, set provider key.
- **Status page** + uptime widget.
- **Çıktı:** kullanıcı 30 saniyede landing'den value-prop'u kavrar, 90 sn'de signup-to-first-chat.

### Sprint G (T-2 → T-0): Soft Launch + Hardening

**Hedef:** Closed beta → public launch.

- 50 closed-beta tenant — geri bildirim toplama + critical bug fix.
- 7-gün izleme: SLO, error rate, support volume.
- Pricing son ayar (anchor, decoy, contrast).
- Lansman içeriği: blog post (founder), Twitter/X thread, HackerNews launch, Product Hunt.
- **Launch criteria gate:** §0'daki 24 madde yeşil.

---

## 4. Differentiator Detayları (Lansmanda Lazım)

### 4.1 Pre-flight Cost Preview

**Yer:** Composer'da, send butonunun yanında.
**UX:** "≈ 1,840 input + 2,200 output tokens · ≈ $0.018 · 73% cache hit probability".
**Teknik:** `POST /api/preflight` endpoint — bridge'e gitmez, token count + provider price + cache lookup hash.
**Etki:** Cursor/Cline'da yok; "fiyatı send'den önce gör" değer önermesi.

### 4.2 Live Optimizer Dashboard

**Yer:** Telemetry page + landing widget.
**Metrikler:**
- Token saved (raw vs sent) — bu hafta / bu ay.
- $ saved (provider price ile).
- Cache hit ratio (L1 + L2).
- MAB arm performance (hangi layer ne kadar kazandırdı).
- Per-provider latency p50/p95/p99.

### 4.3 Public Benchmark

**Yer:** `alloy.ai/benchmark`.
**İçerik:** 200 prompt × 4 baseline (Alloy on / off, Cursor, Continue, Cline) × token + latency + quality (LLM-as-judge).
**Cadence:** Nightly auto-run, son 7 gün public dashboard.
**Etki:** "Daha iyi" iddiasını **kanıtlanmış** hâle getirir.

### 4.4 Hard Budget

**Yer:** Settings → Budgets.
**UX:** "$50/day, $1000/month — hit edince akış durur, override tek tıkla."
**Teknik:** Cost log → real-time aggregator → quota enforcer middleware.
**Etki:** "Cursor'da fatura sürpriz" Twitter şikayetlerinin direkt cevabı.

### 4.5 Multi-Provider Tek Hesap

**Yer:** Settings → Providers.
**14 provider** (`PLAN_06_INFRA.md`). Her birinde test connection butonu.
**BYOK + "Alloy provides keys"** ikisi birden:
- BYOK ücretsiz; sadece Alloy seat fee.
- Alloy keys → $5 credit, sonra %10 markup, hard limit korunur.

### 4.6 Open-Core (Trust Mührü)

- `core/gateway`, `core/bridge` MIT.
- SaaS katmanı (auth, billing, multi-tenant, console-cloud) kapalı.
- Kurumsal müşteri "kendi VPC'mde Alloy çalıştır + cloud SSO entegrasyonu" alabilir.
- GitHub stars + community contributors lansman ivmesi.

### 4.7 Eval-Driven Geliştirme

- Her PR'da eval suite çalışır; quality regression > %2 ise PR block.
- Public eval changelog: "v1.4.7 — code completion quality +3.2%".
- Müşterilere kendi eval suite'lerini (`.alloyeval/`) çalıştırma altyapısı.

---

## 5. Quality Gates ve Launch Kriterleri

### 5.1 Tüm sprintler için "definition of done"

- Unit test ≥ 70% coverage (yeni kod), ≥ 50% (touched code).
- Integration test her API endpoint için en az happy + error path.
- E2E (Playwright) kritik 12 flow için.
- Tenant izolasyon testi her yeni tabloya parametrize ekleme.
- Eval skoru ≤ %2 regression → otomatik revert.
- Security scan (Snyk, ZAP) yeşil.
- Accessibility audit (axe-core) WCAG 2.1 AA — Settings + Chat + Onboarding sayfalarında.

### 5.2 Launch gate (T-0)

| Kategori | Eşik | Ölçüm |
|----------|------|-------|
| Gateway p95 latency | < 250 ms | k6 load test, son 7 gün prod |
| Bridge p95 latency | < 1.5 s | aynı |
| Uptime | ≥ 99.9% | son 30 gün staging |
| Error rate | < 0.5% | aynı |
| Onboarding time | medyan ≤ 90 s | beta ölçümü |
| Eval quality | baseline ≥ Cursor | public benchmark |
| Security | pen-test critical = 0 | rapor |
| Compliance | DPA + privacy + sub-processor | hukuki onay |

---

## 6. Risk Kayıt Defteri

| Risk | İhtimal | Etki | Mitigation |
|------|---------|------|-----------|
| Postgres göçü prod data kaybı | Düşük | Yüksek | Staging'de full rehearsal + dual-write window + rollback playbook. |
| Stripe entegrasyon edge cases | Orta | Orta | Stripe test mode'da 30+ senaryo, webhook idempotency. |
| Tenant izolasyon zafiyeti | Düşük | Çok yüksek | Fuzz suite + 3rd party pen-test + bug bounty (HackerOne) launch'tan 2 hafta önce. |
| Provider API breakage (OpenAI / Anthropic) | Orta | Orta | Circuit breaker + fallback chain + provider-test cron. |
| Eval suite quality drift (LLM judge bias) | Orta | Orta | Multiple judges (GPT-4o + Claude + manual sample) + rotating fixture set. |
| Cursor/GitHub Copilot pricing war | Yüksek | Orta | Open-core hattı + BYOK = price-sensitive segment'i koru. |
| TR regulation (KVKK, BTK) sürprizleri | Orta | Düşük | Hukuki review + EU bölgesi + tenant residency seçimi. |
| Lansman PR/HN dalgası → kapasite | Yüksek | Orta | Auto-scale max 20× baseline; queue + soft-throttle hazır. |

---

## 7. Takım & Bütçe (Yumuşak Tahmin)

**Takım:** 4 mühendis (2 backend, 1 frontend, 1 DevOps/SRE) + 1 designer (yarı zamanlı) + 0.5 PM = 5.5 FTE.

**22 hafta → 22 * 5.5 = 121 kişi-hafta.**

**Bütçe ana kalemler (sabit):**
- AWS (RDS Aurora multi-AZ + ECS + ElastiCache + S3 + ALB + WAF) → ~$2-3K/ay staging+prod.
- WorkOS / Clerk → $99-499/ay başlangıç.
- Stripe → ücretsiz, %2.9+30¢ per txn.
- Sentry / Datadog → $200-500/ay.
- Resend / Postmark → $20-50/ay.
- Pen-test → $8-20K tek seferlik.
- Hukuki (DPA, ToS, privacy) → $3-8K.
- Domain + branding + landing → $2-5K.

**Toplam tahmini operasyonel başlangıç:** $30-60K + 5.5 FTE × 5 ay maaş.

---

## 8. İş Modeli Karar Notları (Lansmandan Önce Verilmeli)

1. **Pricing modeli:** seat + usage hibrit (önerilen). Sadece-seat → BYOK kullanıcısı zarar; sadece-usage → enterprise predictable bütçe vermez.
2. **Free plan abuse koruması:** e-posta verify + telefon verify (TR için) + IP heuristic + Stripe Radar (kart kayıt isteyen free trial).
3. **Hedef segment sırası:** indie dev (T+0) → küçük takım (T+3 ay) → enterprise (T+9 ay).
4. **Self-host opsiyonu:** evet — `core/` MIT, sadece SaaS katmanı kapalı. Trust + community ivmesi için kritik.
5. **TR pazar konumu:** EN-first lansman, TR yerelleştirme T+1 ay (i18n hazır, sadece çeviri).

---

## 9. İlk 90 Gün (Lansman Sonrası)

| Hafta | Hedef | Ölçüm |
|-------|-------|-------|
| 1-2 | Hot-fix dalgası, support volume çözümü | tickets/day < 10 |
| 3-4 | İlk paid customer cohort retention | week-1 retention ≥ 60% |
| 5-8 | Top 5 user request feature ship | NPS ≥ 40 |
| 9-12 | İlk public benchmark refresh + blog | HN/PH front-page hit |

---

## 10. Hemen Başlayacak 5 İş (Pazartesi Sabahı)

1. **AUDIT.md kritik 3 hatayı kapat** (`SharedMemory` 8 method + `ScopedToolExecutionEngine.runCommand` + `fetch-interceptor.ts` undefined refs). Build yeşil → her şey daha kolay.
2. **CI pipeline**'ı sıkılaştır: `tsc --noEmit && eslint && pytest && playwright` zorunlu, branch protection açık.
3. **Eval framework iskeleti** kur: `tools/eval/` + 50 başlangıç fixture + gold output + JSON çıktı + nightly action.
4. **Postgres + Redis + S3** terraform modülleri — staging'de canlı.
5. **`SAAS_READINESS.md` ve bu doküman** üzerinde stakeholder review (CTO + tek bir kurucu + 1 senior eng) — scope'u dondur.

---

**Özet:** "Production-ready ve rakipten daha iyi" demek, eksik altı dikey katmanı doldurmak (`SAAS_READINESS.md`) **artı** ölçülebilir üç differentiator'u (token tasarrufu kanıtı, ≤90 sn onboarding, gerçek 14-provider BYOK) vitrine taşımak. Toplam 18-22 hafta, 5.5 FTE. Bu doküman scope'u dondurursa T-0 öngörülebilir.
