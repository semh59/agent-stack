# Plan 03 — Console React: %85 → %100

## Mevcut Durum
Build crash'i düzeltildi (ProjectsPage, BuilderPage oluşturuldu).
TypeScript strict hataları kapatıldı. Kalan: build doğrulaması ve
eksik UI bileşenleri.

## Kabul Kriterleri
```bash
cd interface/console
npm install
npm run build     # 0 hata, 0 warning (error seviyesi)
npm run lint      # 0 hata
```

---

## Görev 1 — Build doğrulaması

```bash
cd interface/console
npm run build 2>&1
```

**Hata çıkarsa şu kategorilere göre düzelt:**

### 1a. Eksik import
```
ERROR: Cannot find module './XyzPage'
```
→ `src/pages/` veya `src/components/` altında dosyayı oluştur (stub yeterli):
```tsx
// src/pages/XyzPage.tsx
export function XyzPage() {
  return <div>XyzPage — yapım aşamasında</div>;
}
```

### 1b. TypeScript hataları
`tsconfig.app.json`'da `"noUnusedLocals": false` ve
`"noUnusedParameters": false` zaten ayarlı.
Yine de hata çıkarsa → ilgili satırı düzelt.

### 1c. Vite chunk uyarıları
```
Some chunks are larger than 500 kB
```
→ Uyarı, hata değil. Geçebilir. İyileştirme için `vite.config.ts`'e ekle:
```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom'],
        zustand: ['zustand'],
      }
    }
  }
}
```

---

## Görev 2 — API servisleri tamamla

**Dosya:** `interface/console/src/services/projects-api.ts`

Dosya oluşturulduysa kontrol et — stub mu yoksa gerçek implementation mi?
```bash
cat interface/console/src/services/projects-api.ts
```

Stub'sa (`return []` gibi), gerçek gateway çağrısıyla doldur:
```typescript
import { apiClient } from '../utils/api';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  status: 'active' | 'archived';
}

export async function listProjects(): Promise<Project[]> {
  const res = await apiClient.get<Project[]>('/api/projects');
  return res.data;
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const res = await apiClient.post<Project>('/api/projects', { name, description });
  return res.data;
}

export async function deleteProject(id: string): Promise<void> {
  await apiClient.delete(`/api/projects/${id}`);
}
```

---

## Görev 3 — ProjectsPage gerçek veriyle çalışsın

**Dosya:** `interface/console/src/pages/ProjectsPage.tsx`

Mevcut dosyanın içeriğini kontrol et:
```bash
head -30 interface/console/src/pages/ProjectsPage.tsx
```

Sadece stub ise (static içerik), `projects-api.ts`'yi bağla:
```tsx
import React, { useEffect, useState } from 'react';
import { listProjects, createProject, type Project } from '../services/projects-api';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4">Yükleniyor...</div>;
  if (error)   return <div className="p-4 text-red-500">Hata: {error}</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Projeler</h1>
      {projects.length === 0 ? (
        <p className="text-gray-500">Henüz proje yok.</p>
      ) : (
        <ul className="space-y-2">
          {projects.map(p => (
            <li key={p.id} className="border rounded p-3">
              <span className="font-medium">{p.name}</span>
              {p.description && <p className="text-sm text-gray-600">{p.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

## Görev 4 — BuilderPage temel yapısı

**Dosya:** `interface/console/src/pages/BuilderPage.tsx`

Kontrol et, stub ise minimal fonksiyonel UI yap:
```tsx
import React, { useState } from 'react';

export function BuilderPage() {
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const handleStart = () => {
    if (!prompt.trim()) return;
    setIsRunning(true);
    // TODO: gateway'e mission başlatma isteği gönder
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2">Proje Oluşturucu</h1>
      <p className="text-gray-500 mb-4">
        Ne yapmak istediğinizi açıklayın, Alloy adımlara böler.
      </p>
      <textarea
        className="w-full border rounded p-3 h-32 resize-none"
        placeholder="Örn: Kullanıcı kaydı olan bir blog uygulaması yap"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        disabled={isRunning}
      />
      <button
        className="mt-3 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        onClick={handleStart}
        disabled={isRunning || !prompt.trim()}
      >
        {isRunning ? 'Çalışıyor...' : 'Başlat'}
      </button>
    </div>
  );
}
```

---

## Görev 5 — useEffectiveSettings hook eksik kontrol

**Dosya:** `interface/console/src/pages/alloy/settings/useEffectiveSettings.ts`

Kontrol et:
```bash
cat interface/console/src/pages/alloy/settings/useEffectiveSettings.ts
```

Export ettiği tipe bak ve Settings pages'lerde doğru kullanıldığından
emin ol.

---

## Görev 6 — Lint kontrolü

```bash
cd interface/console
npm run lint 2>&1 | grep -v "^$"
```

`error` satırları varsa düzelt. `warning` kabul edilebilir.

---

## Son Kontrol Listesi
- [ ] `npm run build` → hata yok
- [ ] `npm run lint` → error yok
- [ ] `ProjectsPage` gerçek API'ye bağlı
- [ ] `BuilderPage` fonksiyonel stub (crash yok)
- [ ] Tüm sayfalar `App.tsx`'te doğru route edilmiş
