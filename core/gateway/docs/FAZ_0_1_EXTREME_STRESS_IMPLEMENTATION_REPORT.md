# Faz 0/1 Extreme Stress Uygulama Raporu

Tarih: 2026-03-12  
Kapsam: Orchestrator Core ve State Machine icin extreme stress plani uygulamasi, testleri ve dokumantasyon netlestirmeleri.

## 1. Kisa Ozet

Bu calisma, revize planin tamamini ve review sonrasi acik kalan 3 kritik noktayi birlikte kapatir:

1. Deterministic race arbitration (`pause` > `done`) korundu ve testlendi.
2. JSON recovery zinciri (`strict -> fenced/tail-trim -> summary-only`) ayri testlerle dogrulandi.
3. `modelRequestTimeoutMs` eklendi; default `90_000ms` degeri "local fail-fast" olarak belgelendi.
4. OOM ve SIGKILL semantigi ayrildi:
   - OOM: runtime icinde immediate fail + retry bypass
   - SIGKILL: runtime catch beklentisi yok, startup recovery
5. Sunk-cost davranisi (refund yok) korundu ve budget etkisiyle birlikte testlendi.
6. Secret guvenligi Gate + Terminal katmaninda guclendirildi.
7. Review sonrasi netlestirmeler eklendi:
   - OOM imzalarinin gercek Node metinleriyle dogrulanmasi
   - stale `touchedFiles` re-validation testinin explicit hale getirilmesi
   - `verify without touched files` davranisinin log-gurultu degil, bilincli semantik oldugunun netlestirilmesi

## 2. Degisiklikler ve Nedenleri

### 2.1 Deterministic Race Arbitration (pause vs done)

Problem: `verify -> done` tamamlanmasi ile kullanici `pause` istegi ayni sinirda yarisa girebiliyordu.

Yapilan:
- `PhaseEngine.resolveTransition(...)` ile pure precedence kurali kullanildi.
- Kural: completion boundary'de pause pending ise `done` yerine `paused` secilir.
- `AutonomousLoopEngine.completeSession(...)` bu sonucu kullanir.

Neden:
- Flaky timing testleri yerine deterministic transition karari.
- Concurrency davranisi unit test seviyesinde direkt dogrulanabilir.

### 2.2 JSON Recovery Zinciri

Problem: squeeze sonrasi kirpilmis JSON payload parse edilemeyebiliyor.

Yapilan:
- Parse sirasi net: `strict -> fenced/tail-trim -> summary-only`.
- Guard: payload JSON-benzeri ise `summary-only` fallback devreye girmez.
- JSON-benzeri ve toparlanamayan payload hard-fail verir: `MODEL_PAYLOAD_PARSE_ERROR`.

Neden:
- Sessiz veri bozulmasini engellemek.
- Recovery davranisini deterministic ve izlenebilir yapmak.

### 2.3 Timeout Semantigi (`90_000ms`)

Problem: timeout degerinin anlami provider SLA ile karisabiliyordu.

Yapilan:
- `AutonomySessionManager` icin `modelRequestTimeoutMs?: number` eklendi.
- Default `90_000ms` (`AbortSignal.timeout(90_000)`) korunup konfigure edilebilir yapildi.
- Caller abort + timeout abort tek signal olarak birlestirildi.
- Timeout hatasi `MODEL_TIMEOUT` olarak siniflandi.

Neden:
- FIN gelmeyen asili network durumlarinda fail-fast.
- Runtime davranisini acik ve override edilebilir yapmak.

Ek not:
- `90_000ms` provider SLA iddiasi degildir; local fail-fast default'tur.
- Production kalibrasyonu (model/gear bazli p95/p99) ayrica yapilmalidir.

### 2.4 OOM ve SIGKILL Ayrimi

Problem:
- SIGKILL runtime icinde yakalanamaz.
- OOM, tipik olarak retry ile duzelmez.

Yapilan:
- `isImmediateFailExecutionError(...)` ile OOM classifier eklendi.
- OOM icin immediate fail + retry bypass uygulandi.
- SIGKILL runtime catch beklentisi kaldirildi; startup recovery modeline baglandi.
- Node OOM metinleri explicit test edildi:
  - `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
  - `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`

Neden:
- OOM senaryosunda bos retry dongusu ve token maliyetini kesmek.
- SIGKILL gercegine uygun operasyonel recovery modeli kullanmak.

### 2.5 Stale Artifact Sync (`touchedFiles`)

Problem: runtime snapshot'taki `touchedFiles`, disk/git gercekligiyle ayrisabilir.

Yapilan:
- `revalidateTouchedFiles(...)` davranisi icin explicit test eklendi.
- Resume sirasinda git dirty-tree ile stale path'lerin prune edildigi dogrulandi.

Neden:
- Power-loss / OS buffering gibi durumlarda stale metadata ile verify etme riskini azaltmak.

### 2.6 `verify without touched files` Semantigi

Problem: bu durum log gurultusu gibi gorunuyordu; gercek semantik net degildi.

Yapilan:
- Varsayilan `console.warn` kaldirildi.
- Warning opt-in hale getirildi: sadece `ALLOY_WARN_VERIFY_NO_TOUCHED=1` iken basilir.
- `analysis` ve `finalize` gibi no-file task tipleri icin warning basilmamasi netlestirildi.

Neden:
- Gereksiz test/CI spamini azaltmak.
- No-file verify akisini "bilincli davranis" olarak kod seviyesinde netlestirmek.

### 2.7 Sunk-Cost (Token Refund Yok)

Problem/Limit: retry/backtrack sonrasi harcanan tokenlar iade edilmez.

Yapilan:
- Davranis degistirilmedi (bilincli karar).
- Iki seviyede test eklendi:
  - retry sonrasi token kullaniminin birikimli kaldigi
  - retry sonrasi biriken TPM'in budget hard-limit'i tetikleyebildigi

Neden:
- Monotonik muhasebe deterministic ve basit.
- Faz 0/1 kapsaminda rollback/refund karmasikligini ertelemek daha pragmatik.

### 2.8 Secret Guvenligi (False Positive / False Negative)

Yapilan:
- SecretGate patternleri encoded/decode-exec zincirleri icin genisletildi.
- TerminalExecutor seviyesinde de encoded execution denylist uygulandi.
- False positive testi: `API_KEY=test_string` bloklanmaz.
- False negative testi: encoded execute paternleri bloklanir.

Neden:
- Tek katmana guvenmek yerine defense in depth.

## 3. Public API ve Dokuman Etkisi

### Kod arayuzu
- `src/orchestration/PhaseEngine.ts`
  - deterministic transition precedence (`pause` onceligi)
  - verify warning semantigi opt-in
- `src/gateway/autonomy-session-manager.ts`
  - `modelRequestTimeoutMs?: number`
- `src/gateway/server.ts`
  - timeout secenegini manager'a paslama
- `src/orchestration/autonomous-loop-engine.ts`
  - OOM immediate-fail classifier
  - resume baslangicinda `touchedFiles` re-validation

### Dokuman
- `docs/ARCHITECTURE.md`
  - timeout semantigi (`90_000ms` local default)
  - SIGKILL startup recovery semantigi
  - sunk-cost limitation

## 4. Eklenen / Guncellenen Testler

### State machine ve race
- `resolveTransition` ile deterministic pause-oncelik testi
- verify tamamlanma sinirinda `pause` kazanimi
- `verify without touched files` icin opt-in warning testleri

### JSON recovery
- strict fail -> fenced success
- strict + fenced fail -> summary-only success
- JSON-benzeri strict + fenced fail -> hard-fail

### OOM/SIGKILL
- OOM metin varyantlariyla immediate fail + retry olmamasi
- SIGKILL sonrasi startup recovery akisi

### Stale sync
- `revalidateTouchedFiles` ile stale snapshot girdilerinin prune edilmesi

### Budget / sunk-cost
- retry sonrasi token birikiminin korunmasi
- retry sonrasi TPM hard-limit tetigi

### Timeout
- never-resolving fetch icin abort/fail
- default timeout semantiginin dogrulanmasi

### Secret guvenligi
- false positive testi (`API_KEY=test_string`)
- false negative testi (encoded execute bloklama)

## 5. Bu Turda Calistirilan Dogrulamalar

Calistirildi:
- `npm run typecheck`
- `npx vitest run src/orchestration/PhaseEngine.test.ts src/orchestration/autonomous-loop-engine.test.ts`
- `npx vitest run src/persistence/recovery/StartupRecovery.test.ts`
- `npm test`

Sonuc:
- Typecheck: basarili
- Hedefli testler: basarili (`3` dosya, `50` test)
- Tam suite: basarili (`93` dosya, `1476` test)

Not:
- Bazi testler negatif-path/assertion geregi `stderr` log uretir; bu kosumda da beklenen davranis olarak goruldu.

## 6. Korunan Pragmatik Kararlar

1. `maxCycles` asiminda rollback yok, hard-stop fail.
2. Sunk-cost refund yok (monotonik muhasebe).
3. SIGKILL runtime catch yerine startup recovery.
4. Secret guvenligi Gate + Terminal birlikte.

## 7. Kalan Riskler ve Sonraki Oneri

1. `90_000ms` timeout default'u production telemetry ile kalibre edilmeli (model/gear bazli p95/p99).
2. UI/JSDOM tarafindaki SVG warning'leri test cikti hijyeni icin susturulabilir.
3. `console` tabanli loglar merkezi logger seviyesine tasinabilir.

---

Bu rapor Faz 0/1 extreme stress uygulamasinin teknik sonucunu, karar gerekcelerini ve dogrulama durumunu kayit altina almak icin guncellendi.
