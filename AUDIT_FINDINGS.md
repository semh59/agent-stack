# Sovereign — Derin Denetim Raporu

Tarih: 2026-04-20 · Kapsam: `agent-stack/` monorepo (AGENT + ai-stack-mcp)
Yöntem: dosya taraması, grep, typecheck, repo higyeni kontrolü.
Kural: her bulgu → dosya + satır. Yorum yok, eylem var.

---

## 0. Özet (TL;DR)

| Sınıf | Sayı | Durum |
|---|---|---|
| P0 — Güvenlik (commit'lenmiş sır / exec) | 7 | AÇIK |
| P0 — Repo çöpü (>100 MB artefakt) | 6 küme | AÇIK |
| P1 — Marka tutarsızlığı | 4 nokta | YARIDA |
| P1 — Bağımlılık hataları | 3 | AÇIK |
| P2 — Kritik bug (BUG_REPORT.md) | 6 | 40+ gündür AÇIK |
| P2 — Kod kalitesi (log/any/catch) | 400+ | AÇIK |
| P3 — Mimari — orchestrator stub | 1 | AÇIK |
| P4 — Test açığı | 4 dosya | AÇIK |

---

## 1. P0 — GÜVENLİK (commit'lenmiş sırlar, arbitrary exec)

| # | Bulgu | Yol |
|---|---|---|
| S1 | Düz metin OpenAI `sk-` ve AWS `AKIA` anahtarı | `AGENT/temp_secret.txt` |
| S2 | Canlı gateway token: `lojinext_<REDACTED-32CHARS>` | `AGENT/.tmp/gateway_token.txt` |
| S3 | Base64 encoded `eval`-style exec script | `AGENT/temp_encoded_exec.ts` |
| S4 | `console.log(process.env.<ENV_KEY>)` — test log'unda sır sızdırır | `AGENT/.tmp_deep_test_secrets/env.ts` |
| S5 | Aynı kalıp production test'inde | `AGENT/src/orchestration/phase2-deep.test.ts:72` |
| S6 | Dummy OAuth token store commit'lenmiş | `AGENT/test-workspace-forensic/token-store.json` |
| S7 | `security:scan` INCLUDE_DIRS `temp_*`, `.tmp*`, `test-workspace-*` kapsamıyor → bu sırlar tarayıcıdan kaçar | `AGENT/scripts/security-scan.*` |

**Aksiyon:** tüm S1–S6 dosyalarını `git rm`, `.gitignore`'a `temp_*`, `.tmp_*`, `test-workspace-*`, `*.vsix` ekle, sonra etkilenen API anahtarlarını **rotate et** (push geçmişte kalmış varsay).

---

## 2. P0 — REPO ÇÖPÜ (büyük / alakasız artefakt)

| # | Yol | Boyut / Sayı | Not |
|---|---|---|---|
| R1 | `AGENT/d:/PROJECT/` | — | Windows mutlak yol `d:\PROJECT` git artefaktı olarak commit'lenmiş |
| R2 | `AGENT/test-missions-forensic.db.corrupt.*` | 14 dosya × 124 KB | Test rotasyonundan artakalan bozuk SQLite'ler |
| R3 | `AGENT/.tmp_stress_test*/` (4 dizin) | ~92 MB | Stress test çıktıları |
| R4 | `AGENT/vscode-extension/loji-next-ai-0.1.0.vsix`, `0.1.1.vsix` | ikili | Paketleme çıktıları repo'da |
| R5 | `AGENT/.ai-company/` | 8.0 MB | İçerik belirsiz, `README` yok |
| R6 | `AGENT/sovereign-benchmark-api/`, `AGENT/ultimate-integrity-benchmark/` | 68 KB | Ayrı olması gereken benchmark repoları |
| R7 | `AGENT/rollup-rollup-linux-x64-gnu-4.59.0.tgz` | — | npm tarball commit'lenmiş |

**Aksiyon:** hepsi `git rm -r`; `.gitignore`'a ekle (`*.db.corrupt.*`, `*.vsix`, `*.tgz`, `d:/`, `.ai-company/`).

---

## 3. P0 — .gitignore tutarsızlığı

| # | Bulgu |
|---|---|
| G1 | Root `.gitignore` ve `AGENT/.gitignore` paralel yaşıyor, farklı setler tutuyorlar. |
| G2 | Ne biri `.tmp_*` tutuyor, ne de `temp_*`, ne de `*.vsix`, ne `*.corrupt.*`. Yeni artefaktları engelleyen tek bir kapı yok. |

**Aksiyon:** tek `.gitignore` (repo kök), `AGENT/.gitignore` kaldır. Bu raporun P0–P1 desenlerini ekle.

---

## 4. P1 — MARKA (Sovereign ↔ lojinext ↔ loji-next-ai)

| # | Yer | Eski |
|---|---|---|
| B1 | `AGENT/package.json` `name` | `lojinext-ai` |
| B2 | `AGENT/vscode-extension/package.json` | `loji-next-ai` |
| B3 | Gateway açılış banner'ı (`AGENT/src/index.ts`) | "LojinextNext AI" |
| B4 | CSS token seti | `--color-loji-*` (UI_ARCHITECTURE.md'de `--color-sov-*`'a geçiş planı yazılı ama yapılmadı) |

**Aksiyon:** tek PR'da rebrand + VS Code extension `publisher`/`icon`/`displayName` yenile. Token sweep 1 CSS dosyası + grep-replace.

---

## 5. P1 — BAĞIMLILIKLAR

| # | Bulgu | Yol |
|---|---|---|
| D1 | `@types/better-sqlite3` `dependencies`'te — prod bundle'a tür paketi sızıyor | `AGENT/package.json` |
| D2 | `ai-stack-mcp/requirements.txt` — 12 paket `>=` ile pinsiz (reproducible build yok) | `ai-stack-mcp/requirements.txt` |
| D3 | `zod-to-json-schema@3` × Zod v4 generic uyuşmazlığı — `routes.ts`'te `as unknown as any` cast'i borç olarak duruyor | `AGENT/src/services/settings/routes.ts:163` |

**Aksiyon:** D1 → `devDependencies`'e taşı. D2 → `pip-compile` ile `requirements.lock`. D3 → `zod-to-json-schema@4` yayımlanınca cast'i kaldır; test olarak snapshot ekle.

---

## 6. P2 — BUG_REPORT.md'de 40+ gündür AÇIK 6 kritik

Hiçbiri düzeltilmemiş, hepsinin tekrarı kolay.

| # | Tema | Konum (rapor iddiası) |
|---|---|---|
| C1 | Floating-point token sayacı → para hesabı yanlış |
| C2 | Negatif health değeri kabul ediliyor |
| C3 | Array index OOB (bounds check yok) |
| C4 | Queue `shift()` paterni → O(n) worst-case |
| C5 | Recursive JSON parse → sonsuz döngüye girebiliyor |
| C6 | File lock race (fs.open + write non-atomic) |

**Aksiyon:** her biri için regression test + fix. `BUG_REPORT.md` canlı kalıyorsa fix PR'ları onu da günceler.

---

## 7. P2 — KOD KALİTESİ

| # | Bulgu | Sayı / Yer |
|---|---|---|
| Q1 | `console.log` production `src/` içinde | 193 nokta (gateway tarafı); loglama bridge üzerinden pino/winston'a akmalı |
| Q2 | `: any` kullanımı | 188 nokta; 20–30 tanesi `services/settings/*` dışında, tip güvenliği boşalmış |
| Q3 | Boş `catch {}` bloğu — hata yutma | `AGENT/src/orchestration/GateEngine.ts:291` |
| Q4 | `while (true)` döngüleri (bounded olmayan) | `AGENT/src/vscode-extension/plugin.ts` ×2, `AGENT/src/autonomy/autonomous-loop-engine.ts` ×2, `AGENT/src/services/accounts.ts` ×1, `AGENT/src/cli.ts` ×2 → toplam **7** |
| Q5 | Dev-tarafı devasa dosyalar (okunabilirlik, test edilebilirlik) | `request-helpers.ts` 2983, `plugin.ts` 2171, `server.ts` 1915, `request.ts` 1745, `autonomous-loop-engine.ts` 1497, `SQLiteMissionRepository.ts` 991, `sequential-pipeline.ts` 919, `autonomy-session-manager.ts` 741 satır |

**Aksiyon:** ESLint rule `no-console` (warn → error), `@typescript-eslint/no-explicit-any` (warn), `while(true)` yerine `for(let i=0; i<MAX; i++)` + timeout guard. Dosya boyutu için 600-satır soft limit policy.

---

## 8. P3 — MİMARİ: optimizer stub

| # | Bulgu |
|---|---|
| A1 | `ai-stack-mcp/app/orchestrator.py` — pipeline orchestrator **stub**. Cache'i no-op, MAB'i sabit, LLMLingua'yı çağırmıyor, RAG'i bypass. Gateway UI "Optimizing…" diyor ama altında stage'ler boş. |
| A2 | ModelCascade + Circuit Breaker var ama orchestrator onlara bağlı değil — iki kod yolu paralel. |
| A3 | spaCy modeli `en_core_web_sm` yükleme adımı hiçbir belgede yok; `python -m spacy download …` komutu `README.md`'de yok, Dockerfile'da yok. İlk boot'ta ImportError. |

**Aksiyon:** MVP orchestrator — exact-match cache (sqlite) + tiktoken sayacı + rule-based stage sequencer + 3 sağlayıcı adaptörü (Anthropic/OpenAI/Ollama). Docker build'e `RUN python -m spacy download en_core_web_sm` ekle.

---

## 9. P4 — TEST AÇIĞI

Tipik "yazılmış sanılan, yazılmamış" testler:

| # | Test edilmemiş modül |
|---|---|
| T1 | `AGENT/src/services/settings/routes.ts` — HTTP kontrat testi yok (PATCH deep-merge semantiği, secret clear-with-empty-string davranışı hiç test edilmemiş). |
| T2 | `AGENT/src/services/settings/schema.ts` — `SECRET_PATHS` ↔ `.brand("secret")` senkronizasyonunu koruyacak invariant testi yok. |
| T3 | `AGENT/src/services/settings/index.ts` — store birim testleri pre-compiled better-sqlite3 yüzünden çalışmıyor; CI'de skip değil, **slickt sessiz** hata veriyor. |
| T4 | `AGENT/src/orchestration/mission-runtime.ts` — runtime tek integration test'siz. |

**Aksiyon:** vitest + supertest kontrat suite (4 endpoint), schema invariant snapshot, better-sqlite3 için prebuild matrix CI step'i, mission-runtime için golden-transcript test.

---

## 10. Çabucak kapanabilecek quick-win'ler (0.5 gün)

1. `git rm` ile Bölüm 1 ve 2'deki 30+ dosya/dizin.
2. `.gitignore` konsolidasyonu + S1–S6 desenleri.
3. `@types/better-sqlite3` → devDependencies.
4. `console.log(process.env.*_API_KEY)` grep-replace (phase2-deep.test.ts, .tmp_deep_test_secrets/env.ts).
5. `security:scan` INCLUDE_DIRS'i repo kökünden başlatacak şekilde genişlet — bir daha kaçmasın.
6. ESLint `no-console: error`, `no-constant-condition` kuralını aç.

---

## 11. Tamir sırası (önerilen)

```
D0  ── Secrets rotation + repo purge (P0 §1–3)        [1 gün]
D1  ── Rebrand sweep + deps cleanup (P1 §4–5)         [0.5 gün]
D2  ── 6 kritik bug fix + regression testler (P2 §6)  [2 gün]
D3  ── console.log / any / while(true) cleanup        [1 gün]
D4  ── Orchestrator MVP + spaCy dokümantasyonu (P3)   [3–5 gün]
D5  ── Settings test suite + CI matrix (P4)           [1 gün]
```

Toplam: ~10 iş günü, iki kişi paralel çalışınca ~1 sprint.

---

## Ek — kaynakların izi (grep reçeteleri)

```bash
# Sızmış sırlar (push geçmişi de taranmalı — git-filter-repo)
grep -rnE "sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|lojinext_[A-Za-z0-9]{20,}" AGENT/

# process.env sızıntısı
grep -rnE "console\.(log|error)\(.*process\.env\." AGENT/src AGENT/.tmp*

# while(true) bounded olmayan
grep -rnE "while\s*\(\s*true\s*\)" AGENT/src

# büyük dosyalar
find AGENT/src -type f -name '*.ts' -exec wc -l {} + | sort -rn | head

# repo çöpü
find AGENT -maxdepth 2 \( -name '*.corrupt.*' -o -name '*.vsix' -o -name '*.tgz' \)
```
