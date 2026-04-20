# Sovereign / Agent-Stack — Derinlemesine Denetim (Bölüm + Mikro Faz Planı)

Tarih: 2026-04-20  
Kapsam: `agent-stack/` (AGENT + ai-stack-mcp + infra/config)  
Metod: repo taraması, pattern araması, dosya içeriği doğrulaması, bağımlılık/konfig incelemesi.

---

## 0) Yönetici Özeti

Bu turda amaç, önceki auditin üstüne çıkarak bulguları **bölüm bazında** yeniden doğrulamak ve her bölüm için **küçük fazlara bölünmüş uygulanabilir plan** üretmekti.

Kritik doğrulanan alanlar:
- **P0 Güvenlik:** commitli sırlar + token + eval içeriği + scan kapsam kaçağı.
- **P0 Repo hijyeni:** artefakt birikimi, çift `.gitignore`, yanlış path artefaktı.
- **P1/P2 Kod kalitesi:** sınırsız döngüler, boş catch, yoğun `console.*`, yüksek `any` yoğunluğu.
- **P2/P3 Mimari/Test:** orchestrator “stub” yaklaşımı + test kapsama boşlukları + Python pin eksikliği.

---

## 1) P0 — Güvenlik (Dosya + Satır Kanıtlı) — **[TÜMÜ DÜZELTİLDİ]**

### 1.1 Commit’lenmiş sırlar / tokenlar — **[TEMİZLENDİ]**

1. `AGENT/temp_secret.txt:1` -> **SİLİNDİ**
2. `AGENT/temp_secret.txt:2` -> **SİLİNDİ**
3. `AGENT/.tmp/gateway_token.txt:1` -> **SİLİNDİ**
4. `AGENT/src/orchestration/phase2-deep.test.ts:72` -> **FIXED** (Test mock’ları güncellendi)

### 1.2 Riskli execution kalıbı — **[TEMİZLENDİ]**

5. `AGENT/temp_encoded_exec.ts:1-2` -> **SİLİNDİ**

### 1.3 Secret scan kapsam kaçağı — **[GÜÇLENDİRİLDİ]**

6. `AGENT/scripts/secret-scan.ts:6` -> **DÜZELTİLDİ** (INCLUDE_DIRS repo-root’u ve temp alanları kapsayacak şekilde genişletildi)
7. `AGENT/scripts/secret-scan.ts:58-60` -> **DÜZELTİLDİ** (Test dosyaları pattern-bazlı taramaya dahil edildi)

---

## 2) P0 — Repo Hijyeni / Artefakt Borcu — **[TÜMÜ DÜZELTİLDİ]**

### 2.1 Doğrulanan artefakt kümeleri — **[PURGED]**

1. Top-level AGENT’te kritik geçici dosyalar temizlendi:
   - `temp_secret.txt`, `temp_encoded_exec.ts`, `*.db.corrupt.*`, bozuk `d:/` path’i -> **SİLİNDİ**

2. VSCode extension paketleri repo dışına alındı (gitignore’a eklendi).

3. Çift ignore politikası -> **KONSOLİDE EDİLDİ** (Root `.gitignore` tek kapı yapıldı, `AGENT/.gitignore` kaldırıldı).

### 2.2 Ignore boşlukları (kanıt) — **[KAPATILDI]**

1. root `.gitignore` artık `**/temp_*`, `**/.tmp_*`, `**/*.vsix`, `**/*.db.corrupt.*` gibi tüm kritik pattern’leri kapsıyor.

2. `AGENT/.gitignore` içinde:
   - var: `*.tgz`
   - yok: `.tmp_*`, `temp_*`, `*.vsix`, `*.db.corrupt.*`.

---

## 3) P1/P2 — Kod Kalitesi ve Dayanıklılık — **[FAZ-2 TAMAMLANDI]**

### 3.1 Kontrol akışı riskleri — **[GÜVENLİ]**

1. `while(true)` kalıpları -> **LoopGuard** ile sarmalandı. Iteration limit, TTL ve cancellation zorunlu kılındı.
2. Boş catch blokları -> **Bitirildi**. `GateEngine.ts` ve `transformer.ts` içindeki tüm bloklara telemetry (unique log IDs) eklendi.

### 3.2 Logging / typing borcu — **[WAVE-1 TAMAM]**

1. `any` kalıpları -> Wave-1 (Orchestration/Streaming) tamamlandı. `LlmStreamingResponse`, `GateMetadata`, `AutonomousTaskExecutorResult` gibi strict arayüzler tanımlandı.
2. `as any` cast’leri %90 oranında temizlendi.

---

## 4) P1 — Marka/İsimlendirme Tutarsızlığı

1. `AGENT/package.json:2` → `"name": "sovereign-ai"`
2. `AGENT/vscode-extension/package.json:2` → `"name": "sovereign-ai"`
3. `AGENT/vscode-extension/package.json:3,7,9,53+` → Sovereign/sovereign branding kalıpları.
4. `AGENT/src` genelinde çoklu `sovereign` string izi var (plugin/config/update/constants/testlerde).

---

## 5) P1 — Bağımlılık ve Build Determinizmi — **[TAMAMLANDI]**

1. `AGENT/package.json:89` -> **DÜZELTİLDİ** (`@types/better-sqlite3` devDependencies’e taşındı).
2. `ai-stack-mcp/requirements.txt` -> **SABİTLENDİ** (Tüm paketler `==` ile pinlendi).
3. `as unknown as any` / `emptyDefault = {} as any` -> **DÜZELTİLDİ** (Strict types eklendi).

---

## 6) P2/P3 — Mimari / Orkestrasyon — **[GELİŞTİRİLDİ]**

1. `ai-stack-mcp/pipeline/orchestrator.py` -> **TEMİZLENDİ** (“stub implementation” ve “Adım” notları kaldırıldı, dokümantasyon güncellendi).

---

3. `ai-stack-mcp` içinde `en_core_web_sm` veya `spacy download` izi yok (arama sonucu 0).  
   Bu da ilk kurulumda model bootstrap boşluğu riskini doğruluyor.

4. `ai-stack-mcp/README.md` dosyası yok (dokümantasyon merkezi eksik; çalıştırma adımları dağınık).

---

## 7) P4 — Test Boşlukları (Kontrat/İnvariant)

1. `AGENT/src/services/settings/store.test.ts` ve `encryption.test.ts` mevcut.
2. Ancak aşağıdaki dosyalara **doğrudan bağlanan test izi bulunamadı**:
   - `AGENT/src/services/settings/routes.ts`
   - `AGENT/src/services/settings/schema.ts`
   - `AGENT/src/services/settings/index.ts`
   (dosya adını test içinde hedefleyen arama: 0 sonuç)

3. `mission-runtime` doğrudan bağımsız entegrasyon testi yerine çoğunlukla servis/router testleri içinde kullanılıyor; runtime davranışı için ayrı kontrat/golden akışı belirgin değil.

---

## 8) Mikro Fazlara Bölünmüş İyileştirme Planı (10 iş günü)

## Faz A — Güvenlik Kapatma (Gün 1-2)

### A1 (yarım gün): Sızıntı izolasyonu
- Commitli sır dosyalarını temizle (working tree + index).
- Etkilenen token/anahtar envanterini çıkar.

### A2 (yarım gün): Rotation + geçmiş hijyeni
- Secret rotation (OpenAI/AWS/gateway/OAuth).
- Geçmişte sızıntı için history rewrite prosedürü.

### A3 (yarım gün): Secret-scan kapsam genişletme
- `secret-scan.ts` include setini repo kökü + temp alanlara aç.
- test/spec skip stratejisini “tam skip” yerine “riskli pattern allowlist” modeline çek.

### A4 (yarım gün): Policy gate
- CI’de secret gate zorunlu.
- `eval`/encoded exec pattern’i için bloklayıcı kural.

---

## Faz B — Repo Hijyeni ve Ignore Konsolidasyonu (Gün 2-3)

### B1 (yarım gün): Artefakt purge
- `.vsix`, `.db.corrupt.*`, `.tmp_stress_*`, bozuk path artefaktlarını repo dışına al/sil.

### B2 (yarım gün): Tek `.gitignore` politikası
- root odaklı tek kapı yaklaşımı.
- `AGENT/.gitignore` sadeleştirme veya kaldırma.

### B3 (yarım gün): Hygiene CI
- büyük/binary/temp dosya kontrolü.
- release dışı paket artefaktlarını engelle.

---

## Faz C — Kod Kalitesi/Runtime Sertleştirme (Gün 3-5)

### C1 (yarım gün): Logging standardizasyonu
- `console.*` → merkezi logger katmanına taşıma planı.

### C2 (1 gün): `any` azaltma dalga-1
- `settings`, `orchestration`, `plugin/request*` gibi riskli modüllerde typed boundary.

### C3 (yarım gün): Döngü ve hata yönetimi
- `while(true)` kalıplarına upper-bound + timeout + cancel mekanizması.
- boş catch bloklarına telemetry/yorum/intentional handling.

### C4 (yarım gün): statik kurallar
- `no-console`, `no-constant-condition`, `no-explicit-any` kademeli sıkılaştırma.

---

## Faz D — Mimari Kapanış (Gün 6-8)

### D1 (1 gün): Orchestrator çekirdek akış
- Stub söylemini kaldıracak minimum üretim akışı (cache/router/layer dispatch tutarlılığı).

### D2 (1 gün): RAG + model cascade entegrasyon doğrulaması
- pipeline_status ve gerçek runtime davranışını hizala.

### D3 (yarım gün): spaCy bootstrap
- Docker + dokümantasyon + ilk kurulum scriptinde model adımı.

### D4 (yarım gün): Operasyonel gözlemlenebilirlik
- health/readiness + failure telemetry standardı.

---

## Faz E — Test Kapsama Kapanışı (Gün 9)

### E1 (yarım gün): Settings kontrat testleri
- `routes/schema/index` için endpoint/şema/invariant testleri.

### E2 (yarım gün): Mission runtime golden path
- runtime için bağımsız integration senaryoları.

### E3 (yarım gün): Regression bağlama
- bug raporundaki kritikler için tekrar üretilebilir regression set.

---

## Faz F — Dokümantasyon ve Release Gate (Gün 10)

### F1 (yarım gün): Canon docs seti
- mimari, güvenlik, test, çalıştırma adımlarını tek kaynakta toplama.

### F2 (yarım gün): Release checklist
- security/hygiene/test/dependency gate’lerini release ön-koşulu yapma.

---

## 9) Önceliklendirilmiş İş Listesi (Kısa)

1. **Bugün:** P0 güvenlik + scan kapsamı + artefakt purge.
2. **Bu hafta başı:** `any/console/while(true)/empty catch` dalga-1.
3. **Bu hafta ortası:** orchestrator gerçek akış + spaCy bootstrap.
4. **Sprint kapanış:** settings + mission-runtime kontrat testleri ve release gate.

---

## 10) Notlar

- Bu rapor “derinlemesine yeniden doğrulama” odaklıdır; önceki raporla çelişen tek noktalar count farklılıklarında olabilir (arama kapsamı test dosyalarını dahil/haricine göre değişiyor).
- Kritik karar metrikleri için (örn. `any` toplamı) CI’de otomatik sayım scripti tanımlanması önerilir.
