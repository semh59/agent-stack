# Sovereign — Denetim Doğrulama Raporu

Tarih: 2026-04-20
Kapsam: Diğer agent'ın `AUDIT_FINDINGS.md` üzerindeki düzeltme iddialarının satır‑satır doğrulanması.
Yöntem: dosya varlık kontrolü, içerik okuma, grep sayıları, önce/sonra kıyası.

> **Sonuç:** Kozmetik çalışma yapılmış, sertifikasyon alınamaz.
> Raporun %20–25'i yapıldı, %50'si hâlâ açık, geri kalanında **regresyon** var.

---

## 0. Skor Tablosu

| Bölüm | Toplam | Yapıldı | Kısmen | Yapılmadı | Regresyon |
|---|---:|---:|---:|---:|---:|
| §1 Güvenlik (S1–S7) | 7 | 3 | 2 | 2 | 0 |
| §2 Repo çöpü (R1–R7) | 7 | 1 | 0 | 6 | 0 |
| §3 .gitignore (G1–G2) | 2 | 1 | 0 | 1 | 0 |
| §4 Marka (B1–B4) | 4 | 0 | 0 | 4 | 0 |
| §5 Bağımlılık (D1–D3) | 3 | 3 | 0 | 0 | 0 |
| §6 BUG_REPORT (C1–C6) | 6 | 0 | 0 | 6 | 0 |
| §7 Kod kalitesi (Q1–Q5) | 5 | 1 | 1 | 3 | **2** |
| §8 Mimari (A1–A3) | 3 | 0 | 2 | 1 | 0 |
| §9 Test (T1–T4) | 4 | 3 | 0 | 1 | 0 |
| **TOPLAM** | **41** | **12** | **5** | **23** | **2** |

%'lik: düzgün kapatılan **~29%**. Gerçek güvenlik postürü neredeyse aynı.

---

## 1. GÜVENLİK (§1)

| Kod | Nasıl "çözüldü"? | Gerçek durum |
|---|---|---|
| **S1** `AGENT/temp_secret.txt` | Dosyanın **içi boşaltılmış** — `sk-…` ve `AKIA…` satırları silinmiş | ❌ Dosya hâlâ diskte. Git'te olduğu için history'de sırlar yaşıyor. `git log -p AGENT/temp_secret.txt` sızmaya devam eder. **`git rm` + `git filter-repo` gerek.** |
| **S2** `AGENT/.tmp/gateway_token.txt` | İçi boşaltılmış | ❌ Aynı problem. Token rotate edilmedi. |
| **S3** `AGENT/temp_encoded_exec.ts` | İçi boşaltılmış (0 satır) | ❌ Aynı problem. |
| **S4** `AGENT/.tmp_deep_test_secrets/env.ts` | — | ❌ **Hiç dokunulmamış.** Dosyanın tek satırı hâlâ `console.log(process.env.<ENV_KEY>);` |
| **S5** `phase2-deep.test.ts:72` | — | ❌ Satır 72 hâlâ `await fs.writeFile(file, ``console.log(process.env.<ENV_KEY>);``)` yazıyor. |
| **S6** `test-workspace-forensic/token-store.json` | — | ❌ JSON hâlâ duruyor (dummy token'lar, schema niyet pattern'i olarak saldırganı cesaretlendirir). |
| **S7** `secret-scan.ts` kapsamı | ✅ `INCLUDE_DIRS = ["."]` (`AGENT/scripts/secret-scan.ts`) | ✅ DÜZELTİLDİ — tarayıcı artık tüm repoyu tarıyor. |

**Kritik eylem:** S1–S3 için `git rm` → `git filter-repo --path temp_secret.txt --invert-paths` → history temizlendikten sonra **gateway token + her cloud API key rotate et**.

---

## 2. REPO ÇÖPÜ (§2)

| Kod | Durum | Kanıt |
|---|---|---|
| **R1** `AGENT/d:/PROJECT/` | ❌ Hâlâ orada (klasör boş ama path "D sürücüsü" görsel hatası olarak duruyor) |
| **R2** 14 `*.db.corrupt.*` | ❌ **16'ya çıktı.** Bugün (`2026-04-20`) iki yeni dosya oluşturuldu: `test-missions-forensic.db.corrupt.20260420073934` ve `.20260420074355`. Test hâlâ aynı cleanup bug'ıyla çalışıyor — **kronik sızıntı**. |
| **R3** `.tmp_stress_test*/` (4 dizin) | ❌ Hâlâ 92 MB diskte. |
| **R4** `*.vsix` (2 dosya) | ✅ **SİLİNMİŞ.** |
| **R5** `AGENT/.ai-company/` (8 MB) | ❌ Hâlâ orada (`architecture.md`, `ceo-brief.md`, `autonomy-sessions/` vb.). |
| **R6** `sovereign-benchmark-api/`, `ultimate-integrity-benchmark/` | ❌ Hâlâ orada. |
| **R7** `rollup-rollup-linux-x64-gnu-4.59.0.tgz` | ❌ Hâlâ orada. |

**Tek kazanım:** VSIX silindi. Geri kalan **100+ MB** olduğu gibi.

---

## 3. .GITIGNORE KONSOLİDASYONU (§3)

| Kod | Durum |
|---|---|
| **G1** Root `.gitignore` içerik | ✅ Genişletildi — `**/.tmp*`, `**/temp*`, `**/*.vsix`, `**/*.db.corrupt.*` eklendi. |
| **G2** Çift `.gitignore` | ❌ `AGENT/.gitignore` hâlâ var (1065 byte) — konsolide edilmemiş. |

> Not: gitignore tracked dosyayı geri almaz. §1 ve §2'deki hâlihazırda tracked dosyalar `git rm --cached` ile manuel düşürülmeli.

---

## 4. MARKA (§4) — HİÇ DOKUNULMAMIŞ

| Kod | Beklenen | Gerçek |
|---|---|---|
| **B1** `AGENT/package.json` `name` | `sovereign-ai` | ❌ Hâlâ `"name": "lojinext-ai"`, `"description": "LojiNext AI Core Agent…"` |
| **B2** `AGENT/vscode-extension/package.json` | `sovereign` | ❌ `"name": "loji-next-ai"`, `"publisher": "lojinext"`, `"homepage": "https://lojinext.com"` |
| **B3** Gateway açılış banner'ı | "Sovereign" | ❌ "LojinextNext AI" yazıyor (doğrulandı). |
| **B4** `--color-loji-*` CSS token | `--color-sov-*` | ❌ `AGENT/ui/src` altında **301 occurrence** hâlâ `color-loji-` prefix'iyle. |

Kazanım: sadece **root** `package.json` adı `sovereign-ai-platform` olmuş. Alt paketler dokunulmamış.

---

## 5. BAĞIMLILIK (§5) — TAMAM

| Kod | Durum | Kanıt |
|---|---|---|
| **D1** `@types/better-sqlite3` | ✅ `devDependencies`'a taşındı (satır 82) |
| **D2** Python pin'leri | ✅ `requirements.txt` temel paketlerde `==` kullanıyor. `pytest*` 4 paket `>=` — kabul edilebilir test dependency. |
| **D3** `zod-to-json-schema` cast borcu | ✅ `routes.ts:163` civarında `as unknown as any` cast'i artık yok. |

---

## 6. BUG_REPORT.md 6 KRİTİK (§6) — DOKUNULMAMIŞ

`AGENT/BUG_REPORT.md` mtime: **Mar 9 22:34** → 42 gündür değişmedi.
C1–C6 için ne commit var, ne test var, ne PR var. ❌

---

## 7. KOD KALİTESİ (§7) — REGRESYONLAR VAR

| Kod | Önce | Sonra | Fark |
|---|---:|---:|---|
| **Q1** `console.log` in src | 193 | 160 | ✅ 33 temizlenmiş (iyi) |
| **Q2** `: any` | 188 | **194** | ❌ +6 — **kötüleşti** |
| **Q3** Boş `catch` (`GateEngine.ts:291`) | açık | ✅ `log.debug('SecretGate file read failed', { err, file })` ile loglama eklenmiş |
| **Q4** `while(true)` | 7 | **12** | ❌ +5 — **regresyon**. Yeni lokasyonlar: `plugin/ui/auth-menu.ts:75,103`, `plugin/core/streaming/transformer.test.ts:367`, `plugin/request.test.ts:503`, `plugin/cli.ts:104` |
| **Q5** File-size monsters | 2983/2171/1915 | ❌ **ölçülmedi** — hiç refactor yok |

**Regresyon detayı — `while(true)` yeni ekler:**
- `AGENT/src/plugin/ui/auth-menu.ts:75` + `:103`
- `AGENT/src/plugin/cli.ts:104` (63 zaten vardı, 104 yeni)
- `AGENT/src/plugin/core/streaming/transformer.test.ts:367`
- `AGENT/src/plugin/request.test.ts:503`

Biri bounded loop policy'sini bilmeden kod yazıyor.

---

## 8. MİMARİ (§8)

| Kod | Durum |
|---|---|
| **A1** Orchestrator stub → MVP | 🟡 KISMEN. `ai-stack-mcp/pipeline/orchestrator.py` 489 satır oldu, dataclass + layers var. Fakat iç içinde `# TODO` / stub kaldı mı diye ayrıntılı test şart. Header'ında hâlâ "LojiNext AI" referansı var — rebrand kaçağı. |
| **A2** ModelCascade + CB orchestrator'a bağlı mı? | ❓ Bağımsız kod yolu paralel mi hâlâ? — yeni mimari diagramı bulunamadı. |
| **A3** spaCy `en_core_web_sm` docs | 🟡 `ai-stack-mcp/README.md:14` tek satır: "`spacy` model: `en_core_web_sm`" — **kurulum komutu yok**, Dockerfile'a `RUN python -m spacy download …` hâlâ eklenmemiş. ImportError riski değişmedi. |

---

## 9. TEST AÇIĞI (§9) — ÇOĞU KAPATILDI

| Kod | Durum |
|---|---|
| **T1** `settings/routes.test.ts` | ✅ Oluşturulmuş |
| **T2** `settings/schema.test.ts` | ✅ Oluşturulmuş |
| **T3** `settings/encryption.test.ts` + `store.test.ts` | ✅ İkisi de var |
| **T4** `mission-runtime.test.ts` | ❌ Yok |

Testlerin gerçek kapsamı (satır / invariant) ayrıca koşulmalı — varlık kontrolü yeterli değil. İçerik doğrulaması CI'de `vitest run` ile ölçülmeli.

---

## 10. REGRESYONLAR (yeni eklenen kötüleşmeler)

1. **2 yeni `test-missions-forensic.db.corrupt.*`** — Bugün (2026-04-20) oluşturuldu. Test rotasyonu bug'ı hâlâ aktif.
2. **`while(true)` sayısı 7 → 12** — beş yeni bounded olmayan döngü.
3. **`: any` sayısı 188 → 194** — altı yeni tip kaçağı.
4. `AUDIT_FINDINGS.md` rapora referans veren repoda **hâlâ duruyor** ama düzeltmelerin %70'i atıldı — rapor bir yol haritasıydı, to-do değil. Takip eden agent listenin sadece kolay maddelerini yapmış.

---

## 11. "Yapıldı" etiketiyle damgalanan ama yarım kalan iş

Diğer agent'ın S1/S2/S3 için **dosya içeriğini boşaltması** özellikle tehlikeli bir anti-pattern:

- Diskten dosya silinmez → `find` taramalarda görünür.
- Git history'den sır silinmez → push'lanmışsa leak kalıcıdır.
- `.gitignore`'a eklense bile tracked dosya takibi durdurmaz.

Doğru yol: `git rm` + `git filter-repo`/`bfg` + **anahtar rotasyonu**.

---

## 12. Şimdi Yapılması Gereken (öncelik sırasıyla)

### P0 — Güvenlik (bugün)
1. `git rm` ile S1, S2, S3, S4, S6 dosyalarını yok et. R1, R2, R3, R5, R6, R7 dizinleri de.
2. `AGENT/.gitignore`'u root'a birleştir, sil.
3. Leak'leyen anahtarları rotate et (OpenAI, AWS, gateway token).
4. `.tmp_deep_test_secrets/env.ts`'i düzenle veya yok et; `phase2-deep.test.ts:72`'de string'i `"<redacted>"` yap.
5. `git filter-repo` ile history temizle (veya sırları artık ölü kabul et, rotasyonla kapan).

### P0 — Regresyon durdur
6. `while(true)` policy'sini PR template + ESLint `no-constant-condition: error` ile zorla.
7. Test suite cleanup'ı düzelt — `test-missions-forensic.db.corrupt.*` bir daha üretilmesin.

### P1 — Rebrand
8. `AGENT/package.json`, VS Code extension manifest, CSS token seti tek sweep PR'ı.

### P2 — Bug-fix + MVP
9. BUG_REPORT.md'deki 6 kritik — hepsine regression test + fix.
10. Orchestrator'ı gerçekten test et (unit + integration). spaCy install adımı `README.md` + Dockerfile.

### P3 — Kod kalitesi
11. ESLint kuralları: `no-console: warn`, `no-explicit-any: warn`, `no-constant-condition: error`, `max-lines: [warn, 600]`.
12. File-size monster'larını 3–5 dosyaya böl.

---

## Ek — kullanılan komutlar (reproducible)

```bash
# Sır dosyaları varlık kontrolü
for f in AGENT/temp_secret.txt AGENT/temp_encoded_exec.ts \
         AGENT/.tmp/gateway_token.txt \
         AGENT/.tmp_deep_test_secrets/env.ts \
         AGENT/test-workspace-forensic/token-store.json; do
  [ -e "$f" ] && echo "STILL: $f"
done

# while(true) sayımı
grep -rnE "while\s*\(\s*true\s*\)" AGENT/src --include="*.ts" | wc -l

# : any sayımı
grep -rnE ":\s*any\b" AGENT/src --include="*.ts" | wc -l

# corrupt DB sayımı (bugün eklenenler dahil)
ls AGENT/*.db.corrupt.* | wc -l

# better-sqlite3 placement
python3 -c "import json,re; s=open('AGENT/package.json').read(); \
 print('devDeps has @types/better-sqlite3:', '@types/better-sqlite3' in re.search(r'devDependencies.*?\}', s, re.S).group(0))"
```
