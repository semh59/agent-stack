# Sovereign — Kapsamlı Onarım Planı

Tarih: 2026-04-20
Kaynak: `AUDIT_VERIFICATION.md` (41 madde · 23 açık · 2 regresyon)

> **İlke:** Önce güvenlik. Sonra hijyen. Sonra marka. Sonra bug. Sonra kalite.
> Her faz bittikten sonra `make verify` (typecheck + grep sayaçları) yeşil olacak.

---

## Faz D0 — Güvenlik & Repo Purge (≈ 2 saat)

Amaç: commit'li sırları ve 100+ MB çöpü diskten kaldırmak. Yeni leak'leri kapatmak.

| Adım | Eylem | Başarı kriteri |
|---|---|---|
| 0.1 | `git rm` ile S1–S3 fiziksel olarak sil (`temp_secret.txt`, `temp_encoded_exec.ts`, `.tmp/gateway_token.txt`). İçleri boş olsa bile dosyalar kalkacak. | `find AGENT -name 'temp_*.txt' -o -name 'temp_encoded*'` → boş |
| 0.2 | `.tmp_deep_test_secrets/env.ts` içeriği `console.log("<redacted>")` ile değiştir, sonra klasörü sil. Alternatif: tüm `.tmp_deep_test_secrets/` dizinini kaldır. | dizin yok |
| 0.3 | `phase2-deep.test.ts:72` satırında string'i `"<redacted>"` yap — test patern'i bozulmasın ama sır payload kalksın. | grep `OPENAI_API_KEY` → 0 |
| 0.4 | `test-workspace-forensic/token-store.json` sil (test workspace kalıntısı). | dosya yok |
| 0.5 | R1 `AGENT/d:/PROJECT/` sil. | dizin yok |
| 0.6 | R2 16 `*.db.corrupt.*` sil. | `ls AGENT/*.corrupt*` → 0 |
| 0.7 | R3 `.tmp_stress_test*/` 4 dizin sil (~92 MB). | `du -sh .tmp_stress*` → 0 |
| 0.8 | R5 `AGENT/.ai-company/` sil (8 MB, yabancı proje çıktısı). | dizin yok |
| 0.9 | R6 `sovereign-benchmark-api/`, `ultimate-integrity-benchmark/` sil. | dizin yok |
| 0.10 | R7 `rollup-rollup-linux-x64-gnu-4.59.0.tgz` sil. | dosya yok |
| 0.11 | `AGENT/.gitignore`'u root'a birleştir → `AGENT/.gitignore` sil. | tek `.gitignore` |
| 0.12 | Test cleanup bug'ı: `test-missions-forensic.db.corrupt.*` üreten test'i bul, `afterAll`'ına `fs.rmSync` ekle. | 15 dakikada tekrar üretmiyor |
| 0.13 | `secret-scan.ts`'i çalıştır, 0 finding bekle. | exit 0 |

**Rotasyon notu:** Gerçek `sk-`, `AKIA`, `sovereign_…` token'ları push'landıysa rotate edilmeli. Plan dışı, user yapmalı.

---

## Faz D1 — Marka Sweep (≈ 1 saat)

Amaç: "sovereign" / "loji" / "Sovereign" → "sovereign".

| Adım | Eylem | Kanıt |
|---|---|---|
| 1.1 | `AGENT/package.json`: name=`@sovereign/gateway`, description=`Sovereign AI — Gateway & Pipeline Orchestrator`, repo/bugs/homepage URL'leri güncelle, keyword listesinden `sovereign` çıkar. | `grep sovereign AGENT/package.json` → 0 |
| 1.2 | `AGENT/vscode-extension/package.json`: name/displayName/publisher/homepage/sponsor/icon alt metinleri. | grep loji → 0 |
| 1.3 | Gateway açılış banner'ı (`AGENT/src/index.ts` veya `logger` init): "Sovereign AI Gateway v<ver>" | runtime çıktı banner'ı |
| 1.4 | CSS token sweep: `--color-loji-*` → `--color-sov-*` (`AGENT/ui/src/**/*.{css,ts,tsx}`). Tek sed + manuel gözden geçirme. | `grep -r color-loji- AGENT/ui/src` → 0 |
| 1.5 | `ai-stack-mcp/pipeline/orchestrator.py` docstring: "Sovereign AI" → "Sovereign AI" | grep → 0 |
| 1.6 | Markdown/docs kaçakları: `grep -r -i 'sovereign\|sovereign' docs AGENT/ README.md` sonucunu temizle. | `grep -irn sovereign .` → 0 (kasıtlı legacy doc hariç) |

---

## Faz D2 — Regresyon Stop (≈ 2 saat)

Amaç: yeni tip kaçakları ve bounded olmayan döngülerin önünü kesmek.

| Adım | Eylem | Kanıt |
|---|---|---|
| 2.1 | ESLint config: `no-constant-condition: error`, `@typescript-eslint/no-explicit-any: warn`, `no-console: ["warn", {"allow":["warn","error"]}]`. | `npm run lint` ile ilgili kurallar aktif |
| 2.2 | 12 `while(true)`'dan 5 yenisini bounded hale getir (`for (let i=0; i<MAX_ITER; i++)` + timeout guard). Mevcut 7 eskiyi ayrı PR'a bırak. | `grep while\(true\) AGENT/src` ≤ 7 |
| 2.3 | `test-missions-forensic.db` oluşturma bug'ı düzeltilince `while(true)` count yeniden ölçülsün. | sabit |
| 2.4 | CI job: PR'da `any` sayısı regresyon gösterirse fail (basit script: ESLint summary). | test PR'da yakalıyor |

---

## Faz D3 — BUG_REPORT.md 6 kritik (≈ 1 gün)

BUG_REPORT.md'i oku; C1–C6 her birine:

| C# | Konu | Fix yaklaşımı |
|---|---|---|
| C1 | Float token counter | `Math.round(tokenCost * 1000) / 1000` + integer ledger + regression test |
| C2 | Negatif health | `Math.max(0, v)` + Zod guard; fuzz test |
| C3 | Array OOB | explicit bounds check veya `?.` guard; property test |
| C4 | Queue `shift()` O(n) | ring buffer (`head`/`tail` index) veya `immutable-js` deque |
| C5 | Recursive JSON infinite loop | depth cap + cycle detection (`WeakSet`) |
| C6 | File lock race | `proper-lockfile` + atomic `writeFile` ile tmp+rename |

Her biri için `*.test.ts` dosyası `describe("regression: C<N> …")` başlığıyla.

---

## Faz D4 — Orchestrator + spaCy (≈ 1 gün)

| Adım | Eylem |
|---|---|
| 4.1 | `ai-stack-mcp/pipeline/orchestrator.py`'i oku; cache/MAB/RAG/Cascade gerçekten çağrılıyor mu tarayıp raporla. |
| 4.2 | Eksik stage'leri ekle; end-to-end `optimize()` testini Chroma + LanceDB tip kontrolüyle koştur. |
| 4.3 | `ai-stack-mcp/Dockerfile`'a `RUN python -m spacy download en_core_web_sm`. |
| 4.4 | `ai-stack-mcp/README.md` ve root `README.md`'e 2 satır kurulum komutu. |
| 4.5 | `ai-stack-mcp/scripts/smoke_test.py`'a spaCy import smoke-check. |

---

## Faz D5 — Testler + CI (≈ 4 saat)

| Adım | Eylem | Kanıt |
|---|---|---|
| 5.1 | `AGENT/src/orchestration/mission-runtime.test.ts` oluştur; golden transcript. | CI geçer |
| 5.2 | `settings/*.test.ts`'leri `vitest run` ile çalıştırıp başarı oranı kaydet. better-sqlite3 prebuild matrix (linux/mac) eklenebilir. | 4/4 test yeşil |
| 5.3 | CI job (`.github/workflows/ci.yml`): lint + typecheck + vitest + pytest + smoke.sh hep birlikte. | PR check yeşil |
| 5.4 | Kod kapsamı badge'i: `vitest --coverage` + `pytest --cov`. | `coverage/` üretiliyor |

---

## Sonraki Adım

D0.1'den başlayarak sırayla yürüteceğim. Her faz sonunda bir özet mesajı ile durum raporu.
