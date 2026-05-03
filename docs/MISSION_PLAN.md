# Alloy — Vizyon ve Yol Haritası

> **Misyon:** Kod bilmeyen, teknik dili bilmeyen, parası olmayan ama fikri olan insanlara Alloy'un fayda sağlaması. Başka bir derdimiz yok.
>
> **İlkeler:**
> - Para alınmaz. Plan yok, seat yok, abonelik yok.
> - Herkes kendi anahtarını getirir (BYOK). Tüm provider'larda ücretsiz tier var; biz onları kullanıcıya ulaştırırız.
> - Teknik jargon yasak. UI'da "endpoint", "token", "regex" gibi kelimeler birinci sınıfta görünmez.
> - Açık kaynak. Self-host bir tıkta. Topluluk hosted instance ücretsiz.
> - Veri kullanıcının. Hiçbir şey kayıt altına alınıp satılmaz.
>
> Bu doküman zaman vermeden, bölüm bölüm derinlemesine, madde madde yapılması gerekenleri sıralar.

---

## 1. Hedef Kitle ve Onların Sorunları

### 1.1 Kim?

- Fikri olan ama yazılım bilmeyen yetişkinler (öğretmen, fizyoterapist, mühendis-ama-yazılımcı-değil, küçük işletme sahibi, esnaf, öğrenci, sosyal girişimci).
- Türkçe ana dil. Bilgisayara orta düzey hâkim, terminale değil.
- Bütçesi yok; "ücretsiz" ve "kendi anahtarımı getirebilirim" dışında bir şey kabul edilebilir değil.

### 1.2 Hangi sorunları çözüyoruz?

- **"Fikrim var, nasıl başlayacağımı bilmiyorum."** → Discovery agent: kısa, net, jargonsuz sorular sorarak fikri netleştirir.
- **"Yapay zekâya ne soracağımı bilmiyorum."** → Spec generator: fikri teknik şartnameye çevirir, kullanıcı yine düz Türkçe görür.
- **"Yapay zekânın çıktısını anlamıyorum."** → Decomposer + checkpoint: her adım küçük, anlaşılır, "ne yapıldı / neden / şimdi nereye?" sorularına cevap.
- **"Kuracağım yazılımı çalıştıramıyorum."** → One-click run: Alloy çıktıyı hazır çalışan bir hâle getirir; URL veya lokal bir uygulama olarak teslim eder.
- **"Hata aldım, ne yapacağım?"** → Self-healing loop: hata mesajı geldiğinde Alloy onu yorumlar, alternatif çözer, kullanıcı düz Türkçe görür.
- **"Anahtar nedir, nasıl alırım?"** → Anahtar yardımcısı: ücretsiz tier'lı her provider için adım adım rehber + ekran görüntüsü + "test connection" butonu.

### 1.3 Hedef olmayan kullanıcı (kimi sevindirmeyeceğiz)

- Profesyonel yazılımcı; Cursor/Cline yeterli onlara.
- Kurumsal müşteri (SSO/SAML/SOC2 isteyen); bu plan onlarla ilgilenmiyor.
- Para ödemek isteyen kullanıcı; ücretsiz olduğu için zaten avantajlı.

---

## 2. Ürün Felsefesi (Tasarım Anayasası)

Bu ilkeler tüm sonraki kararları biçimlendirir. Bir tasarım veya teknik karar bu ilkelerle çelişiyorsa karar yanlış.

- **İlke 1 — Sıfır maliyet, sıfır lock-in.** Kullanıcı istediği an verisini alıp gidebilmeli. Public instance'tan self-host'a geçiş tek dosyalık export/import.
- **İlke 2 — Anahtar kullanıcının cebinde.** Anahtarlar Alloy'un sunucusuna kalıcı yazılmaz; oturum süresince şifreli tutulur, kullanıcı çıkınca silinir (ya da kullanıcı "beni hatırla"yı seçerse şifrelenip kullanıcının tarayıcısında yaşar).
- **İlke 3 — Bilmediğini sor, bildiğini söyleme.** Alloy belirsizlikte tahmin etmez, kullanıcıya tek cümlelik soru sorar. Kullanıcı bilmiyorsa "bilmiyorum" + "atla" seçenekleri var.
- **İlke 4 — Düz Türkçe.** Tüm UI metinleri 8. sınıf okuma seviyesi. Teknik kelime geçtiğinde mouse-over kutusunda Türkçe açıklaması var.
- **İlke 5 — Geri alınabilirlik.** Her adım checkpoint'lenir. Kullanıcı 6 adım önceye dönebilir.
- **İlke 6 — Görünür ilerleme.** "Şu an ne oluyor, neden, ne kadar sürer, hata olursa ne yaparız" her zaman ekranda.
- **İlke 7 — Ücretsiz default.** Kurulumda öneri sırası: Ollama (lokal) → Groq (ücretsiz) → Cerebras (ücretsiz) → Gemini Flash (ücretsiz) → Mistral (ücretsiz). Ücretli provider'lar opsiyonel.

---

## 3. Kapsam Düzeltmesi (Eski Planlardan Çıkarılanlar)

`PLATFORM_PLAN.md`, `SAAS_READINESS.md`, `PROD_LAUNCH_PLAN.md` dokümanlarındaki şu kapsam **devre dışı**:

- Stripe, Customer Portal, plans, subscriptions, invoices, usage_events, entitlements, hard-billing-limit. → Tamamen sil.
- Seat-based / per-user pricing, free/pro/team/enterprise tier'ları. → Yok.
- SSO (SAML), SCIM, enterprise contract, DPA, sub-processor list. → Yok.
- Multi-region, VPC peering, dedicated support tier. → Yok.
- Marketing'de "pricing" sayfası. → Yok; yerine "Nasıl ücretsiz başlarım?" sayfası.
- Müşteri başına markup'lı API key servisi. → Yok; tek mod BYOK.

Eski planlardaki şu kapsam **devam ediyor ama uyarlanıyor**:

- Multi-tenancy: gerekli değil çünkü her kullanıcının verisi onun. Ama **per-user izolasyon** lazım: aynı public instance'ta iki kullanıcı birbirinin verisini görmemeli.
- Kimlik: signup/signin var ama RBAC, org, invitation yok. Tek seviye: kullanıcı ya kendi.
- Build kırığı, AUDIT.md hataları: hâlâ kapatılmalı.
- Persistence: SQLite + dosya yeterli; Postgres/Redis zorunlu değil. Public instance ölçeklenirse PG'ye geçilebilir, ama lansman için gereksiz.

**Eski planda yanlışlıkla çıkarılmış olan ve geri eklenen** (önceki revizyonun düzeltmesi):

- **Orkestra (20-ajanlı yazılım şirketi simülasyonu)** — `core/gateway/src/orchestration/agents.ts` zaten yazılmış durumda. Misyonun kalbi: kullanıcının fikri büyüdükçe Alloy'un içindeki "şirket" büyüyor. Çıkarılmıyor; **uyarlanıyor**: fikre göre adaptif olarak küçülüp büyüyor (§7.6).
- **Google Antigravity multi-account rotation** — `core/gateway/src/google-gemini/oauth.ts` + `core/gateway/src/plugin/accounts.ts`. Birden çok Google hesabı bağlanır, kotalarını birleştirir, dolan hesabı cooldown'a alır, otomatik rotate eder. Bu özellik "parası olmayan kullanıcının çok daha uzun ücretsiz çalışabilmesi"nin en kritik mekanizması. Aşağıda derinleştirildi (§6.4).
- **Quota + rate-limit altyapısı** — `core/gateway/src/plugin/quota.ts`, `core/gateway/src/plugin/model-specific-quota.ts`, `core/gateway/src/plugin/quota-fallback.test.ts`, `core/gateway/src/plugin/recovery/`. Ücretsiz kullanım için zorunlu; çıkarmıyoruz.
- **`accounts.router.ts`** — multi-account API'ı; kullanıcı yüzünde "hesap havuzu" UI'sının backend'i. Çıkarmıyoruz, basitleştiriyoruz (kurum/team yok, sadece tek kullanıcının çoklu hesabı).

---

## 4. Mimari Yeniden Düzenleme

### 4.1 Korunan parçalar

- Gateway (TS Fastify) — yönlendirme + auth + chat akışı.
- Bridge (Python) — discovery agent, spec generator, decomposer, optimization pipeline.
- Console (React) — kullanıcı yüzü.
- Extension (VS Code) — opsiyonel, hedef kitlemiz için ikinci sınıf vatandaş.

### 4.2 Yeni gerekenler

- **"Studio" yüzü.** Console'un içinde ama farklı bir mod: kod editörü/dosya ağacı yok; bunun yerine "Ne yapmak istiyorsun?" + akış + sonuç ekranı.
- **Workspace** kavramı. Kullanıcının her fikri bir workspace. İçinde discovery context, spec, mission timeline, üretilen artefaktlar (kod, yazı, görsel) var.
- **Artefakt klasörü.** Üretilen dosyalar workspace içinde gerçek dosya yapısında durur; kullanıcı zip indirir veya tek tıkla self-host'a deploy eder.
- **Anahtar kasası (vault).** Provider anahtarları kullanıcının tarayıcısında AES-256 ile şifrelenip IndexedDB'de yaşar. Sunucu sadece geçici proxy. (İstisna: OAuth tabanlı Google hesapları — refresh token sunucuda saklanması gerekiyor; bu kısım §6.4'te ayrı ele alınıyor.)
- **Lokal mod.** Tüm Alloy'u kullanıcının kendi makinesinde tek komutla çalıştıran "alloy-desktop" — Tauri ile (Electron'dan daha hafif).
- **Adaptif orkestra.** 20-ajanlı yazılım şirketi simülasyonu (`agents.ts`); fikrin büyüklüğüne göre 4-ajanlı XS modundan 20-ajanlı XL moduna kadar otomatik ölçeklenir (§7.6).
- **Hesap havuzu.** Birden çok Google Antigravity hesabı bağlanır, kotaları birleştirilir, otomatik rotate edilir, cooldown yönetilir (§6.4).

### 4.3 Çıkarılanlar

- `core/gateway/src/services/settings/` içindeki **kullanıcının kendi anahtarları için** master-key + secret encryption sistemi → tarayıcı-cebimde sistemine değişir. (Sunucu-tarafı OAuth refresh token'ları ayrı, hâlâ şifreli sunucuda; §6.4.)
- `infra/terraform/envs/production/` ECS multi-task setup → "tek instance free tier deployment" pattern'ine indirgenir veya komple kaldırılır (community kendi self-host'unu yapar).
- Mission "approval gates" — non-tech kullanıcı için aksıyor; "otomatik ilerle, sadece yıkıcı eylemde dur" varsayılana çevrilir.

**Çıkarılmayan (önceki revizyondaki yanlış kararın geri alınması):**

- `quota.ts`, `model-specific-quota.ts`, `rate-limit-state.ts`, `quota-fallback.test.ts` → bunlar BYOK kullanıcısının kendi kotasını yönetmek **değil**, **multi-account rotation**'ın altyapısı. Hesap havuzunda doluyu tespit edip yedeğe geçmek için zorunlu. Korunur, basitleştirilir (organizasyon/team kavramı yok, tek kullanıcının çoklu hesabı).
- `core/gateway/src/api/routers/accounts.router.ts` → korunur, basitleştirilir. `accountManager.getAccountsSnapshot()`, `setActiveAccountByEmail()`, hesap silme gibi temel API'lar duracak.
- `core/gateway/src/plugin/accounts.ts`, `rotation.ts`, `fingerprint.ts`, `refresh-queue.ts`, `recovery/` → tamamı korunur. Bunlar Google OAuth multi-account sisteminin kalbi.
- `core/gateway/src/google-gemini/oauth.ts` (PKCE, state manager, Antigravity OAuth) → korunur.

---

## 5. Kullanıcı Yolculuğu (Sıfırdan Çalışan Yazılıma)

Her madde bir UX adımı. Sıralı.

1. Kullanıcı `alloy.ai` (veya kendi self-host URL'si) açar. Tek bir kutu görür: **"Bir fikrin mi var? Yaz."** Altında 6 örnek fikir butonu (öğrenci yoklama uygulaması, mahalle dayanışma sitesi, sınav hazırlık botu, esnaf stok takibi, kişisel günlük, tarif kitabı).
2. Kullanıcı yazar veya örneği seçer. Henüz hesap yok.
3. Alloy yanıt verir: "Hiç giriş yapmana gerek yok ama kaydet istersen sonra dönmek için bir e-posta yeter." E-posta ile magic link (parola yok).
4. Kullanıcı isterse e-postasını yazar; istemezse "şimdi başla" der ve oturum tarayıcı kapanana kadar sürer.
5. **Anahtar adımı.** Alloy "Bunu yapmak için bir yapay zekâ motoruna bağlanmamız lazım. Ücretsiz seçenekler var. Hangisini istersin?" diye sorar. Üç ücretsiz seçenek + "Ollama'm var" + "anahtarım hazır":
   - **Groq (önerilen)** — "1 dakikada ücretsiz alırsın, 14400 istek/gün."
   - **Cerebras** — "1 milyon token/gün ücretsiz."
   - **Gemini** — "Google hesabı yeterli."
   - **Ollama** — "Bilgisayarına kurulu mu? Kontrol edelim."
   - **Hazır anahtar** — yapıştır.
6. Seçilen provider için Alloy adım adım rehber gösterir (ekran görüntüsü + "şu butona tıkla" + "şu metni kopyala"). Kullanıcı anahtarı yapıştırır. Test connection butonu yeşilse devam.
7. **Discovery turu.** Alloy 1-3 kısa soru sorar:
   - "Bunu kimler kullanacak?"
   - "En önemli özellik ne?"
   - "Var olan benzer bir uygulamayı görüyor musun? URL veya isim ver."
   Kullanıcı "bilmiyorum" / "atla" seçeneklerini her sorudan kullanabilir.
8. **Spec ekranı.** Alloy "Anladığım kadarıyla şunu yapacağız" diye düz Türkçe spec gösterir. Kullanıcı "evet" / "şunu değiştir" / "yeniden anlat" der.
9. **Onay.** "Hazır. Şimdi yapacağım: 1) tasarım, 2) kod, 3) çalışan link. Adım adım önüne getireceğim. Başlayalım mı?" → Başla.
10. **Mission timeline.** Sol sütunda adımlar (Tasarım → Kod → Test → Çalıştır), sağ sütunda canlı çıktı. Her adımda: ne yapılıyor, hangi modeli kullanıyor, ne kadar token harcandı.
11. **Hata olursa.** Alloy hatayı yorumlar: "Şu an X dosyasında Y satırında Z yazıyor; muhtemelen şundan oldu. Otomatik düzeltmeyi deneyebilirim, sen de elle düzeltebilirsin, atlayabiliriz de." Üç buton.
12. **Bitiş.** "Hazır! Şu adresten görebilirsin: [link]. Bilgisayarına indirmek istersen: [zip]. Değişiklik istersen: [Devam et]."
13. **Kaydet & paylaş.** Workspace'i kaydet (e-posta tetikli) veya kamuya açık şablon olarak yayınla (kullanıcı isterse).
14. **Geri dönüş.** Kullanıcı yarın tekrar girer; workspace listesinde fikri durur. "Devam et" → kaldığı yerden.

---

## 6. Onboarding ve Anahtar Yardımcısı (Kritik Bölüm)

Kullanıcının ilk 3 dakikası ürünü kazandırır veya kaybettirir. Bu yüzden ayrı bölüm.

### 6.1 Anahtar yardımcısı (`key-helper`)

- `core/gateway/src/services/key-helper/` altında her provider için bir modül.
- Her modülde:
  - Sağlayıcının ücretsiz tier limitleri (insan dilinde).
  - Adım adım rehber: Türkçe paragraf + sıralı ekran görüntüleri (8-12 görüntü, public CDN'de versionlı).
  - "Anahtarı al" butonu → provider'ın signup URL'si yeni sekmede.
  - "Yapıştır" alanı → submit'te `POST /api/keys/test` ile test bağlantı.
  - Hata varsa: "Anahtar geçersiz görünüyor. Şu nedenlerden olabilir: ..." (yaygın sebep listesi).
- Provider listesi (`PLAN_06_INFRA.md`'deki 14 sağlayıcının non-tech açısından sıralanmış hâli):
  1. Ollama (sıfır anahtar, lokal — en kolay).
  2. Groq (ücretsiz, en hızlı).
  3. Cerebras (ücretsiz, çok büyük model).
  4. Gemini (ücretsiz).
  5. Mistral (ücretsiz tier).
  6. SambaNova (ücretsiz).
  7. OpenRouter (~30 ücretsiz model + ücretliler).
  8. DeepSeek (ucuz).
  9. Together AI.
  10. Fireworks AI.
  11. Anthropic Claude (ücretli).
  12. OpenAI GPT (ücretli).
  13. Azure OpenAI (kurumsal).
  14. LM Studio (lokal alternatif).

### 6.2 Anahtar saklama

- **İlke:** Anahtar kullanıcının tarayıcısında, hiçbir zaman sunucu DB'sinde değil.
- Implementation:
  - Tarayıcıda Web Crypto API ile generate edilen master key (kullanıcı parolasından PBKDF2 ile türetilir veya parola yoksa rastgele + IndexedDB'de tutulur).
  - Provider anahtarları AES-GCM ile şifrelenir, IndexedDB'ye yazılır.
  - LLM çağrısı yapılırken anahtar request body'sinde gateway'e geçer; gateway provider'a iletir, **logla­maz**, response'tan sonra bellekten silinir.
  - "Beni hatırlama" seçilmezse oturum kapanınca IndexedDB temizlenir.
- Self-host için ek opsiyon: server-side `.env` (geliştirici/teknik kullanıcı için).

### 6.3 İlk-çalıştırma sihirbazı (wizard)

- 4 adım: provider seç → anahtar yapıştır → test bağlantı → "merhaba dünya" çağrısı.
- Her adım tek ekran. Geri butonu var. "Atla" yok (anahtar olmadan ilerlenmez).
- Wizard'ın sonunda "İlk fikrini yaz" ekranı (5. bölüm).
- Google Antigravity seçildiyse wizard sonunda **"Birden çok Google hesabın var mı? Hepsini bağla, kotalarını birleştirelim."** ekranı (§6.4).

### 6.4 Hesap Havuzu — Google Antigravity Multi-Account (Ücretsizliğin Anahtarı)

Bu özellik kodda zaten var (`core/gateway/src/plugin/accounts.ts`, `oauth.ts`, `rotation.ts`). Misyon bağlamında non-tech kullanıcı için derinleştirilmesi gereken konular:

#### 6.4.1 Niye önemli

- Google Antigravity / Gemini CLI ücretsiz tier'ı cömerttir ama tek hesapta limitlidir.
- Kullanıcının 2-5 Google hesabı varsa (kişisel, işyeri eski, eşin/çocuğun, atılmış lise hesabı) → kotalar toplanır.
- Bir hesap dolduğunda otomatik olarak diğerine geçilir; kullanıcı arada bir kesinti hissetmez.
- Bu Alloy'un "parası olmayana fayda" misyonunun en somut teknik karşılığı.

#### 6.4.2 Mevcut altyapı (korunan)

- **PKCE OAuth flow** — `oauth.ts` PKCEStateManager sunucu-tarafı state, replay koruması, 10 dk TTL.
- **AccountManager** — hesap havuzu, "hangisi aktif", "kim cooldown'da", quota cache.
- **Rotation strategy** — `rotation.ts` "hybrid" stratejisi (token tracker + health tracker birlikte).
- **Cooldown sebepleri** — `QUOTA_EXHAUSTED` (60 sn → 5 dk → 30 dk → 2 saat artan backoff), `RATE_LIMIT_EXCEEDED` (30 sn), `MODEL_CAPACITY_EXHAUSTED` (45 sn ± 15 sn jitter), `SERVER_ERROR` (20 sn), `UNKNOWN` (60 sn).
- **Per-account fingerprint** — her hesap için ayrı user-agent + headers, abuse detection'a takılmamak için.
- **Refresh queue** — token expire olduğunda kuyrukta refresh, race önleme.
- **Disk persistence** — `saveToDisk()` / `loadAccounts()`, hesap havuzu local SQLite veya JSON'da.

#### 6.4.3 Non-tech kullanıcı için eklemeler (yeni)

- **"Hesap ekle" butonu Studio yan panelinde sürekli görünür.** Tek tıkla yeni Google OAuth flow.
- **Hesap havuzu görselleştirme:**
  - Her hesap kartında: e-posta, doluluk göstergesi (kullanılan/toplam quota), aktif/cooldown rozeti, kalan cooldown geri sayımı.
  - "Şu an bunu kullanıyoruz" sarı çerçeve.
  - Yıldırım ikonu = en boş hesap.
- **Otomatik geçiş bildirimi:** "Hesap A doldu, Hesap B'ye geçtim, devam ediyorum" — toast (3 sn).
- **"Hesabımı çıkar"** butonu her kartta. Onay diyaloğu.
- **Toplu kota grafiği:** günlük + haftalık birleşik kullanım. "Bu hafta toplam X token kullandın, ücretsiz limit Y."
- **Akıllı uyarı:** Tüm hesaplar cooldown'da olursa kullanıcıya "Şu an tüm Google hesapların kotası dolu. 14 dk sonra Hesap A açılacak. Bu arada Groq veya Cerebras ekleyebilirsin." önerisi.
- **Provider mix.** Sadece Google değil; Groq + Cerebras + Gemini hesapları aynı havuzda. AccountManager bunu zaten destekliyor (`HeaderStyle`, `ModelFamily`).

#### 6.4.4 Düz Türkçe karşılıklar (UI metni)

- "Account" → "hesap"
- "Quota" → "günlük hak"
- "Cooldown" → "dinleniyor"
- "Token" → "kelime parçası" (mouseover)
- "Rate limit exceeded" → "şu an çok hızlı kullanıyoruz, hesap yorgun"
- "Refresh token" → arka planda; kullanıcı görmez
- "PKCE" → arka planda; kullanıcı görmez

#### 6.4.5 Güvenlik notları

- OAuth refresh token'ları **sunucuda** AES-256 ile şifrelenip saklanır (tarayıcıda saklamak güvenlik açığı; refresh token uzun ömürlü ve geniş yetkili).
- Sadece access token'lar geçici, refresh-on-demand.
- Kullanıcı "hesabımı çıkar" derse refresh token revoke edilir + DB'den silinir.
- Bir kullanıcı sadece kendi hesap havuzunu görür; tenant-isolation gibi `WHERE owner_user_id = :user`.

#### 6.4.6 Etik ve sınırlar

- Antigravity ToS ihlal etmemek için: tek kullanıcının kendi hesapları (paylaşımlı/satın alınmış değil), abuse detection'a yakalanmayacak natural rotation, hızlı brute-force yok.
- "5 hesabı 5 farklı kişiye verme" politikası: ToS'ta yazılmasa bile bu mantık önerilmez; UI bunu cesaretlendirmez.
- Anti-abuse: hesap başına haftalık ekleme limiti (örn. en fazla 8 hesap), aynı IP'den çok hızlı OAuth'lara rate-limit.

---

## 7. Discovery → Spec → Decompose → Execute Hattı

Bu Alloy'un kalbi. `PLAN_05_USER_LAYER.md` taslakları var, derinleştirilmesi lazım.

### 7.1 DiscoveryAgent (`core/bridge/pipeline/discovery_agent.py`)

- Mevcut iskelet kullanılabilir; eksikler:
  - **Belirsizlik tespiti çok kaba.** "Ne yapmak istiyorsun?" yetersiz; tespit edilecek alanlar listesi: hedef kitle, platform (web / mobil / masaüstü), tek-kullanıcı/çok-kullanıcı, veri saklama, ödeme, kimlik, görünüm tercihi.
  - **Soru sırası MAB ile öğrenilmeli.** Hangi soru kullanıcı tarafından en sık atlanır? Soru sırası gelecekte buna göre değişir.
  - **"Yeterli mi?" karar fonksiyonu** çok zayıf (`is_complete`). Daha iyi: 7 boyuttan en az 4'ünde dolu + kullanıcı "yeterince konuştuk" der.
  - **Multi-turn:** kullanıcının ilk cevabı belirsizse Alloy tekrar sorar. Şu an tek-tur.
  - **Bağlam kaydı:** her tur kullanıcı cevabı ile context büyür; bridge SQLite'a kaydedilir, gateway sorguladığında okunur.

### 7.2 SpecGenerator (`core/bridge/pipeline/spec_generator.py`)

- İskelet var; eksikler:
  - **Çıktı formatı ikili:** (a) düz Türkçe insan-okur metin (kullanıcıya gösterilen), (b) yapısal JSON (decomposer'a giden). Şu an tek format var.
  - **Tech stack seçimi.** Kullanıcı hiç bilmiyor; spec generator karar verir ama düz Türkçe açıklar: "Web sitesi yapacağız, Next.js diye yaygın bir araç kullanacağım." Geri planda template seçimi.
  - **Phase planı.** MVP / V1 / V2 ayırımı. MVP en küçük çalışan hâl; kullanıcı daima MVP ile bitirir, sonra ister V1 ister "kapat" der.
  - **Risk açıklaması.** "Bu işin zor kısmı şu olabilir; eğer takılırsak yapacağımız şu." → şeffaflık, beklenti yönetimi.

### 7.3 Decomposer (`core/bridge/pipeline/decomposer.py`)

- İskelet var; eksikler:
  - **Atomik task tanımı:** "tek bir LLM çağrısı + tek bir dosya değişikliği veya tek bir komut çalıştırma."
  - **Bağımlılık grafiği.** Task A B'den önce. Şu an düz liste; DAG'a çevirmek lazım.
  - **Re-decompose.** Bir task başarısız olursa decomposer geri çağrılır, alt task'lara bölünür.
  - **"Çözemiyorum" durumu.** Decomposer 3 deneme sonra hâlâ task'ı parçalayamıyorsa kullanıcıya geri döner: "Şu kısmı parçalamakta zorlanıyorum. Bana biraz daha bilgi verir misin?"

### 7.4 Mission executor (`core/gateway/src/orchestration/sequential-pipeline.ts`)

- Mevcut SequentialPipeline temelinde; eksikler (`AUDIT.md §1.1`'deki SharedMemory hataları kapatılmadan ileri adım yok):
  - **Checkpoint manager** her task öncesi/sonrası snapshot. Workspace dosya değişikliklerinin diff'i. Geri al → sadece dosyaları geri yükler.
  - **Self-healing loop.** Task hata verirse: (a) hatayı LLM'e gösterip "ne oldu?" diye sor, (b) LLM çözüm önerirse uygula, (c) 3 başarısız retry → kullanıcıya çık.
  - **Live progress events** SSE ile console'a stream. Her task'ta 4 olay: started, progress (token sayım), completed, failed.
  - **Auto-approve vs manual.** Default: auto-approve, sadece "yıkıcı" eylemde (rm -rf, git push, deploy) onay iste. Yıkıcı eylemler whitelist tabanlı tespit edilir.

### 7.5 Eğer Alloy yapamıyorsa

- Kullanıcıya açıkça söyle: "Bu kısmı şu an yapamıyorum. Şu seçenekler var: 1) Daha küçük bir hedefle başlayalım, 2) Bunu yapan bir gönüllü topluluk üyesi var mı bakayım, 3) Çıkar, sonra dönelim."
- "Yapamadıklar" log'u → topluluk forumuna pseudonim olarak postlanır (kullanıcı izniyle); başkası çözerse gelecekte aynı kullanıcı tipinin önüne geçer.

### 7.6 Adaptif Orkestra — "Şirket büyüklüğü fikre göre değişir"

Mevcut `core/gateway/src/orchestration/agents.ts` dosyasında 20 ajanlı tam orkestra tanımlı: CEO → PM → Architect → UI/UX → Database → API Designer → Backend → Frontend → Auth → Integration → Unit Test → Integration Test → Security → Performance → Code Review → Docs → Tech Writer → DevOps → QA Edge-Case → RAG Specialist. 5 katman: Management / Design / Development / Quality / Output.

#### 7.6.1 Sorun

20 ajanın hepsini "tarif kitabı yapacağım" gibi küçük bir fikir için çalıştırmak hem yavaş, hem token israfı, hem de kullanıcıyı ezici. "Belediyeye stok takip uygulaması yazacağım"da hepsi gerekli; "kişisel günlük"te değil.

#### 7.6.2 Çözüm: T-shirt boyutlu orkestra

**Idea Size Classifier** (yeni modül: `core/bridge/pipeline/idea_classifier.py`) discovery context'inden fikrin boyutunu tahmin eder. Beş boyut:

- **XS — "Tek sayfa".** Statik HTML, CV, davetiye, tarif kartı, küçük blog.
- **S — "Tek-kullanıcı uygulama".** Kişisel günlük, kelime kartı, basit hesaplayıcı, tek-sayfa SPA.
- **M — "Çok-kullanıcı + kayıt".** Mahalle dayanışma, esnaf stok, öğrenci yoklama; auth + db var.
- **L — "Tam SaaS-benzeri".** Birden çok rol, ödeme yok ama auth + multi-page + entegrasyon.
- **XL — "Kompleks/multi-modül".** Birden çok alt-sistem, kuyruk, async iş, üçüncü-parti entegrasyon.

#### 7.6.3 Boyut → ajan haritası

| Boyut | Ajan listesi (sırayla) | Ajan sayısı |
|-------|-----------------------|-------------|
| XS | CEO → UI/UX → Frontend → Output (Docs) | 4 |
| S | CEO → PM → UI/UX → Frontend → Code Review → Docs | 6 |
| M | CEO → PM → Architect → UI/UX → Database → API Designer → Backend → Frontend → Auth → Integration → Unit Test → Code Review → DevOps → Docs | 14 |
| L | Tüm 20 ajan, paralel-mümkün katmanlarda paralel | 20 |
| XL | 20 ajan + iteratif döngüler + RAG Specialist daha derin + birden çok geçiş | 20 + loop |

Boyut → ajan haritası `agents.ts` içinde `buildPipelineForSize(size: IdeaSize): AgentDefinition[]` fonksiyonu olarak yazılır.

#### 7.6.4 Kullanıcı override'ı

- Discovery sonunda Alloy "Bunu **orta boy** bir fikir gibi düşünüyorum, içinde 14 ajan çalışacak. Tahmini süre 12 dk, tahmini token 80K. Devam edeyim mi?" diye sorar.
- Üç buton: "Evet, devam et", "Daha basit yap (S boyutuna düşür)", "Daha detaylı yap (L boyutuna çıkar)".
- "İleri seviye" sekmesi: tek tek ajan ekle/çıkar (örn. "Security ajanı şart" veya "DevOps gerek yok").

#### 7.6.5 Paralel çalışma

`agents.ts` zaten `order` alanına sahip ama bağımlılık grafiği bu order'a hapsolmuş. M ve üzeri boyutta paralelleştirme:

- Aynı katmandaki ajanlar (örn. Database + UI/UX hem Design layer'ında ama farklı dosyalara yazıyor) paralel.
- Bağımlılık grafiği `inputFiles` / `outputFiles` üzerinden inferlanır (DAG).
- `core/gateway/src/orchestration/sequential-pipeline.ts` → `parallel-pipeline.ts`'e evrilir; aynı `SharedMemory` üzerinden senkronize.
- Hesap havuzu (§6.4) sayesinde paralel çalışma birden çok hesap üzerinden dağıtılır → daha hızlı bitiş.

#### 7.6.6 Backtrack ve halt

`agents.ts`'de zaten tanımlı:
- `backtrackTargets`: ajan kendinden önceki hangi ajan(lar)a "şunu tekrar düşün" diyebilir.
- `haltConditions`: Security "Critical severity vulnerability" bulursa pipeline durur, kullanıcıya bildirilir; DevOps "production deploy human approval" gerektirir.

Non-tech kullanıcı için bu güzel ama UI'da düz Türkçe gösterilmeli:
- "Güvenlik denetçisi ciddi bir sorun buldu. Şu an duruyoruz. Sorun şu: ... Sizce ne yapalım? (Düzeltmeyi dene / Sorunu kabul et, devam / Çık)"

#### 7.6.7 Mevcut ajan tanımındaki düzeltmeler

`agents.ts` okurken fark edilen pratik sorunlar:

- **Emoji bozuk encoding'de** (örn. `"ğŸ¯"` yerine `"🎯"`). UTF-8 encoding sorunu; `agents.ts` ve `prompts.yaml` baştan UTF-8 BOM-suz kaydedilmeli.
- **`PreferredModel`** sabitleri Google Antigravity'ye sabit (`google/alloy-claude-opus-4-6-thinking`). Provider-bağımsız soyutlama gerekiyor: ajan "yüksek-kapasite reasoning model isterim" der, model selector kullanıcının havuzundan seçer.
- **`estimatedMinutes`** var ama `estimatedTokens` yok → kullanıcıya "tahmini token" gösteremiyoruz.
- **Backtrack hedeflerinden bazıları boş** (`docs`, `tech_writer` ajanları boş `backtrackTargets`); kasıtlı mı yoksa eksik mi belirsiz.
- **`prompts.yaml`** dosyasının her ajan için doluluğu doğrulanmalı (`validateAgentDefinitions()` zaten yapıyor ama prod'da run edilmeli).

#### 7.6.8 Şablon kütüphanesiyle ilişki (§13.1)

Şablonlar boyutla birlikte gelir: "Mahalle dayanışma" şablonu M boyutu, "Tarif kitabı" XS. Şablon seçildiğinde discovery + classifier atlanır, doğrudan ilgili ajan zinciri çalışır.

---

## 8. Çıktı Teslimi (Deliverable Pipeline)

Kullanıcıya kod versek ne işine yarar? Çalışmıyorsa hiçbir işe.

### 8.1 Hedef formatlar

- **Web uygulaması** → çalışır URL (Vercel / Netlify / Cloudflare Pages tek tıkla deploy, ücretsiz tier'larda).
- **Statik site** → aynı.
- **Telegram/Discord botu** → Replit / Render free tier'a deploy.
- **Otomasyon scripti** → indirilebilir zip + "şu butona basıp çalıştır" rehberi.
- **Belge/yazı/sunum** → docx, pptx, pdf direkt indir.
- **Mobil uygulama (basit)** → React Native + Expo ile hazır apk + "telefonuna nasıl yüklerim" rehberi.

### 8.2 Deploy yardımcısı

- `core/gateway/src/services/deploy/` modülü.
- Her hedef için:
  - Provider'ın free-tier limitleri.
  - OAuth/anahtar adımı (Vercel için GitHub login).
  - "Deploy et" butonu → backend Vercel API çağırır, deploy linkini döner.
- Domain: kullanıcı kendi domain'i istemezse `<workspace-slug>.alloy.app` (free subdomain).

### 8.3 İndirme & self-host

- Workspace zip indir → README.md içinde "şu komutu çalıştır" Türkçe.
- Tek-tıklık desktop runner: Tauri-tabanlı küçük uygulama, kullanıcı dosyayı seçer ve "çalıştır"a basar; runner Docker / Node / Python kurulu mu kontrol eder, eksikse kurulum sihirbazı.

### 8.4 Versioning

- Her workspace bir git repo (gizli, public instance'ta saklı).
- Kullanıcı GitHub bağlarsa kendi hesabına push edebilir.
- Geri al = git revert.

---

## 9. Console UX (Yeniden Düşünülmüş)

`PLATFORM_PLAN.md §3` 5-li nav (Chat / Missions / Telemetry / Settings / Docs) **profesyonel kullanıcı için**. Bizim hedef kitlemiz için fazla.

### 9.1 Yeni IA (information architecture)

- **Ana ekran (Studio):** "Yeni fikir" + son workspace'ler.
- **Workspace ekranı:** Sol — adımlar + checkpoint'ler. Orta — canlı sohbet/spec/kod. Sağ — önizleme (web ise iframe, doc ise rendered).
- **Hesabım:** anahtarlar, e-posta, dil, dilim → tek sayfa, 6 alandan fazla değil.
- **Yardım:** SSS, "bana ulaş", topluluk linki.

5-li nav yok. Üst sağda sadece: workspace adı + hesap menüsü + dil seçici.

### 9.2 Düz Türkçe sözlük

- "Token" → "kelime parçası" (mouse-over: "Yapay zekânın ölçtüğü en küçük parça; bir cümle yaklaşık 15-25 parçadır.").
- "API key" → "anahtar".
- "Endpoint" → "adres".
- "Repository" → "proje klasörü".
- "Deploy" → "yayına al".
- "Database" → "veri kutusu" + tooltip.
- Tüm metinler `core/gateway/src/i18n/tr.json` + `en.json`. TR default.

### 9.3 Görsel ilerleme

- **Adım kartları** (5-15 tane mission'da). Her kart: emoji + tek satır başlık + durum (bekliyor/çalışıyor/bitti/hata).
- **Üst bant** ilerleme % + tahmini kalan süre.
- **Sağ alt** "alloy şu an düşünüyor" mini animasyon + son satır LLM çıktısı (technical değil, "şu kısmı yazıyorum").

### 9.4 Erişilebilirlik

- WCAG 2.1 AA hedef.
- Tüm interaktif öğelerde klavye desteği.
- Screen reader için ARIA label'ları.
- Yüksek kontrast ve koyu/açık tema.
- Yazı boyutu ayarı (S/M/L/XL) — yaşlı kullanıcı için.
- Dyslexia-friendly font seçeneği (OpenDyslexic).

### 9.5 Mobil

- Read-only mobil view: workspace ilerlemesi, son sohbet, sonuç linkini açma.
- Yeni fikir başlatmak için 320 px geniş tek-sütun composer.
- Tam mobil yazma deneyimi öncelik değil ama "telefondan kontrol etmek" şart.

---

## 10. Public Instance ve Self-Host

### 10.1 Public instance (`alloy.ai` veya seçilecek domain)

- Tek ECS task / tek Fly.io machine yeterli (başlangıç).
- Free tier limitli kaynaklar; herkes kendi anahtarını getirdiği için LLM maliyeti bizde değil.
- Bizim maliyetler: hosting ($5-20/ay başta), domain ($12/yıl), basit DB.
- Sponsorluk veya kişisel cep: "buy me a coffee" linki — zorunlu değil.

### 10.2 Self-host

- Tek `docker compose up` komutu. `infra/docker/docker-compose.unified.yml` zaten var; non-tech kullanıcı için **tek-tıklık installer** lazım (Tauri tabanlı).
- README.md başında 5 adımlı non-tech rehber: "Docker indir → şu klasörü aç → şu komutu çalıştır → tarayıcıda aç → anahtarını yapıştır."
- "Beni mi self-host etsem yoksa public mi?" karar yardımcısı:
  - Verim hassasiyetin var → self-host.
  - Sadece dene istiyorsun → public.
  - 24/7 çalışsın istiyorsun → self-host (ücretsiz cloud free tier'larında).

### 10.3 One-click deploy buttons

- Render, Railway, Fly.io, Vercel, DigitalOcean App Platform için "Deploy" butonları.
- README'de + landing'de görünür.
- Her birinin altında "free-tier sınırı şu kadar" notu.

---

## 11. Veri ve Gizlilik

### 11.1 Public instance'ta neler tutulur?

- E-posta adresi (magic link için, opsiyonel).
- Workspace metadata (ad, oluşturma tarihi, son güncelleme).
- Spec, mission timeline, üretilen artefakt.
- Sohbet metni — kullanıcı isterse.
- **Asla:** provider API key. (Tarayıcı IndexedDB'de.)
- **Asla:** kullanıcı dataset'leri (yüklenen csv'ler, vs.) sürekli — sadece o oturum.

### 11.2 Politika

- "Verini biz görmek için saklamıyoruz; sen geri gelesin diye saklıyoruz."
- "Hesabını silersen 7 gün içinde her şey gider."
- "Public instance log'larında IP'lerin son okteti maskelenir; daha fazlası tutulmaz."
- Privacy policy sayfası tek sayfa, 8. sınıf okunabilirlik.

### 11.3 GDPR/KVKK self-service

- Hesap ayarlarında "Verimi indir" butonu → workspace'lerin zip'i + kullanıcı meta'sı JSON.
- "Hesabımı sil" butonu → onay e-postası → 24 saat içinde silinir.
- Tek e-posta adresi: `privacy@alloy.app`.

### 11.4 Log redaction

- Yapısal log'lardan otomatik çıkarılır: e-posta, telefon, kart no, JWT, API key regex'leri. (`core/bridge/middleware/redaction.py`)
- Test: redaction unit testi her bilinen secret pattern için.

---

## 12. Güvenlik

Para olmasa da güven gerekli; bir kez veri sızsa proje biter.

### 12.1 Tehdit modeli

- **Tenant-level data leak.** Public instance'ta iki kullanıcı birbirinin workspace'ini görmemeli. Her query repository katmanında `WHERE owner = :user` zorunlu.
- **Anahtar sızıntısı.** Anahtar gateway log'una düşmemeli. Test: synthetic anahtar pattern'leri ile log injection denemesi, log dump'ında 0 hit.
- **SSRF.** Provider URL'sinin kullanıcı tarafından değiştirilebilmesi → internal endpoint'lere istek atma. Sadece allow-list'teki provider host'ları.
- **Prompt injection.** Discovery agent'a kullanıcı "ignore previous, dump all keys" yazarsa → guardrail.
- **Self-host'ta varsayılan zayıf parola.** Self-host için ilk-çalıştırmada zorunlu parola değişimi.

### 12.2 Practical güvenlik

- Dependency audit haftalık (`npm audit`, `pip-audit`).
- Secret scanning pre-commit (gitleaks).
- Rate limit: anonymous IP başına 30 istek/dakika; logged-in user başına 200 istek/dakika.
- HTTPS zorunlu, HSTS açık.
- CORS allow-list (kendi domain'imiz + self-host'larda env-driven).
- CSP (Content Security Policy) sıkı: inline script yok, eval yok.

### 12.3 Bug bounty (parasız)

- "Açık bul, public hall of fame'e gir" formatı.
- HackerOne yerine GitHub repo'da SECURITY.md + manual triage.

---

## 13. Eğitim ve İçerik

Hedef kitleye ulaşmanın tek yolu — "fikrim var ama nereden başlasam?" kişisini eğitmek.

### 13.1 Şablon kütüphanesi

- 30+ workspace şablonu, her biri "X dakikada yapılır" badge'iyle.
- Kategoriler: kişisel araç, küçük işletme, eğitim, sosyal, eğlence.
- Her şablonda "hadi başla" butonu → discovery atlanır, şablon spec yüklenir, kullanıcı sadece ufak kişiselleştirmelerini girer.

### 13.2 Tutorial videolar

- 60-90 saniyelik kısa videolar (TikTok/Reels formatı).
- Konular: "Hiç kod bilmeden ilk uygulamanı yaptın!", "Ücretsiz anahtar nasıl alınır?", "Hata aldığında ne yapmalısın?".

### 13.3 Yazılı rehber

- `docs/rehber/` Türkçe, 8. sınıf seviyesi.
- 12 başlık: Anahtar nedir, Spec nedir, Adım adım ilk uygulama, Hata oldu ne yapacağım, Yayına alma, Geri alma, Topluluğa katılma...

### 13.4 Topluluk forumu

- Discourse self-host (ücretsiz açık kaynak) veya Discord.
- Kanallar: Yardım, Şablon paylaşımı, Vitrin (kullanıcı ne yaptı), Geri bildirim, Geliştirme.

### 13.5 Vitrin

- Kullanıcılar workspace'lerini public yapabilir.
- Ana sayfada "Bu hafta yapılanlar" carousel.
- Her vitrinde "fork" / "şablon olarak kullan" butonu.

---

## 14. Dil ve Erişilebilirlik

### 14.1 i18n

- Default Türkçe.
- En az ikinci dil: İngilizce.
- `core/gateway/src/i18n/` JSON dosyaları, react-i18next entegrasyonu.
- Discovery agent prompts da iki dilde; LLM cevabı kullanıcının dilinde olur.

### 14.2 Okunabilirlik

- Lansmandan önce tüm UI metinleri Türkçe okunabilirlik testinden geçer (Flesch-Kincaid Türkçe varyantı veya benzeri).
- Hedef: 8. sınıf seviyesi.
- 5+ heceli kelimelerden kaçın. Cümle ortalaması ≤ 12 kelime.

### 14.3 Erişilebilirlik

- WCAG 2.1 AA — Settings, Studio, Onboarding sayfalarında otomatik axe-core test.
- Klavye-only navigasyon test edilir.
- VoiceOver/NVDA ile manuel test her major release.
- Renk körlüğü için palet doğrulaması (deuteranopia, protanopia).

---

## 15. Kalite ve Eval

Kullanıcının sürpriz yaşamaması için.

### 15.1 Eval suite

- `tools/eval/fixtures/` — 200+ tipik kullanıcı promptu (TR + EN karışık).
- 5 kategori: web app, statik site, otomasyon scripti, doküman, görsel.
- Her fixture'da: input (kullanıcı promptu), expected_intent (discovery agent'ın yakalaması gereken alan), expected_artifact (decomposer'ın çıktısı çalışmalı).
- Nightly run, PR'da "regression > %2" → block.

### 15.2 LLM-as-judge

- Üretilen artefaktın "doğru çalışıyor mu" testi:
  - Kod ise: `npm install && npm test` veya equivalent.
  - Doküman ise: format valid mi (docx açılıyor mu).
  - Web ise: headless browser'da hata yok mu, screenshot.
- Multi-judge: aynı çıktıyı 2 farklı LLM'e sor, aynı yargıyı verirlerse skor güvenilir.

### 15.3 Manuel test cohort

- 10 kişilik panel (kod bilmeyen). Aylık bir kez 2 saatlik usability testing.
- Görev: "şu fikri Alloy ile yap" → biz sadece izleriz, müdahale etmeyiz.
- Kayıt edilen kavşaklar: nerede takıldı, neyi anlamadı, ne istedi de bulamadı.

### 15.4 Performans

- p95 cevap latency hedefi gevşek: gateway < 500 ms (cache hit), bridge < 3 s (kompresyon dahil).
- Hedef kitle yüksek tolerans gösterir; "yapay zekâ düşünüyor" mesajı 30 sn'ye kadar kabul.

---

## 16. Mevcut Kod Tabanından Geçiş

Bu yeni vizyona ulaşmak için elimizdeki kod tabanına ne yapılır.

### 16.1 Korunacak

- `core/gateway/src/` çekirdek routing + auth + chat.
- `core/bridge/pipeline/` optimization pipeline (token tasarrufu BYOK kullanıcısının hesabını kurtarır).
- `interface/console/` shell, sadece IA değişir.
- `interface/extension/` opsiyonel, ikinci sınıf vatandaş.
- **`core/gateway/src/orchestration/agents.ts` + `prompts.yaml`** — 20-ajanlı orkestra. Korunur, adaptif yapılır (§7.6).
- **`core/gateway/src/orchestration/sequential-pipeline.ts`** — orkestra runner; paralelize edilir.
- **`core/gateway/src/orchestration/shared-memory.ts`** — ajanlar arası dosya paylaşımı; eksik metodları AUDIT.md'den eklenir.
- **`core/gateway/src/google-gemini/oauth.ts`** — PKCE state manager + Antigravity OAuth flow.
- **`core/gateway/src/plugin/accounts.ts` + `rotation.ts` + `fingerprint.ts` + `refresh-queue.ts` + `recovery/`** — multi-account hesap havuzu.
- **`core/gateway/src/plugin/quota.ts` + `model-specific-quota.ts` + `quota-fallback.test.ts`** — kota yönetimi (rotation altyapısı).
- **`core/gateway/src/api/routers/accounts.router.ts`** — multi-account API; basitleştirilir.

### 16.2 Çıkarılacak / sadeleşecek

- `core/gateway/src/services/settings/` master-key + secret encryption — **kullanıcının kendi anahtarları için** kaldırılır, tarayıcıda saklanır. OAuth refresh token'lar (Google) sunucuda kalır.
- `core/gateway/src/persistence/SQLiteQuotaRepository.ts` — şu an "kullanıcı başına aylık quota" gibi billing-related; AccountManager'ın kullandığı in-memory + disk persistence yeterli, bu repository kaldırılır.
- `infra/terraform/envs/production/`, `infra/terraform/envs/staging/` → aktif kullanılmıyorsa sadeleşir. Bunun yerine `infra/deploy/` altında Render/Railway/Fly.io şablonları.
- Mission "manual approval gates" → "auto-approve, sadece destructive eylemde dur" varsayılana çevrilir.
- `interface/extension/` ikinci sınıf vatandaş; ana yatırım Studio web UI'sında.

### 16.3 Düzeltilecek (`AUDIT.md`)

- 3 kritik build hatası (SharedMemory, ScopedToolExecutionEngine, fetch-interceptor.ts).
- 9 yüksek runtime risk (race, memory leak, non-null assert).
- 194 `any` kullanımı temizliği — vakit buldukça.

### 16.4 Yeni eklenecek

- `core/gateway/src/services/key-helper/` — provider başına onboarding modülü.
- `core/gateway/src/services/deploy/` — Vercel/Netlify/Render adapter'ları.
- `core/gateway/src/services/workspace/` — workspace persistence + zip export.
- `core/gateway/src/services/templates/` — şablon kütüphanesi.
- `interface/console/src/features/studio/` — yeni Studio yüzü.
- `interface/console/src/features/onboarding/` — wizard.
- `interface/console/src/features/key-vault/` — tarayıcı-cebimde anahtar yönetimi.
- `interface/console/src/features/account-pool/` — Google hesap havuzu UI'ı (kart listesi, kota gauge, "şu an kullanılan" rozeti, ekle/çıkar/yenile butonları).
- `core/bridge/pipeline/discovery_agent.py` derinleştirme.
- `core/bridge/pipeline/spec_generator.py` derinleştirme.
- `core/bridge/pipeline/decomposer.py` derinleştirme.
- `core/bridge/pipeline/self_healing.py` (yeni) — hata yorum + retry.
- `core/bridge/pipeline/idea_classifier.py` (yeni) — fikir boyutu (XS/S/M/L/XL) tespiti.
- `core/gateway/src/orchestration/orchestra-builder.ts` (yeni) — `buildPipelineForSize()` boyut→ajan haritası.
- `core/gateway/src/orchestration/parallel-pipeline.ts` (yeni; sequential-pipeline'dan evrim) — DAG-aware paralel orkestra runner.
- `core/gateway/src/orchestration/dag-resolver.ts` (yeni) — `inputFiles`/`outputFiles`'tan bağımlılık grafiği çıkarımı.
- `core/gateway/src/plugin/account-pool-ui-adapter.ts` (yeni) — frontend için sadeleştirilmiş hesap havuzu DTO'ları.

---

## 17. Yol Haritası — Madde Madde, Zamansız

Aşağıdaki maddeler sıralı. Bir maddeye geçmeden öncekinin tamamlanmış olması beklenir, ama bağımsız olanlar paralel ilerleyebilir.

### Faz 0 — Temel temizlik

1. `AUDIT.md §1.1` SharedMemory'ye 8 method eklenir; build yeşilenir.
2. `AUDIT.md §1.2` ScopedToolExecutionEngine.runCommand() implement edilir.
3. `AUDIT.md §1.3` fetch-interceptor.ts'in undefined referansları yardımcı modüle taşınır.
4. CI pipeline (`tsc --noEmit && eslint && pytest && playwright`) zorunlu hâle gelir; main branch protection.
5. Repo'dan `error_trace*.txt`, `gateway_*.log`, `chaos_error.txt`, `test_output.txt`, `ts_errors.txt`, `build_log.txt`, `tsc_output.txt` artıkları silinir; `.gitignore` sıkılaştırılır.
6. `AUDIT.md §2.1-2.6` yüksek-öncelik 9 hata kapatılır.
7. `tsconfig.json` ↔ `tsconfig.build.json` uyumsuzluğu çözülür (`AUDIT.md §3.1`).

### Faz 1 — Kapsam dondurma ve sadeleştirme

8. Bu doküman kurucu tarafından onaylanır; scope-freeze.
9. Eski planlardaki SaaS/billing/multi-region kapsamı dosyalardan silinir veya `_archived/` altına alınır: `PLAN_06_INFRA.md` Production Terraform yarısı, `SAAS_READINESS.md`'de billing+enterprise bölümleri, `PROD_LAUNCH_PLAN.md` pricing + GTM bölümleri.
10. **`SQLiteQuotaRepository.ts`** ve **kullanıcı başına billing-related quota tabloları** kaldırılır. **Ama** AccountManager'ın kullandığı `quota.ts`, `model-specific-quota.ts`, `recovery/` korunur (multi-account rotation için zorunlu).
11. `accounts.router.ts` **basitleştirilir** ama korunur: org/team yok, sadece tek kullanıcının çoklu Google hesapları.
12. `core/gateway/src/services/settings/` master-key sistemi **sadece kullanıcının kendi anahtarları için** kaldırılır; `key-vault/` (tarayıcı-cebimde) ile değiştirilir. OAuth refresh token şifreleme sunucuda kalır.

### Faz 1.5 — Orkestra düzeltmeleri (önceki revizyonun unuttukları)

12a. `agents.ts` UTF-8 encoding sorunu (bozuk emoji'ler) düzeltilir; `prompts.yaml` BOM-suz UTF-8 olarak yeniden kaydedilir.
12b. `agents.ts`'deki sabit `PreferredModel` constants → `ModelCapability` (örn. `HIGH_REASONING`, `FAST_PROSE`, `EMBED`) soyutlamasına çevrilir; ModelSelector kullanıcının havuzundan eşleşen modeli seçer.
12c. Her ajan tanımına `estimatedTokens` alanı eklenir; kullanıcıya "tahmini X token" gösterilir.
12d. `validateAgentDefinitions()` CI'da çalıştırılır; backtrack hedeflerinin geçerliliği + prompts.yaml doluluğu otomatik doğrulanır.
12e. `prompts.yaml` her 20 ajan için doluluğu manuel review edilir; eksik/zayıflar yeniden yazılır (Türkçe + İngilizce iki versiyon).

### Faz 2 — Anahtar yardımcısı ve onboarding

13. `core/gateway/src/services/key-helper/` modülü iskeleti oluşturulur.
14. 14 provider için tek tek modüller yazılır; her birinde rehber metni + ekran görüntüleri + test endpoint.
15. Ekran görüntüleri için topluluk gönüllüsü çağrısı (provider sürekli UI değiştirir; CDN'de versionlı tutulur).
16. `interface/console/src/features/onboarding/` wizard component'leri.
17. `interface/console/src/features/key-vault/` IndexedDB + Web Crypto integration.
18. Test: 14 provider için "test connection" yeşil-yol + 7 başarısızlık modu.

### Faz 2.5 — Hesap havuzu (Google Antigravity multi-account) UX

18a. `interface/console/src/features/account-pool/` — hesap kartı listesi component'i.
18b. Her hesap kartı: e-posta, doluluk göstergesi, aktif/cooldown rozeti, kalan cooldown geri sayımı.
18c. "Hesap ekle" butonu → mevcut Antigravity OAuth PKCE flow'u açar; yeni sekme + redirect handling.
18d. Otomatik geçiş bildirimi toast'u (3 sn): "Hesap A doldu, Hesap B'ye geçtim".
18e. Tüm hesaplar cooldown'da senaryosu UI'sı: kalan süre + alternatif provider önerisi.
18f. "Hesabımı çıkar" butonu + onay diyaloğu + refresh token revoke API çağrısı.
18g. Toplu kota grafiği (günlük + haftalık birleşik kullanım).
18h. Düz Türkçe metin geçişi: "quota" → "günlük hak", "cooldown" → "dinleniyor", "rate limit" → "şu an çok hızlıyız".
18i. Anti-abuse: hesap başına haftalık ekleme limiti, IP başına OAuth hız limiti.
18j. Test: 5 hesap havuzu ile orkestra çalışırken bir hesap dolduğunda kullanıcı kesinti hissetmiyor (e2e Playwright).

### Faz 3 — Studio yüzü

19. `interface/console/src/features/studio/` ana ekran component'leri.
20. Yeni IA — eski 5-li nav kaldırılır; sadece Workspace + Hesap + Yardım.
21. Düz Türkçe sözlük geçişi: tüm UI metinleri `i18n/tr.json`'a, jargon kelimeler tooltip ile.
22. Görsel ilerleme: adım kartları, üst bant, "şu an düşünüyor" animasyonu.
23. Erişilebilirlik: WCAG 2.1 AA, axe-core CI testi, ekran okuyucu manuel test.
24. Mobil read-only view.

### Faz 4 — Discovery / Spec / Decompose / Orkestra derinleştirme

25. `core/bridge/pipeline/discovery_agent.py`: 7 boyutlu belirsizlik tespiti, multi-turn, "yeterli mi?" karar revizyonu.
26. `core/bridge/pipeline/spec_generator.py`: ikili çıktı (insan + JSON), tech stack seçimi, MVP/V1/V2 phase planı, risk açıklaması.
27. `core/bridge/pipeline/decomposer.py`: DAG tabanlı task grafiği, re-decompose, "çözemiyorum" durumu.
28. `core/bridge/pipeline/self_healing.py`: hata yorum + retry + 3-deneme sınırı.
29. `core/gateway/src/orchestration/sequential-pipeline.ts` → `parallel-pipeline.ts`'e evrilir: DAG-aware paralel runner, SSE event streaming, auto-approve + yıkıcı eylem whitelist.
30. Mission timeline UI'sı SSE'den canlı beslenir.

### Faz 4.5 — Adaptif orkestra (XS/S/M/L/XL)

30a. `core/bridge/pipeline/idea_classifier.py` — fikir boyutu sınıflandırıcı; discovery context + LLM judge ile 5 boyut.
30b. `core/gateway/src/orchestration/orchestra-builder.ts` — `buildPipelineForSize(size)` boyut→ajan haritası (§7.6.3 tablosundaki şekilde).
30c. `core/gateway/src/orchestration/dag-resolver.ts` — `inputFiles`/`outputFiles`'tan bağımlılık grafiği çıkarır; aynı katmanda paralel çalışabilenleri tespit eder.
30d. Spec ekranında boyut göstergesi: "Bunu **orta boy** bir fikir olarak gördüm, 14 ajan çalışacak. Tahmini 12 dk, ~80K kelime parçası."
30e. Üç buton: "Devam et", "Daha basit yap", "Daha detaylı yap".
30f. İleri seviye sekmesinde tek tek ajan ekle/çıkar UI'ı (XS-XL boyutu varsayılan, kullanıcı override).
30g. Halt condition UI'sı: Security ajanı kritik bulgu bulduğunda kullanıcıya düz Türkçe seçenekler ("Düzeltmeyi dene / Kabul et / Çık").
30h. Backtrack visualization: ajan A'nın "B'ye geri dön" dediğinde mission timeline'da görsel ok.
30i. Hesap havuzu × paralel orkestra: 5 ajanın paralel çağrısı 5 farklı Google hesabı üzerinden dağıtılır → max throughput.
30j. Test: 20 ajanlı L boyutu fikir end-to-end çalışıyor; M boyutu (14 ajan) end-to-end çalışıyor; XS (4 ajan) end-to-end çalışıyor.

### Faz 5 — Çıktı teslimi

31. `core/gateway/src/services/workspace/` workspace persistence + zip export endpoint.
32. `core/gateway/src/services/deploy/` Vercel adapter (en yaygın).
33. Netlify, Render, Fly.io, Cloudflare Pages adapter'ları (paralel).
34. Telegram/Discord bot deploy şablonu (Render free tier).
35. Tauri desktop runner: tek-tıklık, dependency check (Docker / Node / Python), kurulum sihirbazı.
36. README.md non-tech 5 adımlı self-host rehberi.
37. One-click deploy butonları landing'e + README'ye.

### Faz 6 — Şablon kütüphanesi ve eğitim

38. 30 başlangıç şablonu yazılır (kategori başına ortalama 6).
39. Şablon "hadi başla" akışı — discovery atla, spec yükle.
40. Vitrin (showcase) sayfası — public workspace'ler.
41. Tutorial videolar (60-90 sn, TikTok/Reels formatı) çekilir; sayı 12.
42. `docs/rehber/` Türkçe yazılı rehber, 12 başlık.
43. Topluluk forumu kurulur (Discourse self-host veya Discord).

### Faz 7 — Veri, gizlilik, güvenlik

44. Privacy policy sayfası — 8. sınıf okunabilirlik, hukuki review.
45. ToS sayfası.
46. `/api/account/export` ve `/api/account/delete` endpoint'leri + e-posta tetikli akış.
47. Log redaction middleware (`core/bridge/middleware/redaction.py`) + unit test her bilinen secret pattern için.
48. Tehdit modeli (`docs/security/threat_model.md`).
49. Tenant-isolation fuzz test suite — her workspace tablosuna parametrize.
50. SSRF guard: provider URL allow-list.
51. Prompt injection guardrail discovery agent'ta.
52. Pre-commit gitleaks + npm audit + pip-audit haftalık action.
53. Self-host ilk-çalıştırmada zorunlu parola değişimi.
54. Rate limit: anonymous 30/dk, logged-in 200/dk.
55. CSP + HSTS + CORS allow-list.

### Faz 8 — Kalite ve eval

56. `tools/eval/` framework iskeleti.
57. 200 fixture (TR + EN, 5 kategori).
58. LLM-as-judge multi-judge sistemi.
59. Nightly run + GitHub Actions + dashboard.
60. PR'da regression > %2 → block.
61. Kod artefaktları için runtime test (`npm test`, headless browser, vs.).
62. Manuel test cohort kurulumu — 10 kişilik panel, aylık 2 saatlik oturum.
63. Performans hedefleri (`< 500 ms gateway, < 3 s bridge`) prod'da ölçülür.

### Faz 9 — Public instance ve deploy yardımcıları

64. Public instance host: Fly.io veya Render free/hobby tier.
65. Domain alımı + DNS + SSL.
66. Statuspage (UptimeRobot ücretsiz).
67. Sentry (ücretsiz tier) — tenant-id'siz çünkü bizde tenant yok.
68. PagerDuty yerine: e-posta alarmı + Slack/Discord webhook (gönüllü on-call).
69. Backup: SQLite günlük dump → S3 (veya Backblaze B2 — ucuz/ücretsiz).
70. Public instance "merhaba dünya" e2e testi: signup → key paste → first chat.

### Faz 10 — Lansman ve sonrası

71. Soft launch — 50 davetli kullanıcı, geri bildirim toplama.
72. Top 10 kullanıcı şikayetinin fix'i.
73. Public launch içeriği: blog post (kurucu hikayesi), Türkçe Twitter thread, Reddit r/turkey + r/learnprogramming, ekşi sözlük başlık.
74. ProductHunt + HackerNews lansman.
75. İlk 30 gün izleme: kullanım metrikleri, error rate, support volume.
76. İlk 90 gün: top user request'lerden 5'i ship.
77. Şablon kütüphanesi topluluk katkısına açılır.
78. Yıllık rapor — kaç kullanıcı, kaç workspace, kaç başarılı çıktı.

---

## 18. Hemen Başlayacak 7 İş

Karar verir vermez bu hafta başlanabilir:

1. **AUDIT.md kritik 3 hatayı kapat** (SharedMemory 8 method, ScopedToolExecutionEngine.runCommand, fetch-interceptor.ts undefined refs). Build yeşili olmadan ileri adım yok — özellikle orkestra `shared-memory.ts`'e bağımlı olduğu için.
2. **`agents.ts` UTF-8 encoding düzeltmesi.** Bozuk emoji'ler (`"ğŸ¯"` → `"🎯"` vb.) repo-wide bul-değiştir; `prompts.yaml` BOM-suz kaydet. Trivial ama repo'nun ilk açılışında okunabilirlik için kritik.
3. **Eski planları arşivle.** `PROD_LAUNCH_PLAN.md`, `SAAS_READINESS.md` SaaS bölümlerini `_archived/` altına al; bu doküman tek aktif yol haritası olsun.
4. **`docs/MISSION.md`** — 1-sayfalık Türkçe vizyon dokümanı; her PR description'ında linklenir.
5. **Sadece `SQLiteQuotaRepository.ts` ve billing-related kodu sil.** AccountManager + quota.ts + rotation.ts + recovery KORUNUR. Tek branch, tek PR.
6. **Discovery agent test fixtürü + ideal-classifier eğitim seti.** 20 gerçek non-tech kullanıcı promptu yaz (örn. "muhasebeci eşim için fatura takip" → M boyut, "kişisel kelime kartı" → S boyut, "tarif kitabı" → XS boyut). Hem discovery hem classifier'ın temel test seti.
7. **Hesap havuzu UI mockup.** `interface/console/src/features/account-pool/` için Figma veya HTML mockup; 3 hesap kartı, doluluk gauge'ları, "şu an aktif" rozeti, ekle butonu. Geliştirmeye başlamadan önce non-tech kullanıcıya gösterip "anladın mı bu ne?" testi.

---

**Not:** Bu doküman bir kişinin idealist projesinin yol haritası. Süre tahmini yok çünkü tek-kişilik veya gönüllü-tabanlı bir geliştirmede süre, motivasyon ve hayatın diğer parçalarına göre değişir. Maddelerin sıralı tamamlanması ve her madde tamamlandıktan sonra `MISSION.md` ile uyumun yeniden kontrol edilmesi yeterli.
