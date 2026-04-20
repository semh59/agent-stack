# Sovereign — Arayüz Tasarım Planı

> Sovereign Software Factory · 18 Agent · 625 Skill · Tam Kontrol Merkezi

---

## 1. TASARIM FELSEFESİ

### Kimlik

Sovereign bir araç değil, bir **fabrika kontrol odası.** Tasarım bunu yansıtmalı.

Referans nokta: Endüstriyel kontrol panelleri, mission control ekranları, Bloomberg terminali.
**Değil:** Sıradan SaaS dashboard, yapay zeka chatbot arayüzü.

### Estetik Yön

- **Tema:** Koyu zemin, yüksek kontrast, net hiyerarşi. "Industrial precision."
- **Font:** Display → `Bebas Neue` veya `DM Mono` (başlıklar). Body → `JetBrains Mono` (kod ve veriler). UI labels → `IBM Plex Sans Condensed`.
- **Renk Paleti:**
  ```
  Arka plan:    #07080C  (neredeyse siyah, soğuk ton)
  Yüzey:        #0F1117
  Kenarlık:     #1C1E2A
  Kenarlık2:    #2A2D3E
  Ana metin:    #E2E4F0
  İkincil:      #7A7D94
  Vurgu:        #4F6EF7  (elektrik mavi — fabrika mavi)
  Başarı:       #3ECF8E
  Uyarı:        #F5A623
  Hata:         #EF4444
  Management:   #A78BFA  (mor)
  Design:       #22D3EE  (cyan)
  Development:  #4ADE80  (yeşil)
  Quality:      #FB923C  (turuncu)
  Output:       #818CF8  (indigo)
  ```
- **Animasyon:** Hızlı, amaçlı. Giriş 150ms ease-out. Spinner yerine progress bar. Akan veri için typing efekti.
- **Grid:** 8px base grid. Sol sidebar 260px sabit. İçerik fluid.

---

## 2. UYGULAMA YAPISI

### Teknoloji Önerisi

```
Framework:    React + TypeScript
Stil:         Tailwind CSS + CSS Variables
State:        Zustand (hafif, reaktif)
Realtime:     WebSocket (pipeline stream)
Grafikler:    Recharts
İkonlar:      Lucide React
Router:       React Router v6
```

### Ekran Haritası

```
/auth                    → Giriş (Google OAuth)
/dashboard               → Ana kontrol merkezi
/pipeline
  /pipeline/new          → Yeni pipeline başlat
  /pipeline/:id          → Canlı pipeline izleme
  /pipeline/history      → Geçmiş çalışmalar
/accounts                → Google hesap yönetimi
/skills                  → Skill merkezi (625 skill)
/workflows               → 14 workflow görüntüle/düzenle
/rules                   → MEMORY[user_global] kural editörü
/models                  → Model konfigürasyonu
/settings                → Genel ayarlar
```

---

## 3. EKRAN DETAYLARI

---

### 3.1 AUTH — Giriş Ekranı

**Amaç:** Google hesabıyla giriş. İlk hesap eklenir, sistem başlar.

**Layout:**

```
┌─────────────────────────────────────────────┐
│                                             │
│         [Sovereign wordmark — büyük]         │
│    "Sovereign Software Factory"             │
│                                             │
│    ┌───────────────────────────────────┐    │
│    │  [G] Google ile Giriş Yap        │    │
│    └───────────────────────────────────┘    │
│                                             │
│    İlk hesap fabrika hesabı olur.           │
│    Sonradan quota rotasyonu için            │
│    daha fazla hesap ekleyebilirsiniz.       │
│                                             │
│    [Hesap Yönetimine Git →]                 │
│                                             │
└─────────────────────────────────────────────┘
```

**Detaylar:**

- Arka planda çok yavaş hareket eden geometrik desen (CSS only, performans öncelikli)
- Google OAuth butonu standart Google tasarım kurallarına uygun (beyaz, G logosu)
- Giriş sonrası `/dashboard`'a yönlendirme
- Eğer hesap zaten ekli ise direkt dashboard açılır

---

### 3.2 DASHBOARD — Ana Kontrol Merkezi

**Amaç:** Tüm sistemin anlık durumu tek bakışta.

**Layout (4 bölge):**

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER: Sovereign logo | Aktif hesap | Quota bar | Ayarlar       │
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                       │
│ SIDEBAR  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐  │
│          │  │ AKTİF       │ │ TOPLAM      │ │ AKTİF SKİLL   │  │
│ Nav      │  │ PIPELINE    │ │ ÇALIŞMA     │ │               │  │
│ menüsü   │  │ Adım 7/18   │ │ 47 proje    │ │ 12 / 625      │  │
│          │  │ ████░░░ 38% │ │ Bu ay: 12   │ │ [Yönet →]     │  │
│ [Yeni    │  └─────────────┘ └─────────────┘ └───────────────┘  │
│ Pipeline]│                                                       │
│          │  ┌──────────────────────────────────────────────┐    │
│          │  │ AGENT TİMLİNE (canlı)                        │    │
│          │  │                                               │    │
│          │  │ ✅ CEO      ████████ 2m 14s                  │    │
│          │  │ ✅ PM       ████████████ 3m 42s               │    │
│          │  │ ✅ Architect ██████████████████ 5m 18s        │    │
│          │  │ ✅ UI/UX    ████████████ 3m 01s               │    │
│          │  │ 🔄 Database ████░░░░░░░░ çalışıyor...        │    │
│          │  │ ⏳ API Designer                               │    │
│          │  │ ⏳ Backend                                    │    │
│          │  │    ...                                        │    │
│          │  │ ⏳ DevOps                                     │    │
│          │  └──────────────────────────────────────────────┘    │
│          │                                                       │
│          │  ┌─────────────────────┐ ┌────────────────────────┐  │
│          │  │ HESAP DURUMU        │ │ KURAL & WORKFLOW        │  │
│          │  │ ● gmail1  87% dolu  │ │ 3 kural kategorisi ✅  │  │
│          │  │ ● gmail2  12% dolu  │ │ 14 workflow aktif ✅   │  │
│          │  │ ● gmail3  34% dolu  │ │ [Düzenle →]            │  │
│          │  │ [+Hesap Ekle]       │ │                        │  │
│          │  └─────────────────────┘ └────────────────────────┘  │
└──────────┴──────────────────────────────────────────────────────┘
```

**Önemli davranışlar:**

- Agent timeline gerçek zamanlı güncellenir (WebSocket)
- Aktif pipeline varsa timeline otomatik açık gelir
- Quota bar renk kodlu: yeşil < %60, sarı < %85, kırmızı > %85
- "Yeni Pipeline" butonu sidebar'da her zaman görünür, çarpıcı

---

### 3.3 PIPELINE/NEW — Yeni Pipeline Başlat

**Amaç:** Görevi yaz, parametreleri seç, fabrikayı çalıştır.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Geri   YENİ PIPELINE                              [Başlat →]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GÖREV TANIMI                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │  Ne inşa etmek istiyorsun?                              │    │
│  │                                                         │    │
│  │  [Textarea — geniş, 6 satır min]                        │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│  Örnek görevler: [Todo API] [Auth sistemi] [Dashboard UI]        │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  PLAN MODU                        MODEL SEÇİMİ                  │
│  ┌──────────────────────────┐     ┌──────────────────────────┐  │
│  │ ● Full (1-18 tüm ajanlar)│     │ Varsayılan (otomatik)    │  │
│  │ ○ Yönetim (CEO+PM+Arch.) │     │                          │  │
│  │ ○ Sadece Geliştirme      │     │ Planlama:  [Gemini Pro ▾]│  │
│  │ ○ Sadece QA              │     │ Kodlama:   [Sonnet    ▾] │  │
│  │ ○ Özel (ajan seç)        │     │ Tekrarlayan:[Flash   ▾]  │  │
│  └──────────────────────────┘     │ Güvenlik:  [Opus     ▾]  │  │
│                                   └──────────────────────────┘  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  ÖZEL AJAN SEÇİMİ  (Özel mod seçilince açılır)                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  [✅CEO] [✅PM] [✅Arch] [☐UI/UX] [✅DB] [☐API] ...     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  GELİŞMİŞ AYARLAR  [▾ Aç/Kapat]                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Skill Dizini: [.agents/skills/          ] [Gözat]      │    │
│  │  autoVerify:   [✅ Açık]                                 │    │
│  │  Max Loop/Ajan: [10              ]                       │    │
│  │  Timeout (sn):  [60              ]                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  TAHMINI SÜRE: ~18-35 dakika (Full mod, mevcut modellere göre)  │
│                                                                  │
│                              [İptal]  [Fabrikayı Başlat →]      │
└─────────────────────────────────────────────────────────────────┘
```

**Detaylar:**

- Örnek görev chips'leri tıklanınca textarea'ya yazılır
- Plan modu değişince "Tahmini Süre" güncellenir
- Özel mod seçilince ajan grid animasyonla açılır
- "Fabrikayı Başlat" → `/pipeline/:id`'ye yönlendirir ve pipeline başlar

---

### 3.4 PIPELINE/:ID — Canlı İzleme Ekranı

**En kritik ekran. Kullanıcının zamanının %80'ini burada geçirir.**

**Layout (3 sütun):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER: "Todo API" · Adım 7/18 · ████████░░ 38% · ⏱ 12:34 geçti    │
│ [Duraklat] [Atla] [İptal]                        [Hesap: gmail2 ▾]  │
├────────────┬────────────────────────────────────┬───────────────────┤
│            │                                    │                   │
│  AJAN      │  CANLI ÇIKTI                       │  DETAY PANELİ    │
│  PANELİ    │                                    │                   │
│            │  ┌──────────────────────────────┐  │  Aktif Ajan:      │
│ MGMT       │  │ ⚙️ Backend Developer          │  │  Backend Dev      │
│ ✅ CEO     │  │ ─────────────────────────── │  │                   │
│ ✅ PM      │  │ [Düşünüyor...]               │  │  Model:           │
│ ✅ Arch    │  │                               │  │  Claude Sonnet    │
│            │  │ package.json yazılıyor...    │  │                   │
│ DESIGN     │  │ src/routes/todo.ts yazılıyor │  │  Loop: 3/10       │
│ ✅ UI/UX   │  │ tsc --noEmit çalıştırılıyor  │  │  ████░░░░░░       │
│ ✅ DB      │  │ ✅ 0 hata                     │  │                   │
│ ✅ API     │  │ npm test çalıştırılıyor...   │  │  Tool Çağrıları:  │
│            │  │ ✅ 14/14 test geçti           │  │  📝 write_file 8x │
│ DEV        │  │                               │  │  ⚡ run_cmd 5x    │
│ 🔄 Backend │  │ > Artık auth entegrasyonuna  │  │  📖 read_file 3x  │
│ ⏳ Frontend│  │   geçiyorum...                │  │                   │
│ ⏳ Auth    │  │                               │  │  Oluşturulan:     │
│ ⏳ Integr. │  │                               │  │  📄 package.json  │
│            │  └──────────────────────────────┘  │  📄 src/app.ts    │
│ QUALITY    │                                    │  📄 src/routes/.. │
│ ⏳ Unit    │  TOOL OLAYI AKIŞI                  │  📄 ...7 dosya    │
│ ⏳ IntTest │  ┌──────────────────────────────┐  │                   │
│ ⏳ Sec     │  │ 📝 write_file src/app.ts ✅   │  │  Skill'ler:       │
│ ⏳ Perf    │  │ ⚡ tsc --noEmit ✅ 0 hata     │  │  ● backend-arch   │
│ ⏳ Review  │  │ 📝 write_file src/routes/... │  │  ● express-best   │
│            │  │ ⚡ npm test ✅ 14/14          │  │  ● error-handling │
│ OUTPUT     │  └──────────────────────────────┘  │                   │
│ ⏳ Docs    │                                    │  [Çıktıyı Gör ↗]  │
│ ⏳ Writer  │                                    │                   │
│ ⏳ DevOps  │                                    │                   │
│            │                                    │                   │
│ Toplam:    │                                    │                   │
│ ████░░ 6/18│                                    │                   │
└────────────┴────────────────────────────────────┴───────────────────┘
```

**Kritik davranışlar:**

_Sol panel (Ajan listesi):_

- Her katman renkli başlıkla ayrılır (Management: mor, Design: cyan vb.)
- Aktif ajan pulse animasyonlu
- Tamamlanan ajanlar tıklanabilir → sağ panelde o ajanın özeti açılır
- Progress bar pipeline ilerlemesini gösterir

_Orta panel (Canlı çıktı):_

- Streaming text — harfler tek tek gelir, typing efekti
- Tool olayları farklı renkte satırlar olarak araya girer
- Scroll kilidi: Yeni içerik gelince otomatik aşağı kaydır, kullanıcı scroll yaparsa kilit kaldırılır, "Sona git ↓" butonu çıkar
- Maksimum 2000 satır göster (eski satırlar yukarıdan silinir)

_Sağ panel (Detay):_

- Aktif ajan değişince animasyonla güncellenir
- Tıklanmış dosya adı → VS Code'da açar (veya modal'da gösterir)
- Skill listesi inject edilen skill'leri gösterir

_Header kontrolleri:_

- **Duraklat:** Anlık duraklatır, buton "Devam Et"e dönüşür
- **Atla:** "Bu ajanı atlamak istediğinize emin misiniz?" → Onayla
- **İptal:** "Pipeline iptal edilsin mi?" → Kırmızı uyarı → Onayla
- **Hesap:** Dropdown, o anda hangi Google hesabının kullanıldığı

---

### 3.5 PIPELINE/HISTORY — Geçmiş Çalışmalar

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ GEÇMİŞ PİPELINE'LAR                [Ara...] [Filtrele ▾]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ✅ Todo REST API           Full · 18/18   · 24m 12s      │    │
│  │    Dün 14:32 · claude-sonnet · 47 dosya  [Detay] [Tekrar]│   │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ❌ E-ticaret Backend       Full · 9/18   · 18m 03s       │    │
│  │    2 gün önce · Auth ajanında hata     [Detay] [Devam Et]│   │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ✅ Auth Sistemi            QA Only · 5/5  · 8m 41s       │    │
│  │    3 gün önce · gemini-pro · 12 test   [Detay] [Tekrar]  │   │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [Daha Fazla Yükle...]                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3.6 ACCOUNTS — Google Hesap Yönetimi

**Amaç:** Çoklu Google hesabı, quota takibi, rotasyon ayarları.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ HESAP YÖNETİMİ                              [+ Hesap Ekle]       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROTASYON STRATEJİSİ                                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ● Round Robin (sırayla)                                 │    │
│  │  ○ En Az Kullanılan                                      │    │
│  │  ○ Quota Eşiği (%80 dolunca geç)                         │    │
│  │  Eşik: [80]%  Gecikmesiz geçiş: [✅]                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  AKTİF HESAPLAR                                                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ● ANA  dev.gmail@gmail.com                                  │  │
│  │        Gemini Pro  ████████░░ 78% dolu  [3.2M / 4M token]  │  │
│  │        Claude      ██░░░░░░░░ 18% dolu  [180K / 1M token]  │  │
│  │        Son kullanım: 2 dakika önce                         │  │
│  │        [Test Et] [Devre Dışı] [Kaldır]                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ○      backup1@gmail.com                                    │  │
│  │        Gemini Pro  ███░░░░░░░ 32% dolu  [1.3M / 4M token]  │  │
│  │        Claude      ░░░░░░░░░░  4% dolu   [40K / 1M token]  │  │
│  │        Son kullanım: 1 saat önce                           │  │
│  │        [Test Et] [Devre Dışı] [Kaldır]                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ⚠️     backup2@gmail.com  — Yenileme gerekiyor              │  │
│  │        Token süresi dolmuş. [Yeniden Bağla]                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [+ Yeni Google Hesabı Ekle]                                     │
│   OAuth akışını başlatır, tarayıcıda giriş yap                  │
│                                                                  │
│  TOPLAM KAPASİTE                                                 │
│  Gemini Pro: ████████░░░░░░░░ 55% dolu (2 hesap ortalaması)     │
│  Claude:     ██░░░░░░░░░░░░░░ 11% dolu                          │
└─────────────────────────────────────────────────────────────────┘
```

**Hesap Ekle Akışı (Modal):**

```
1. [G] Google ile Bağlan → OAuth açılır
2. Giriş yapılır
3. "Hangi amaçla kullanılacak?"
   ● Yedek hesap (rotasyona dahil)
   ○ Sadece belirli modeller için
4. [Bağlantıyı Tamamla]
```

---

### 3.7 SKILLS — Skill Merkezi

**Amaç:** 625 skill'i görüntüle, aktif olanları yönet, yeni yükle, önerileri onayla.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ SKİLL MERKEZİ                                                    │
│ 12 aktif  ·  47 önerilen onay bekliyor  ·  625 global havuzda   │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                   │
│  SEKMELER    │                                                   │
│              │  [Ara skill...       ]  [Kategori ▾] [Sırala ▾]  │
│  ● Aktif(12) │                                                   │
│  ○ Önerilen  │  ┌──────────────────────────────────────────┐    │
│    (47)      │  │ 🔧 senior-architect                       │    │
│  ○ Global    │  │ Backend ve frontend mimarisi için...      │    │
│    Havuz     │  │ Boyut: 4.2KB · CEO, Architect tarafından │    │
│    (625)     │  │ [Görüntüle] [Devre Dışı]                 │    │
│  ○ Özel      │  └──────────────────────────────────────────┘    │
│    (.agents/ │                                                   │
│    skills/)  │  ┌──────────────────────────────────────────┐    │
│              │  │ ⚛️  react-best-practices                  │    │
│  KATEGORİLER │  │ React 18, hooks, performans...            │    │
│              │  │ Boyut: 6.1KB · Frontend tarafından       │    │
│  │ [Görüntüle] [Devre Dışı]                 │    │
│  ☑ Backend   │  └──────────────────────────────────────────┘    │
│  ☑ Frontend  │                                                   │
│  ☐ DevOps    │  ┌──────────────────────────────────────────┐    │
│  ☐ Database  │  │ 🔒 cc-skill-security-review               │    │
│  ☐ Testing   │  │ OWASP top 10, XSS, injection...           │    │
│  ...         │  │ Boyut: 8.3KB · Security tarafından       │    │
│              │  │ [Görüntüle] [Devre Dışı]                 │    │
│              │  └──────────────────────────────────────────┘    │
│              │                                                   │
└──────────────┴──────────────────────────────────────────────────┘
```

**Global Havuz Sekmesi:**

```
625 skill listelenmiş, arama ve filtre var
Her skill kartında: [Önizle] [Projeye Ekle]
"Projeye Ekle" → pipeline_install_skill çalışır
```

**Önerilen Sekmesi (47 onay bekleyen):**

```
┌──────────────────────────────────────────────────────┐
│ 💡 postgres-pagination                               │
│ AI tarafından önerilen · 3 gün önce                  │
│ Kaynak: lessons-learned.md                           │
│ "Pagination limit 200'ü aşan sorgularda N+1 sorunu   │
│  tespit edildi, çözüm kalıbı çıkarıldı."             │
│                                                      │
│ [Önizle ↗]    [Reddet]    [✅ Onayla ve Aktifleştir] │
└──────────────────────────────────────────────────────┘
```

**Skill Önizleme (Modal):**

```
┌──────────────────────────────────────────────────┐
│ senior-architect                     [×]          │
├──────────────────────────────────────────────────┤
│ SKILL.md içeriği — syntax highlighted            │
│                                                  │
│ Kullanan Ajanlar: CEO, Architect                 │
│ Son kullanım: 2 saatte 3 kez                     │
│ Ortalama token: ~1.2K                            │
└──────────────────────────────────────────────────┘
```

---

### 3.8 WORKFLOWS — İş Akışı Merkezi

**Amaç:** 14 workflow'u görüntüle ve düzenle.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ İŞ AKIŞLARI (14)                              [+ Yeni Workflow]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──┬────────────────────────────────┬──────────┬────────────┐  │
│  │# │ Workflow                        │ Kullanan │ Eylem      │  │
│  ├──┼────────────────────────────────┼──────────┼────────────┤  │
│  │1 │ /1_gereksinim_analizi          │ CEO, PM  │ [Gör][Düz] │  │
│  │2 │ /2_mimari_tasarim              │ Architect│ [Gör][Düz] │  │
│  │3 │ /3_veritabani_tasarimi         │ Database │ [Gör][Düz] │  │
│  │4 │ /4_api_sozlesmesi              │ API      │ [Gör][Düz] │  │
│  │5 │ /5_hata_ayiklama_oturumu       │ Hepsi    │ [Gör][Düz] │  │
│  │6 │ /6_test_stratejisi             │ QA       │ [Gör][Düz] │  │
│  │7 │ /7_guvenlik_denetimi           │ Security │ [Gör][Düz] │  │
│  │8 │ /8_performans_analizi          │ Perf.    │ [Gör][Düz] │  │
│  │9 │ /9_deployment                  │ DevOps   │ [Gör][Düz] │  │
│  │10│ /10_kod_inceleme               │ Review   │ [Gör][Düz] │  │
│  │11│ /11_dokumantasyon              │ Docs     │ [Gör][Düz] │  │
│  │12│ /12_self_healing               │ Hepsi    │ [Gör][Düz] │  │
│  │13│ /13_skill_olusturma            │ Generator│ [Gör][Düz] │  │
│  │14│ /14_proje_tamamlama            │ DevOps   │ [Gör][Düz] │  │
│  └──┴────────────────────────────────┴──────────┴────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Workflow Düzenleyici (tam sayfa editör):**

```
┌─────────────────────────────────────────────────────────────────┐
│ /5_hata_ayiklama_oturumu                   [Kaydet] [İptal]     │
├──────────────────────┬──────────────────────────────────────────┤
│  METADATA            │  MARKDOWN EDİTÖR                         │
│                      │                                          │
│  Kullanan Ajanlar:   │  # Hata Ayıklama Oturumu                │
│  [✅ Hepsi      ▾]   │                                          │
│                      │  ## Tetiklenme Koşulları                 │
│  Öncelik: [Normal▾]  │  - Bir komut non-zero exit kodu...      │
│                      │  ...                                     │
│  Son düzenleme:      │                                          │
│  2 gün önce          │  [Sol: Editor · Sağ: Önizleme]          │
└──────────────────────┴──────────────────────────────────────────┘
```

---

### 3.9 RULES — Kural Editörü (MEMORY[user_global])

**En kritik ekran. 18 ajanın üzerindeki mutlak otorite buradan yönetilir.**

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ GLOBAL KURALLAR — MEMORY[user_global]       [Kaydet] [Geçmiş]  │
│ ⚠️ Bu kurallar tüm 18 ajan tarafından mutlak otorite olarak     │
│    kabul edilir. Değişiklikler anında etki eder.                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 🏗️  MİMARİ STANDARTLAR                    [Düzenle]      │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ ✅  UnitOfWork Pattern zorunludur                  │  │   │
│  │  │      Tüm DB işlemleri UoW içinde yapılır           │  │   │
│  │  │      [Düzenle] [Devre Dışı]                        │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ ✅  Event-Driven İletişim                          │  │   │
│  │  │      Servisler arası direkt çağrı yasak            │  │   │
│  │  │      [Düzenle] [Devre Dışı]                        │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  [+ Kural Ekle]                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 🏢  DOMAIN KURALLARI                       [Düzenle]     │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  ✅  Tüm zamanlar UTC                                    │   │
│  │  ✅  AI Confidence < 0.60 → Uyarı ver                   │   │
│  │  ✅  Redis: GDPR kapsamı dışı veriler                   │   │
│  │  ✅  PostgreSQL: GDPR kapsamlı veriler                  │   │
│  │  ✅  Araç/Sürücü Event log statüleri tanımlı            │   │
│  │  [+ Kural Ekle]                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ⚙️  TEKNİK STANDARTLAR                     [Düzenle]     │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  ✅  Type hint ve docstring zorunlu                      │   │
│  │  ✅  Pagination max: 200 satır                           │   │
│  │  ✅  Virtualization: 200+ öğeli listeler için            │   │
│  │  [+ Kural Ekle]                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  KURAL GEÇMİŞİ                                                   │
│  [Pagination: 100→200 olarak değiştirildi · 3 gün önce]         │
│  [UTC kuralı eklendi · 1 hafta önce]                             │
└─────────────────────────────────────────────────────────────────┘
```

**Kural Düzenleme (Inline Editör):**

```
┌────────────────────────────────────────────────────────┐
│ ✏️  Kuralı Düzenle                                      │
│                                                        │
│  Başlık: [Pagination max limiti                     ]  │
│                                                        │
│  Açıklama:                                             │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Tüm liste endpoint'leri maksimum 200 öğe         │  │
│  │ döndürebilir. Bu sınır aşılamaz.                 │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Uygulanan Ajanlar: [Hepsi ▾]                          │
│  Önem: [Kritik ▾]                                      │
│                                                        │
│  [İptal]  [Kaydet]                                     │
└────────────────────────────────────────────────────────┘
```

---

### 3.10 MODELS — Model Konfigürasyonu

**Amaç:** Hangi agent hangi modeli kullanır, detaylı kontrol.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ MODEL KONFİGÜRASYONU                         [Varsayılana Dön]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GLOBAL VARSAYILAN                                               │
│  Planlama:    [Claude Opus 4.6        ▾]                        │
│  Kodlama:     [Claude Sonnet 4.6      ▾]                        │
│  Tekrarlayan: [Gemini 3 Flash         ▾]                        │
│  Güvenlik:    [Claude Opus 4.6        ▾]                        │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  AJAN BAZINDA OVERRIDE  [Tüm Overrideları Temizle]              │
│                                                                  │
│  ┌──────────────────────┬────────────────────┬────────────────┐  │
│  │ Ajan                 │ Varsayılan         │ Override       │  │
│  ├──────────────────────┼────────────────────┼────────────────┤  │
│  │ 🎯 CEO               │ Opus (plan)        │ [Değiştir ▾]  │  │
│  │ 📋 PM                │ Opus (plan)        │ [Değiştir ▾]  │  │
│  │ 🏗️ Architect         │ Opus (plan)        │ Gemini Pro ✏️  │  │
│  │ 🎨 UI/UX             │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  │ 🗄️ Database          │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  │ 🔌 API Designer      │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  │ ⚙️ Backend           │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  │ 🖥️ Frontend          │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  │ 🔐 Auth              │ Opus (güvenlik)    │ [Değiştir ▾]  │  │
│  │ 🔗 Integration       │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  │ 🧪 Unit Test         │ Flash (tekrar)     │ [Değiştir ▾]  │  │
│  │ 🔄 Integration Test  │ Flash (tekrar)     │ [Değiştir ▾]  │  │
│  │ 🛡️ Security          │ Opus (güvenlik)    │ [Değiştir ▾]  │  │
│  │ ⚡ Performance        │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  │ 👁️ Code Review       │ Opus (güvenlik)    │ [Değiştir ▾]  │  │
│  │ 📚 Docs              │ Flash (tekrar)     │ [Değiştir ▾]  │  │
│  │ 📝 Tech Writer       │ Flash (tekrar)     │ [Değiştir ▾]  │  │
│  │ 🚀 DevOps            │ Sonnet (kod)       │ [Değiştir ▾]  │  │
│  └──────────────────────┴────────────────────┴────────────────┘  │
│                                                                  │
│  MEVCUT MODELLER                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Claude Opus 4.6     · Sovereign AI · 200K context        │    │
│  │ Claude Sonnet 4.6   · Sovereign AI · 200K context        │    │
│  │ Gemini 3 Pro        · Sovereign AI · 1M context          │    │
│  │ Gemini 3 Flash      · Sovereign AI · 1M context · hızlı  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. GLOBAL COMPONENT KATALOĞU

### 4.1 Sidebar (Tüm ekranlarda sabit)

```
┌────────────────────┐
│ Sovereign     [≡]   │
│                    │
│ 🏠 Dashboard       │
│ ▶ Pipeline      ▸  │
│   + Yeni           │
│   📋 Geçmiş        │
│ 👥 Hesaplar        │
│ 🔧 Skill'ler       │
│ ⚡ Workflow'lar     │
│ 📐 Kurallar        │
│ 🤖 Modeller        │
│ ⚙️ Ayarlar         │
│                    │
│ ────────────────── │
│                    │
│ AKTİF PIPELINE     │
│ Todo API           │
│ ████░░ Adım 7/18   │
│ [Görüntüle →]      │
│                    │
│ ────────────────── │
│                    │
│ dev@gmail.com      │
│ Quota: 78% dolu    │
└────────────────────┘
```

### 4.2 Bildirim Sistemi

```
Sağ üst köşe, toast bildirimleri:

✅  "Backend agent tamamlandı" (3sn sonra kaybolur)
⚠️  "gmail1 quota 85% doldu, gmail2'ye geçildi"
❌  "Security agent hata verdi: [Detay →]"
💡  "3 yeni skill önerisi onay bekliyor"
```

### 4.3 Komut Paleti (Cmd+K)

```
┌─────────────────────────────────────────────┐
│ [Ne yapmak istiyorsun?               ]       │
├─────────────────────────────────────────────┤
│ ▶  Yeni Pipeline Başlat                      │
│ ⏸  Aktif Pipeline'ı Duraklat                 │
│ 🔧  Skill Yükle...                           │
│ 👥  Hesap Ekle                               │
│ 📐  Kural Ekle                               │
│ 📋  Son Pipeline'ı Görüntüle                 │
└─────────────────────────────────────────────┘
```

---

## 5. DURUM YÖNETIMI MİMARİSİ (Zustand)

```typescript
// Ana store yapısı

interface AppState {
  // Auth
  accounts: GoogleAccount[];
  activeAccount: string;
  quotaStatus: Record<string, QuotaInfo>;

  // Pipeline
  activePipeline: Pipeline | null;
  pipelineHistory: Pipeline[];
  streamBuffer: StreamEvent[];

  // Konfigürasyon
  modelConfig: ModelConfig;
  activeSkills: Skill[];
  pendingSkills: Skill[];
  workflows: Workflow[];
  rules: RuleCategory[];

  // UI
  sidebarOpen: boolean;
  activeNotifications: Notification[];
}
```

---

## 6. WEBSOCKET — CANLI VERİ AKIŞI

Pipeline ekranında gerçek zamanlı veri için WebSocket şarttır.

```typescript
// Event tipleri (sunucudan gelir)

type PipelineEvent =
  | { type: "agent_start"; role: AgentRole; name: string }
  | { type: "agent_chunk"; role: AgentRole; text: string }
  | { type: "tool_call"; tool: string; args: object }
  | { type: "tool_result"; success: boolean; output: string }
  | { type: "agent_loop"; loopNum: number }
  | { type: "agent_done"; duration: number; files: string[] }
  | { type: "account_switched"; from: string; to: string }
  | { type: "pipeline_complete"; summary: PipelineSummary }
  | { type: "pipeline_failed"; error: string };
```

---

## 7. UYGULAMA SIRASI

```
Faz 1 (MVP — 2 hafta):
  ✅ Auth ekranı (Google OAuth)
  ✅ Hesap yönetimi
  ✅ Pipeline başlatma (Yeni Pipeline ekranı)
  ✅ Canlı pipeline izleme (streaming)
  ✅ Pipeline geçmişi

Faz 2 (Kontrol — 1 hafta):
  ✅ Skill merkezi (aktif, önerilen, global)
  ✅ Model konfigürasyonu
  ✅ Dashboard metrikleri

Faz 3 (Tam Platform — 2 hafta):
  ✅ Workflow editörü
  ✅ Kural editörü (MEMORY[user_global])
  ✅ Komut paleti (Cmd+K)
  ✅ Bildirim sistemi
  ✅ Skill onay akışı
```

---

## 8. KILAVUZ: NE YAPTIRILIR

Bu plan bir geliştirici veya AI'ya şu şekilde verilir:

**Frontend geliştirici / VS Code Extension için:**
→ Bölüm 3 (ekran detayları) + Bölüm 4 (componentler) + Bölüm 5 (state)

**Backend / API için:**
→ Bölüm 6 (WebSocket event yapısı) + ekranlardaki data ihtiyaçları

**Uygulama sırası için:**
→ Bölüm 7 (3 faz)

**Tasarımcı için:**
→ Bölüm 1 (felsefe + renkler + fontlar) + tüm layout şemaları
