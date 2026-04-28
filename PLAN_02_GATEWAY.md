# Plan 02 — Gateway TypeScript: %80 → %100

## Mevcut Durum
Temel buglar düzeltildi (saveWorkflow, FSTWRN004, start-gateway, typo).
Kalan: model-selector kota awareness, reasoning placeholder, tsc+test doğrulaması.

## Kabul Kriterleri
```bash
cd core/gateway
npx tsc --noEmit         # 0 hata
npm test                 # tüm testler geçiyor
```

---

## Görev 1 — ModelSelector: budget/quota awareness ekle

**Dosya:** `core/gateway/src/orchestration/model-selector.ts`

**Sorun:** `selectModel()` sadece task tipine bakıyor, kullanıcı
bütçesine/kotasına bakmıyor. Pahalı modeller (Opus) her zaman seçilip
bütçeyi tüketebilir.

**Düzeltme:** `BudgetContext` parametresi ekle:

```typescript
// core/gateway/src/orchestration/model-selector.ts — TAMAMEN YENIDEN YAZ

export enum ModelTier {
  OPUS        = 'google/Alloy-claude-opus-4-6-thinking',
  SONNET      = 'google/Alloy-claude-sonnet-4-6',
  GEMINI_PRO  = 'google/Alloy-gemini-3-pro',
  GEMINI_FLASH = 'google/Alloy-gemini-3-flash',
}

export type TaskType = 'planning' | 'development' | 'operation' | 'qa' | 'research' | 'security';

export interface BudgetContext {
  /** Kalan bütçe — USD cinsinden. undefined = sınırsız */
  remainingBudgetUsd?: number;
  /** Token kotası kullanım oranı 0-1. 0.9 = %90 dolu */
  quotaUsageRatio?: number;
}

/**
 * Bütçe/kota durumuna göre model tier kısıtı uygular.
 * Düşük bütçe/yüksek kota → pahalı modelleri devre dışı bırakır.
 */
function applyBudgetConstraint(preferred: ModelTier, ctx: BudgetContext): ModelTier {
  const lowBudget  = ctx.remainingBudgetUsd !== undefined && ctx.remainingBudgetUsd < 0.10;
  const highQuota  = ctx.quotaUsageRatio !== undefined && ctx.quotaUsageRatio > 0.85;

  if (!lowBudget && !highQuota) return preferred;

  // Bütçe/kota kısıtı varsa pahalı modellerden ucuza düş
  if (preferred === ModelTier.OPUS)       return ModelTier.SONNET;
  if (preferred === ModelTier.GEMINI_PRO) return ModelTier.GEMINI_FLASH;
  return preferred;
}

export class ModelSelector {
  public selectModel(
    taskType: TaskType,
    complexity: 'low' | 'medium' | 'high' = 'medium',
    budget: BudgetContext = {}
  ): ModelTier {
    let preferred: ModelTier;

    if (taskType === 'security') {
      preferred = ModelTier.OPUS;
    } else if (taskType === 'planning' || (taskType === 'research' && complexity === 'high')) {
      preferred = ModelTier.GEMINI_PRO;
    } else if (taskType === 'development' || taskType === 'qa') {
      preferred = ModelTier.SONNET;
    } else if (taskType === 'operation' || complexity === 'low') {
      preferred = ModelTier.GEMINI_FLASH;
    } else {
      preferred = ModelTier.SONNET;
    }

    return applyBudgetConstraint(preferred, budget);
  }

  public getModelReasoning(tier: ModelTier): string {
    switch (tier) {
      case ModelTier.OPUS:
        return 'Deep reasoning with thinking — for architectural decisions and security audits.';
      case ModelTier.SONNET:
        return 'Balanced performance for coding, refactoring, and structural analysis.';
      case ModelTier.GEMINI_PRO:
        return 'Wide context window (1M tokens) for planning and research tasks.';
      case ModelTier.GEMINI_FLASH:
        return 'Fast and cost-effective for documentation and repetitive tasks.';
    }
  }
}
```

**Test güncelle:** `core/gateway/src/orchestration/autonomy-model-router.test.ts` veya
`model-selector.test.ts` varsa yeni imzayla çalışacak şekilde güncelle.

---

## Görev 2 — sequential-pipeline.ts: reasoning placeholder kaldır

**Dosya:** `core/gateway/src/orchestration/sequential-pipeline.ts`
**Satır:** ~455

**Sorun:** Shadow validator `reasoning` argümanına sabit string geçiliyor.

```typescript
// ÖNCE:
const semanticViolation = await this.autonomyPolicy.verifySemanticIntent(
  'Reasoning extraction placeholder',   // ← sabit string
  prompt.slice(0, 500) + `\n\n[RECENT_HISTORY]\n${recentHistory}`,
  userTask,
  shadowValidator
);

// SONRA — agent context'inden reasoning extract et:
const agentReasoning = [
  `Agent: ${agent.role}`,
  `Layer: ${agent.layer}`,
  `Preferred model: ${agent.preferredModel}`,
  `Output files: ${agent.outputFiles.join(', ')}`,
  `Estimated minutes: ${agent.estimatedMinutes}`,
].join('\n');

const semanticViolation = await this.autonomyPolicy.verifySemanticIntent(
  agentReasoning,
  prompt.slice(0, 500) + `\n\n[RECENT_HISTORY]\n${recentHistory}`,
  userTask,
  shadowValidator
);
```

---

## Görev 3 — ALLOY_PREVIEW_LINK TODO çözümle

**Dosya:** `core/gateway/src/plugin/request-helpers.ts` — satır 13:

```typescript
// ÖNCE:
const ALLOY_PREVIEW_LINK = "https://goo.gle/enable-preview-features"; // TODO: Update to Alloy link if available

// SONRA:
const ALLOY_PREVIEW_LINK = "https://docs.alloy.dev/preview-features";
```

---

## Görev 4 — tsc --noEmit doğrulaması

```bash
cd core/gateway
npx tsc --noEmit 2>&1
```

**0 hata olmalı.** Hata çıkarsa:

- `TS2322` (tip uyumsuzluğu) → ilgili satırı düzelt
- `TS2304` (bulunamayan isim) → import eksikliği
- `TS6133` (kullanılmayan değişken) → `tsconfig.json`'da
  `"noUnusedLocals": false` zaten ayarlı olmalı

---

## Görev 5 — Test suite çalıştır

```bash
cd core/gateway
npm test 2>&1 | tail -30
```

Başarısız testleri düzelt. Öncelik sırası:
1. `orchestration/` altındaki testler (iş mantığı)
2. `gateway/` altındaki testler (HTTP katmanı)
3. `plugin/` testleri

---

## Son Kontrol Listesi
- [ ] `npx tsc --noEmit` → 0 hata
- [ ] `npm test` → 0 failure
- [ ] ModelSelector budget-aware
- [ ] Reasoning placeholder kaldırıldı
