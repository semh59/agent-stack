# 🔍 Alloy Core — Kapsamlı Kod Denetim Raporu

> **Tarih:** 22 Nisan 2026  
> **Kapsam:** `gateway/src/`, `gateway/scripts/`, root test dosyaları  
> **Yöntem:** Statik analiz · TSC çıktısı · ESLint audit · Derin kod inceleme  
> **Toplam Tespit:** ~120 sorun (2 Kritik · 12 Yüksek · 54 Orta · 52 Düşük)

---

## İçindekiler

1. [🔴 KRİTİK — Derleme Kıran Hatalar](#1-kritik--derleme-kiran-hatalar)
2. [🟠 YÜKSEK — Çalışma Zamanı Riskleri](#2-yüksek--çalışma-zamanı-riskleri)
3. [🟡 ORTA — Güvenlik & Kalite Sorunları](#3-orta--güvenlik--kalite-sorunları)
4. [🔵 DÜŞÜK — Teknik Borç & Temizlik](#4-düşük--teknik-borç--temizlik)
5. [🗺️ Çözüm Planı — Öncelik Sıralı](#5-çözüm-planı--öncelik-sıralı)

---

## 1. 🔴 KRİTİK — Derleme Kıran Hatalar

Bu sorunlar TypeScript derleyicisini (tsc) doğrudan patlatıyor. `tsc_errors.txt` dosyasında **aktif olarak kayıtlı** durumda.

---

### 1.1 `SharedMemory` — Eksik Method'lar (TS2339)

**Etkilenen dosyalar:** 8+ dosya · **Kaynak:** `src/orchestration/shared-memory.ts`

Tüm pipeline ve orchestration katmanı, `SharedMemory` sınıfında **tanımlanmamış** method'lara çağrı yapıyor. Bu, tüm ajan orkestrasyon sistemini kilitliyor.

| Eksik Method | Çağrıldığı Yerler | Satırlar |
|---|---|---|
| `clean()` | `scripts/alloy-e2e-test.ts:17`, `scripts/ultimate-integrity-test.ts:27` | TS2339 |
| `appendLog()` | `scripts/test-reality-anchoring.ts:14,15` | TS2339 |
| `readLogTail()` | `scripts/test-reality-anchoring.ts:17`, `src/.../AgentExecutor.ts:36` | TS2339 |
| `updateState()` | `src/orchestration/sequential-pipeline.ts:267`, `forensic-stress.test.ts:94` | TS2339 |
| `getState()` | `sequential-pipeline.ts:228`, `sequential-pipeline.test.ts:105,157,166,279` | TS2339 |
| `readAgentOutput()` | `src/orchestration/pipeline-tools.ts:241`, `sequential-pipeline.test.ts:96` | TS2339 |
| `getRelevantContext()` | `src/orchestration/pipeline/AgentExecutor.ts:21` | TS2339 |
| `getTimeline()` | `sequential-pipeline.ts` (multiple) | TS2339 |

**Kök Neden:** `shared-memory.ts` yeniden yazılmış fakat kullanıcıları güncellenmemiş. Büyük olasılıkla yarım kalan bir refactoring.

**Çözüm:**
```typescript
// src/orchestration/shared-memory.ts — eklenecek method'lar
async clean(): Promise<void> { /* ... */ }
async appendLog(agent: string, message: string): Promise<void> { /* ... */ }
async readLogTail(n: number): Promise<string[]> { /* ... */ }
async updateState(state: Partial<PipelineState>): Promise<void> { /* ... */ }
async getState(): Promise<PipelineState> { /* ... */ }
async readAgentOutput(file: string): Promise<string | null> { /* ... */ }
async getRelevantContext(agent: string, task: string): Promise<string> { /* ... */ }
async getTimeline(): Promise<TimelineEntry[]> { /* ... */ }
```

---

### 1.2 Interface Uyumsuzluğu: `ScopedToolExecutionEngine` (TS2420)

**Dosya:** `src/orchestration/autonomy-scope-engine.ts:19`

```
Class 'ScopedToolExecutionEngine' incorrectly implements interface 'IToolExecutionEngine'.
Property 'runCommand' is missing but required.
```

`IToolExecutionEngine` interface'i (tanımlı `tool-execution-engine.ts:32`) `runCommand(command: string): Promise<ToolResult>` gerektiriyor. `ScopedToolExecutionEngine` bu method'u implement etmiyor — interface contract tamamen kırık.

**Çözüm:**
```typescript
// src/orchestration/autonomy-scope-engine.ts
async runCommand(command: string): Promise<ToolResult> {
  // Scope kontrolü yap, sonra super.runCommand() veya kendi implementasyonu
  if (!this.isCommandAllowed(command)) {
    return { error: 'Command not allowed in current scope', exitCode: 1 };
  }
  return this.executeCommand(command);
}
```

---

### 1.3 `fetch-interceptor.ts` — Tanımsız ~50 Referans (TS2304 / TS2552)

**Dosya:** `src/plugin/core/fetch-interceptor.ts` · Satırlar: 212–1009

Bu dosya bütünüyle çalışmaz durumda. Başka bir modülden gelmesi gereken yaklaşık 50 fonksiyon ve sabit tanımsız bırakılmış:

```
// Tanımsız referanslar (seçmece):
log                          (241, 247, 251, 262, 317)
ProjectContextResult         (295)
trackWarmupAttempt           (329)
markWarmupSuccess            (376)
clearWarmupAttempt           (379)
getCliFirst                  (394)
resolveQuotaFallbackHeaderStyle (412, 431, 689, 715)
ALLOY_ENDPOINT_FALLBACKS     (465–466, 806–807, 1009)
circuitBreaker               (470–471, 806–807, 825, 833)
getTokenTracker              (526, 539, 930, 977)
retryAfterMsFromResponse     (545)
extractRetryInfoFromBody      (546)
parseRateLimitReason         (550)
headerStyleToQuotaKey        (601, 792)
getRateLimitBackoff          (602)
calculateBackoffMs           (605)
logRateLimitEvent            (621)
logResponseBody              (630, 803, 845)
FIRST_RETRY_DELAY_MS         (639, 767, 926)
SWITCH_ACCOUNT_DELAY_MS      (680, 748)
resetRateLimitState          (793)
triggerAsyncQuotaRefreshForAccount (825)
createSyntheticErrorResponse (861)
isEmptyResponseBody          (877)
incrementEmptyResponseAttempts (878)
getEmptyResponseAttempts     (879)
resetEmptyResponseAttempts   (899, 909)
EmptyResponseError           (900)
z  (zod - 918)               // Zod import edilmemiş!
```

**Kök Neden:** Dosya, büyük bir refactoring sırasında parçalara ayrılmış ama import'lar ve kaynak dosya (muhtemelen `quota-helpers.ts` veya `rate-limit.ts`) silinmiş/taşınmış.

**Çözüm:** `quota-manager.ts` veya `rate-limit-helpers.ts` adında bir yardımcı dosya oluştur, tüm tanımsız fonksiyonları buraya taşı ve `fetch-interceptor.ts`'e import et.

---

## 2. 🟠 YÜKSEK — Çalışma Zamanı Riskleri

---

### 2.1 Race Condition: `activeAuthServer` (auth.router.ts)

**Dosya:** `src/api/routers/auth.router.ts:45–92`

```typescript
// SORUN: Module scope'da tek değişken, concurrent request'lerde race condition
let activeAuthServer: AuthServer | null = null;

app.post('/api/auth/login', async (req, res) => {
  if (activeAuthServer) { /* ... */ }
  activeAuthServer = new AuthServer(/* ... */);
  
  // Fire-and-forget: hata yakalanmıyor, activeAuthServer null'a set edilmiyor
  activeAuthServer.start().then(() => {
    activeAuthServer = null; // race: 2. istek bu satırdan önce gelebilir
  }).catch(/* sessizce yutulur */);
});
```

**Risk:** İki eş zamanlı `/api/auth/login` isteği aynı anda gelirse `activeAuthServer` üzerine yazılabilir. İlk server asla temizlenmez → bellek sızıntısı + port çakışması.

**Çözüm:**
```typescript
// Mutex veya per-request context kullan
import { Mutex } from 'async-mutex';
const authMutex = new Mutex();

app.post('/api/auth/login', async (req, res) => {
  const release = await authMutex.acquire();
  try {
    // ...
  } finally {
    release();
  }
});
```

---

### 2.2 CSRF Token Map — Sınırsız Büyüme (Bellek Sızıntısı)

**Dosya:** `src/middleware/csrf.ts:34–35`

```typescript
// Map'in boyutu kontrol edilmiyor — yoğun trafikte OOM
const tokens = new Map<string, TokenEntry>();
```

Sunucu restart olmadan sonsuza dek büyür. `setInterval` temizleyicisi var ama `unref()` çağrısı process exit'te garanti sağlamıyor.

**Çözüm:**
```typescript
const MAX_TOKENS = 10_000;
// Eklemeden önce: if (tokens.size >= MAX_TOKENS) { evictOldest(); }
// veya LRU cache kütüphanesi kullan
```

---

### 2.3 Non-Null Assertion Bombası (chat.router.ts)

**Dosya:** `src/api/routers/chat.router.ts:79`

```typescript
// Eğer model string '/' içermiyorsa, [1]! → undefined → runtime crash
const modelId = selectedModel.split("/")[1]!;
```

**Çözüm:**
```typescript
const parts = selectedModel.split("/");
if (parts.length < 2) throw new BadRequestError(`Invalid model format: ${selectedModel}`);
const modelId = parts[1];
```

---

### 2.4 Unvalidated JSON Cast — Tip Güvensizliği

**Dosya:** `src/api/routers/chat.router.ts:194–196`

```typescript
// JSON'dan gelen veriyi doğrulamadan cast ediyoruz
const result = await response.json() as ExpectedType;
// result.someProperty → runtime error if schema doesn't match
```

**Çözüm:** Zod schema ile parse et:
```typescript
const raw = await response.json();
const result = ExpectedTypeSchema.safeParse(raw);
if (!result.success) throw new ParseError(result.error);
```

---

### 2.5 Array Bounds İhlali (mission.router.ts)

**Dosya:** `src/api/routers/mission.router.ts:145`

```typescript
// index kontrolü yok
const step = mission.timeline[index];
step.status = 'done'; // timeline boşsa veya index büyükse → crash
```

**Çözüm:**
```typescript
const step = mission.timeline[index];
if (!step) throw new NotFoundError(`Timeline step ${index} not found`);
```

---

### 2.6 `normalizeMissionState` — Eksik Default Case

**Dosya:** `src/models/mission.model.ts:169`

Switch/case'de default case yok. Bilinmeyen bir state değeri geldiğinde fonksiyon `undefined` döner fakat dönüş tipi bunu belirtmiyor → tip saçılması.

**Çözüm:**
```typescript
default:
  throw new Error(`Unknown mission state: ${state satisfies never}`);
  // `satisfies never` exhaustiveness check yapar
```

---

### 2.7 `pipeline-tools.ts:152` — Implicit `any` (TS7006)

**Dosya:** `src/orchestration/pipeline-tools.ts:152`

```typescript
// TS strict mode açık olmasına rağmen 'any' geçiyor
.map((t) => `- ${t.agent}: ${t.file} (${t.timestamp})`)
//    ^ TS7006: implicit 'any'
```

**Çözüm:**
```typescript
interface TraceEntry { agent: string; file: string; timestamp: string; }
.map((t: TraceEntry) => `- ${t.agent}: ${t.file} (${t.timestamp})`)
```

---

### 2.8 `mapRuntimeStateToMissionState` — Silent Default

**Dosya:** `src/api/routers/mission.router.ts:113–147`

```typescript
default:
  return "received"; // Bilinmeyen state sessizce "received" döner
```

Bu, gerçek hataları gizler. Exhaustive check gerekli.

---

### 2.9 `setInterval` Memory Leak (privacy.router.ts)

**Dosya:** `src/api/routers/privacy.router.ts:33–42`

Her HTTP isteği için yeni bir `setInterval` yaratılıyor. `request.raw.on("close")` hiç çağrılmazsa (timeout, network drop vs.) interval sonsuza dek çalışır.

**Çözüm:**
```typescript
const interval = setInterval(/* ... */);
req.socket.on('close', () => clearInterval(interval));
// VEYA: AbortSignal kullan
```

---

## 3. 🟡 ORTA — Güvenlik & Kalite Sorunları

---

### 3.1 Build Config Tutarsızlığı

**Dosya:** `gateway/tsconfig.json` vs `gateway/tsconfig.build.json`

| Ayar | tsconfig.json | tsconfig.build.json |
|---|---|---|
| `noEmit` | `true` | `false` (override) |
| `allowImportingTsExtensions` | `true` | `false` (override) |

**Sorun:** Dev ortamında `.ts` extension ile import mümkün ama build sırasında kırılıyor. Bu, "dev'de çalışır, prod'da patlar" senaryosu yaratır.

**Çözüm:** Tüm import'lardan `.ts` extension'ı kaldır, sadece `.js` veya extensionsiz kullan.

---

### 3.2 ESM/CJS Karışıklığı

**Dosya:** `gateway/scripts/workflow-generator.js`

```javascript
// Proje "type": "module" ama bu dosya CommonJS kullanıyor
const something = require('./something'); // ESLint: no-require
```

**Çözüm:**
```javascript
import something from './something.js';
```

---

### 3.3 Root Test Dosyaları — Import Path Sorunu

**Dosyalar:** `stress_omniview_elite.ts`, `verify_elite_p7.ts`, `verify_genetic_p11.ts` (root'ta)

```typescript
import { SharedMemory } from './gateway/src/orchestration/shared-memory';
// TSConfig'de baseUrl/paths tanımsız
// "bundler" resolution mode ile karışabilir
```

Root `tsconfig.json` yok, bu dosyalar hangi tsconfig ile çalışacak belli değil.

**Çözüm:** Root'a `tsconfig.json` ekle:
```json
{
  "extends": "./gateway/tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@gateway/*": ["./gateway/src/*"] }
  },
  "include": ["*.ts"]
}
```

---

### 3.4 `any` Kullanımı — 194 Oluşum

**ESLint audit'ten:** `@typescript-eslint/no-explicit-any` 194 yerde uyarı veriyor.

Kritik örnekler:

| Dosya | Satır | Sorun |
|---|---|---|
| `api/routers/autonomy.router.ts` | 22 | `body?: any` parametre tipi |
| `api/routers/autonomy.router.ts` | 22 | `Promise<any>` dönüş tipi |
| `api/routers/chat.router.ts` | 241 | `{ state: "init" } as any` |
| `api/routers/pipeline.router.ts` | 107 | `planMode as any` |

---

### 3.5 Unused Import'lar — Dead Code

| Dosya | Import | Satır |
|---|---|---|
| `src/gateway/server.ts` | `StoredToken` | 7 |
| `src/gateway/gateway.ts` | `AuthServerOptions` | 10 |
| `src/gateway/model-router.ts` | `estimatedTokens` (değişken) | 143 |
| `src/gateway/pipeline-optimizer.ts` | `RoutingDecision` | 19 |
| `src/gateway/rest-middleware.ts` | `RateLimitEntry` | 9 |

---

### 3.6 Hata Handling Tutarsızlığı

**Dosya:** `src/api/routers/accounts.router.ts:68–118`

Bazı endpoint'ler `{ error: "string" }` dönerken diğerleri düz string veya throw kullanıyor. Tek tip `ApiError` sınıfı tanımlanmalı.

---

### 3.7 Silent Error Swallowing

**Dosya:** `src/api/routers/chat.router.ts:159–161`

```typescript
.catch(_e) {} // Parse hatası sessizce yutulur, kullanıcıya hata dönmez
```

---

### 3.8 Regex Kaçış Karakteri Hataları

**Dosya:** `src/gateway/pipeline-optimizer.ts`

```javascript
// ESLint: no-useless-escape
line 316: /\[/   // → /[/ yeterli
line 317: /\x00/ // Kontrol karakteri regex'te beklenmedik davranış
```

---

### 3.9 `import` yerine `import type` Kullanılmaması

Birçok dosyada tip-only import'lar değer import'u olarak çekiliyor:

```typescript
// YANLIŞ — bundle boyutunu artırır, circular dep riskini yükseltir
import { SomeType } from './types';

// DOĞRU
import type { SomeType } from './types';
```

Etkilenen dosyalar: `agent-handoff.ts:10`, `auth-gateway.ts:21`, `circuit-breaker.ts:16` ve 30+ dosya daha.

---

### 3.10 `accounts.router.ts` — `saveToDisk` Hata Yok

**Dosya:** `src/api/routers/accounts.router.ts:105`

```typescript
await accountManager.saveToDisk(); // try-catch yok, disk hatası response'u patlatır
```

---

## 4. 🔵 DÜŞÜK — Teknik Borç & Temizlik

---

### 4.1 Kullanılmayan Script Değişkenleri

| Dosya | Değişken | Satır |
|---|---|---|
| `scripts/alloy-e2e-test.ts` | `output` parametresi | 103 |
| `scripts/test-regression.ts` | `GEMINI_FLASH_CLI_QUOTA` | 56 |
| `scripts/autonomous-runner.ts` | `PipelineType` import | 1 |
| `scripts/manage-keys.ts` | `secret` parametresi | 9 |
| `scripts/skill-restorer.ts` | `systemPrompt` | 43 |
| `scripts/start-agent.ts` | `output` parametresi | 215 |
| `scripts/remove-account.ts` | `saveAccounts` import | 1 |

**Çözüm:** `_` prefix ekle veya tamamen sil.

---

### 4.2 Node.js Global Tipleri Eksik (.mjs dosyaları)

**Dosya:** `scripts/check-quota.mjs:43,56,61`

```
ESLint no-undef: 'fetch' is not defined
ESLint no-undef: 'URLSearchParams' is not defined
```

**Çözüm:** `/// <reference types="node" />` veya `tsconfig` içinde `"lib": ["ES2022"]` ekle.

---

### 4.3 `prefer-const` İhlali

**Dosya:** `src/api/routers/system.router.ts:71`

```typescript
let tags = []; // → const tags = [];
```

---

### 4.4 Kullanılmayan Catch Değişkenleri

Birçok dosyada:
```typescript
catch (err) { /* err kullanılmıyor */ }
// → 
catch (_err) { /* ya da: catch { */ }
```

Etkilenen: `gateway/routes/delegate.ts`, `system.router.ts:160,182` ve ~15 dosya daha.

---

### 4.5 `hasOwnProperty` Kullanımı

**Dosya:** `scripts/master-test-v4.ts:32`

```typescript
obj.hasOwnProperty('key') // ESLint: no-prototype-builtins
// → Object.prototype.hasOwnProperty.call(obj, 'key')
// veya: Object.hasOwn(obj, 'key')  (Node 16+)
```

---

### 4.6 Naming Tutarsızlıkları

| Dosya | Sorun |
|---|---|
| `accounts.router.ts:85–86` | `emailToDel` vs diğer dosyalarda `targetEmail` |
| `mission.service.ts:413–424` | `loadMission` vs `loadMissionOrThrow` — ne zaman hangisi? |

---

## 5. 🗺️ Çözüm Planı — Öncelik Sıralı

---

### AŞAMA 1 — Kritik Derleme Hataları (Gün 1)

```
[ ] 1. SharedMemory'ye eksik 8 method'u ekle
       Dosya: src/orchestration/shared-memory.ts
       Metod listesi: §1.1'deki tablo
       Süre: ~3 saat

[ ] 2. ScopedToolExecutionEngine'e runCommand() ekle
       Dosya: src/orchestration/autonomy-scope-engine.ts:19
       Süre: ~30 dakika

[ ] 3. fetch-interceptor.ts'i onar
       Seçenek A: Tüm undefined fn'leri quota-manager.ts'e taşı + import et
       Seçenek B: Dosyayı modüllere böl (önerilen)
       Süre: ~6 saat
```

---

### AŞAMA 2 — Race Condition & Bellek (Gün 2)

```
[ ] 4. auth.router.ts activeAuthServer race → Mutex ekle
       Süre: ~1 saat

[ ] 5. csrf.ts token Map boyut limiti ekle
       Süre: ~30 dakika

[ ] 6. privacy.router.ts setInterval sızıntısını kapat
       Süre: ~30 dakika

[ ] 7. chat.router.ts non-null assertion'ları düzelt (split()[1]!)
       Süre: ~1 saat
```

---

### AŞAMA 3 — Tip Güvenliği (Gün 3–4)

```
[ ] 8. mission.model.ts normalizeMissionState'e exhaustive default ekle
[ ] 9. mission.router.ts mapRuntimeStateToMissionState'i düzelt
[ ] 10. chat.router.ts JSON cast'lerini Zod ile doğrula
[ ] 11. pipeline-tools.ts:152 implicit any → TraceEntry tipi ekle
[ ] 12. Tüm `as any` → proper type narrowing (194 oluşum, önce kritik olanlar)
[ ] 13. import → import type dönüşümleri
```

---

### AŞAMA 4 — Yapısal Düzeltmeler (Gün 5)

```
[ ] 14. tsconfig.json'a baseUrl + paths ekle (root test dosyaları için)
[ ] 15. tsconfig.build.json uyumsuzluğunu çöz (.ts extension problemi)
[ ] 16. workflow-generator.js'i ESM'e çevir (require → import)
[ ] 17. Hata handling'i standartlaştır — ApiError sınıfı oluştur
```

---

### AŞAMA 5 — Temizlik & Bakım (Gün 6–7)

```
[ ] 18. Kullanılmayan import ve değişkenleri temizle (7+ script dosyası)
[ ] 19. Catch bloklarında kullanılmayan err → _err
[ ] 20. prefer-const ihlallerini düzelt
[ ] 21. hasOwnProperty → Object.hasOwn()
[ ] 22. Regex kaçış karakterlerini düzelt
[ ] 23. Naming convention'ları standartlaştır
```

---

## Özet Tablo

| Seviye | Sayı | Etki | İlk Gün Hedef |
|---|---|---|---|
| 🔴 Kritik | 3 | Derleme tamamen kırık | Tamamla |
| 🟠 Yüksek | 9 | Runtime crash / güvenlik riski | Tamamla |
| 🟡 Orta | 10 | Kalite & güvenilirlik | Gün 3–5 |
| 🔵 Düşük | 15+ | Teknik borç | Gün 6–7 |

**En hızlı kazanım:** `SharedMemory` method'larını eklemek — 8 TSC hatasını tek seferde kapatır ve tüm orchestration katmanının build'ini açar.
