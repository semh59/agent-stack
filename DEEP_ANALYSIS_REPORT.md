# 📊 İKİ PROJENİN DERİN ANALİZ VE BİRLEŞİM RAPORU

> **Tarih:** 17 Nisan 2026  
> **Kapsam:** AGENT (Sovereign AI Plugin) + ai-stack-mcp  
> **Hedef:** İki yarım projeyi birleştirerek güçlü bir AI platformu oluşturmak

---

## İÇİNDEKİLER

1. [Proje Özeti](#1-proje-özeti)
2. [AGENT Projesi Bölümlendirmesi](#2-agent-projesi-bölümlendirmesi)
3. [ai-stack-mcp Projesi Bölümlendirmesi](#3-ai-stack-mcp-projesi-bölümlendirmesi)
4. [Tamamlanma Durumu Matrisi](#4-tamamlanma-durumu-matrisi)
5. [Ortak Noktalar ve Sinerji Haritası](#5-ortak-noktalar-ve-sinerji-haritası)
6. [Derin Kontrol Planı](#6-derin-kontrol-planı)
7. [Birleşim Stratejisi](#7-birleşim-stratejisi)
8. [Birleştirilmiş Proje Mimarisi](#8-birleştirilmiş-proje-mimarisi)
9. [Yol Haritası](#9-yol-haritası)
10. [Risk Değerlendirmesi](#10-risk-değerlendirmesi)

---

## 1. PROJE ÖZETİ

### AGENT (Sovereign AI Plugin)
| Özellik | Değer |
|---------|-------|
| **Dil** | TypeScript (Node.js ES Modules) |
| **Sürüm** | v1.4.6 |
| **Satır Sayısı** | ~15,000+ (src/ only) |
| **Test Dosyaları** | 30+ test dosyası |
| **Ana Bağımlılıklar** | Fastify 5.8.2, Vitest 3.0, TypeScript 5.9.3, Zod 4.0 |
| **Genel Tamamlanma** | **%75** |
| **Kod Kalitesi** | **7.5/10** |

**Vizyon:** Google Antigravity IDE'ye OAuth ile erişim sağlayan, 18 ajanlı, otonom yazılım üretim hattı (Sovereign Software Factory). Gemini 3 Pro, Claude Opus 4.5/4.6 gibi modellere çoklu hesap yönetimi ile erişim.

### ai-stack-mcp
| Özellik | Değer |
|---------|-------|
| **Dil** | Python 3.11+ |
| **Satır Sayısı** | ~3,000+ |
| **Test Dosyaları** | 9+ test dosyası |
| **Ana Bağımlılıklar** | mcp SDK, pydantic-settings, httpx, chromadb, llmlingua |
| **Genel Tamamlanma** | **%60** |
| **Kod Kalitesi** | **8/10** |

**Vizyon:** Claude Code için token optimizasyon MCP sunucusu. Mesajları sınıflandırır, önbelleğe alır, temizler, sıkıştırır ve en uygun modeli önerir.

---

## 2. AGENT PROJESİ BÖLÜMLENDİRMESİ

### Bölüm 1: Plugin Katmanı (`src/plugin/`)
**Tamamlanma: %90 | Kalite: 7/10**

| Modül | Dosya | Durum | Açıklama |
|-------|-------|-------|----------|
| Ana Giriş | `plugin.ts` (2139 satır) | ✅ Tam | OAuth, hesap yönetimi, request proxy, rate-limit |
| Kimlik Doğrulama | `auth.ts` | ✅ Tam | Google OAuth 2.0 akışı |
| İstek Yönetimi | `request.ts` | ✅ Tam | API istekleri, streaming |
| Hesap Rotasyonu | `rotation.ts` | ✅ Tam | Çoklu hesap geçişi |
| Önbellek | `cache.ts` | ✅ Tam | Basit yanıt önbelleği |
| Token Yönetimi | `token.ts` | ✅ Tam | Refresh token, süre yönetimi |
| Depolama | `storage.ts` | ✅ Tam | Dosya tabanlı yapılandırma |
| Anahtar Yönetimi | `key-manager.ts` | ✅ Tam | API anahtarı dağıtımı |
| Kurtarma | `recovery.ts` | ✅ Tam | Hata kurtarma mekanizması |
| Kota | `quota.ts` | ✅ Tam | API kota takibi |
| Hesap Havuzu | `persist-account-pool.ts` | ✅ Tam | Kalıcı hesap havuzu |
| Düşünme Kurtarma | `thinking-recovery.ts` | ✅ Tam | Thinking model kurtarma |

**Eksiklikler:**
- `plugin.ts` çok büyük (2139 satır) — parçalanmalı
- Derin iç içe geçmiş `while(true)` döngüleri
- Bazı `any` tiplemeleri mevcut
- Test edilebilirlik sınırlı (doğrudan import bağımlılıkları)

### Bölüm 2: Gateway Katmanı (`src/gateway/`)
**Tamamlanma: %85 | Kalite: 8/10**

| Modül | Dosya | Durum | Açıklama |
|-------|-------|-------|----------|
| Gateway Çekirdek | `gateway.ts` | ✅ Tam | Fastify HTTP/WS sunucu |
| Sunucu | `server.ts` | ✅ Tam | REST + WebSocket handler |
| OAuth Sunucu | `auth-server.ts` | ✅ Tam | OAuth callback |
| Auth Yönetimi | `gateway-auth-manager.ts` | ✅ Tam | Kimlik doğrulama koordinasyonu |
| Token Deposu | `token-store.ts` | ✅ Tam | AES-256-GCM şifreleme |
| CSRF Koruması | `csrf.ts` | ✅ Tam | Cross-site request forgery koruması |
| PKCE | `pkce.ts` | ✅ Tam | OAuth PKCE akışı |
| REST Middleware | `rest-middleware.ts` | ✅ Tam | İstek arakatmanı |
| Browser Launcher | `browser-launcher.ts` | ✅ Tam | Tarayıcı başlatma |
| Webview Bootstrap | `webview-bootstrap.ts` | ✅ Tam | VS Code webview |
| Oturum Yönetimi | `autonomy-session-manager.ts` | ✅ Tam | Otonom oturum yönetimi |
| Agent Handoff | `agent-handoff.ts` | ✅ Tam | Ajan devri |

**Eksiklikler:**
- WebSocket bağlantı yönetimi daha robust olmalı
- Health check mekanizması genişletilmeli

### Bölüm 3: Orkestrasyon Katmanı (`src/orchestration/`)
**Tamamlanma: %70 | Kalite: 7/10**

| Modül | Dosya | Durum | Açıklama |
|-------|-------|-------|----------|
| Orkestratör Servisi | `OrchestratorService.ts` | ✅ Tam | Merkezi orkestrasyon |
| Otonom Döngü Motoru | `autonomous-loop-engine.ts` | ✅ Tam | State machine (queued→init→plan→execute→verify→reflect→done) |
| Faz Motoru | `PhaseEngine.ts` | ✅ Tam | Aşama yönetimi |
| Dişli Motoru | `GearEngine.ts` | ✅ Tam | İşlem dişlileri |
| Kapı Motoru | `GateEngine.ts` | ✅ Tam | Koşul kapıları |
| Yetenek Motoru | `SkillEngine.ts` | ✅ Tam | Beceri yönetimi |
| Model Seçici | `model-selector.ts` | ✅ Tam | Model seçim stratejisi |
| Niyet Sınıflandırıcı | `intent-classifier.ts` | ✅ Tam | Intent analizi |
| Niyet Dönüştürücü | `intent-transformer.ts` | ✅ Tam | Intent mapping |
| Bütçe Takipçi | `BudgetTracker.ts` | ✅ Tam | Token bütçe yönetimi |
| Görev Grafiği | `TaskGraphManager.ts` | ✅ Tam | Görev bağımlılıkları |
| Oturum Süreklilik | `SessionPersistenceManager.ts` | ✅ Tam | Oturum kalıcılığı |
| Pipeline Araçları | `pipeline-tools.ts` | ✅ Tam | Araç tanımları |
| Sıralı Pipeline | `sequential-pipeline.ts` | ✅ Tam | Adımsal yürütme |
| Terminal Yürütücü | `terminal-executor.ts` | ✅ Tam | Komut çalıştırma |
| Doğrulama Motoru | `verification-engine.ts` | ✅ Tam | Sonuç doğrulama |
| Keşif Ajanı | `discovery-agent.ts` | ✅ Tam | Proje keşfi |
| Antigravity İstemcisi | `antigravity-client.ts` | ✅ Tam | API istemcisi |
| RARV Motoru | `rarv-engine.ts` | ⚠️ Kısmi | Risk analizi |
| Egemen Yürütücü | `sovereign-executor.ts` | ⚠️ Kısmi | Yerel yürütme |

**Eksiklikler:**
- 18 ajan tanımlı ama çoğu sadece iskelet
- RARV motoru tamamlanmamış
- Agent'lar arası iletişim standardize edilmemiş
- Event bus daha zayıf implementation

### Bölüm 4: Kalıcılık Katmanı (`src/persistence/`)
**Tamamlanma: %80 | Kalite: 8/10**

| Modül | Dosya | Durum |
|-------|-------|-------|----------|
| Veritabanı | `database.ts` | ✅ Tam |
| Misyon Deposu | `SQLiteMissionRepository.ts` | ✅ Tam |
| Misyon Abonesi | `MissionPersistenceSubscriber.ts` | ✅ Tam |
| Migrasyonlar | `migrations/` | ✅ Tam |
| Kurtarma | `recovery/` | ✅ Tam |

### Bölüm 5: Servisler ve Modeller (`src/services/`, `src/models/`)
**Tamamlanma: %65 | Kalite: 7/10**

| Modül | Durum | Açıklama |
|-------|-------|----------|
| Mission Runtime | ⚠️ Kısmi | Görev çalışma zamanı |
| Mission Service | ⚠️ Kısmi | Görev servisi |
| Mission Model | ✅ Tam | Veri modeli |

### Bölüm 6: Yetenekler (`src/skills/`)
**Tamamlanma: %50 | Kalite: 6/10**

| Modül | Durum |
|-------|-------|
| AST İndeksleyici | ⚠️ Kısmi |
| Sandbox Yöneticisi | ⚠️ Kısmi |
| Self-Healing | ⚠️ Kısmi |

### Bölüm 7: UI ve VS Code Extension
**Tamamlanma: %40 | Kalite: 5/10**

UI tasarım planı mevcut ama implementasyon eksik. VS Code extension iskelet halinde.

---

## 3. AI-STACK-MCP PROJESİ BÖLÜMLENDİRMESİ

### Bölüm 1: Önbellek Sistemi (`cache/`)
**Tamamlanma: %85 | Kalite: 9/10**

| Modül | Dosya | Durum | Kalite |
|-------|-------|-------|--------|
| Exact Cache (L1) | `exact.py` | ✅ Tam (%95) | 9/10 |
| Semantic Cache (L2) | `semantic.py` | ✅ Tam (%85) | 8/10 |
| Partial Cache (L3) | `partial.py` | ✅ Tam (%80) | 7/10 |

**Exact Cache:** Memory LRU + SQLite Disk, thread-safe, TTL desteği, sub-millisecond lookup.  
**Semantic Cache:** ChromaDB vektör tabanlı, cosine similarity, TTL, boyut filtresi.  
**Partial Cache:** Exact + Semantic hibrit, fuzzy matching.

**Eksiklikler:**
- Semantic cache için embedding model bağımlılığı güçlü (Ollama gerekli)
- Partial cache fallback mantığı iyileştirilmeli
- Distributed cache desteği yok

### Bölüm 2: Temizleme Katmanı (`cleaning/`)
**Tamamlanma: %75 | Kalite: 7/10**

| Modül | Dosya | Durum | Kalite |
|-------|-------|-------|--------|
| CLI Cleaner | `cli_cleaner.py` | ✅ Tam (%90) | 8/10 |
| Deduplicator | `dedup.py` | ✅ Tam (%85) | 8/10 |
| Noise Filter | `noise_filter.py` | ✅ Tam (%80) | 7/10 |
| Summarizer | `summarizer.py` | ⚠️ Kısmi (%60) | 6/10 |

**CLI Cleaner:** ANSI escape, prompt header, tekrar eden boşluk temizleme.  
**Deduplicator:** Hash tabanlı kod bloğu tekilleştirme, 4 MB pencere.  
**Noise Filter:** Regex tabanlı gürültü temizleme (TODO, FIXME vb.).  
**Summarizer:** Ollama tabanlı konuşma özetleme — Ollama gerekli, yoksa pas geçiliyor.

**Eksiklikler:**
- Summarizer Ollama bağımlı — fallback mekanizması zayıf
- Noise filter Türkçe/çok dilli destek eksik
- Daha gelişmiş NLP temizleme kuralları eklenebilir

### Bölüm 3: Sıkıştırma Katmanı (`compression/`)
**Tamamlanma: %60 | Kalite: 6/10**

| Modül | Dosya | Durum | Kalite |
|-------|-------|-------|--------|
| LLMLingua | `llmlingua.py` | ⚠️ Kısmi (%55) | 5/10 |
| Caveman | `caveman.py` | ⚠️ Kısmi (%65) | 6/10 |

**LLMLingua:** Bölüm bazlı sıkıştırma, similarity oranları ile koruma.  
**Caveman:** Hash tabanlı benzersiz satır çıkarma + seçici sıkıştırma.

**Eksiklikler:**
- LLMLingua gerçek `llmlingua` kütüphane entegrasyonu eksik
- Caveman basit satır düzeyde çalışıyor, anlamsal sıkıştırma yok
- Her iki modül de üretim ortamında test edilmemiş
- Compression rate ayarları sabit — adaptif olmalı

### Bölüm 4: Pipeline Yönetimi (`pipeline/`)
**Tamamlanma: %80 | Kalite: 8/10**

| Modül | Dosya | Durum | Kalite |
|-------|-------|-------|--------|
| Orchestrator | `orchestrator.py` | ✅ Tam (%85) | 8/10 |
| Router | `router.py` | ✅ Tam (%90) | 8/10 |
| MAB | `mab.py` | ✅ Tam (%85) | 9/10 |
| Cost Tracker | `cost_tracker.py` | ✅ Tam (%80) | 7/10 |

**Router:** Mesaj sınıflandırma (cli_command, data_analysis, prose_reasoning, code_generation, query, local_answerable), karmaşıklık puanlama, model önerisi.  
**MAB:** Thompson Sampling Multi-Armed Bandit, katman seçim optimizasyonu, reward tracking.  
**Cost Tracker:** SQLite tabanlı maliyet kaydı, dönemsel raporlama.

**Eksiklikler:**
- Router'da daha fazla mesaj tipi eklenebilir
- Cost tracker gerçek fiyatlandırma verisi kullanmıyor (token tahmini approx.)
- MAB cold-start stratejisi iyileştirilmeli

### Bölüm 5: RAG Sistemi (`rag/`)
**Tamamlanma: %55 | Kalite: 6/10**

| Modül | Dosya | Durum | Kalite |
|-------|-------|-------|--------|
| İndeksleyici | `indexer.py` | ⚠️ Kısmi (%60) | 6/10 |
| Geri Kazanıcı | `retriever.py` | ⚠️ Kısmi (%50) | 5/10 |

**İndeksleyici:** ChromaDB tabanlı belge indeksleme, hash dedup.  
**Geri Kazanıcı:** Semantik arama, bağlam snippet oluşturma.

**Eksiklikler:**
- Embedding modeli Ollama bağımlı
- Chunking stratejisi basit (fixed-size)
- Re-ranking mekanizması yok
- Hybrid search (keyword + semantic) eksik

### Bölüm 6: Model Yönetimi (`models/`)
**Tamamlanma: %70 | Kalite: 7/10**

| Modül | Dosya | Durum | Kalite |
|-------|-------|-------|--------|
| Circuit Breaker | `circuit_breaker.py` | ✅ Tam (%85) | 8/10 |
| Ollama | `ollama.py` | ⚠️ Kısmi (%65) | 7/10 |
| OpenRouter | `openrouter.py` | ⚠️ Kısmi (%60) | 6/10 |

**Circuit Breaker:** Model cascade ile açık/kapalı devre yönetimi, timeout, failure tracking.  
**Ollama:** Yerel model çağırma, streaming.  
**OpenRouter:** API tabanlı model çağırma.

**Eksiklikler:**
- OpenRouter hata yönetimi zayıf
- Model performans karşılaştırma mekanizması yok
- Fallback zinciri daha akıllı olmalı

### Bölüm 7: Ajan Sistemi (`agent/`)
**Tamamlanma: %40 | Kalite: 5/10**

| Modül | Dosya | Durum | Kalite |
|-------|-------|-------|--------|
| Skill Manager | `skill_manager.py` | ⚠️ Kısmi (%45) | 5/10 |
| Workflow Engine | `workflow_engine.py` | ⚠️ Kısmi (%35) | 4/10 |
| Skills/ | `skills/` | ⚠️ İskelet | 3/10 |

**Eksiklikler:**
- Çoğu modül iskelet durumunda
- Yetenek kayıt/kullanma sistemi tamamlanmamış
- İş akışı tanımlama mekanizması eksik

### Bölüm 8: Altyapı
**Tamamlanma: %75 | Kalite: 7/10**

| Modül | Dosya | Durum |
|-------|-------|-------|
| MCP Server | `server.py` | ✅ Tam |
| Config | `config.py` | ✅ Tam |
| Metrics | `metrics.py` | ✅ Tam |
| Docker | `Dockerfile`, `docker-compose.yml` | ✅ Tam |
| Scripts | `scripts/` | ✅ Tam |

---

## 4. TAMAMLANMA DURUMU MATRİSİ

### AGENT Projesi
```
Plugin Katmanı        ████████████████████░  %90
Gateway Katmanı       █████████████████░░░░  %85
Orkestrasyon Katmanı  ██████████████░░░░░░░  %70
Kalıcılık Katmanı     ████████████████░░░░░  %80
Servisler/Modeller    █████████████░░░░░░░░  %65
Yetenekler            ██████████░░░░░░░░░░░  %50
UI/VS Code Extension  ████████░░░░░░░░░░░░░  %40
─────────────────────────────────────────────
GENEL ORTALAMA        ███████████████░░░░░░  %75
```

### ai-stack-mcp Projesi
```
Önbellek Sistemi      █████████████████░░░  %85
Temizleme Katmanı     ███████████████░░░░░  %75
Sıkıştırma Katmanı    ████████████░░░░░░░░  %60
Pipeline Yönetimi     ████████████████░░░░  %80
RAG Sistemi           ███████████░░░░░░░░░  %55
Model Yönetimi        ██████████████░░░░░░  %70
Ajan Sistemi          ████████░░░░░░░░░░░░  %40
Altyapı               ███████████████░░░░░  %75
─────────────────────────────────────────────
GENEL ORTALAMA        █████████████░░░░░░░  %60
```

---

## 5. ORTAK NOKTALAR VE SİNERJİ HARİTASI

### 5.1 Doğrudan Örtüşen Alanlar

| Fonksiyon | AGENT | ai-stack-mcp | Sinerji |
|-----------|-------|--------------|---------|
| **Önbellek** | Basit plugin cache (`cache.ts`) | 3 katmanlı cache (L1/L2/L3) | ai-stack-mcp'nin cache sistemi AGENT'e entegre edilmeli |
| **Model Seçimi** | `model-selector.ts`, `autonomy-model-router.ts` | `router.py`, `mab.py`, `circuit_breaker.py` | MAB + Thompson Sampling AGENT'in model seçimine eklenebilir |
| **Maliyet Takibi** | `BudgetTracker.ts` (token bütçe) | `cost_tracker.py` (token maliyet) | Birleşik maliyet/bütçe sistemi |
| **Hata Kurtarma** | `recovery.ts`, session recovery | Circuit breaker, graceful degradation | Çift yönlü kurtarma mekanizması |
| **Mesaj İşleme** | Request pipeline | Optimization pipeline | Ortak mesaj işleme hattı |
| **Ajan/Yetenek** | 18 ajan orkestrasyonu | Skill manager + workflow engine | AGENT'in ajan sistemi + ai-stack-mcp'nin yetenek sistemi |

### 5.2 Tamamlayıcı Alanlar (Birinde var, diğerinde yok)

| Özellik | Sahip Proje | Eksik Proje | Kazanç |
|---------|------------|------------|--------|
| OAuth 2.0 Kimlik Doğrulama | AGENT | ai-stack-mcp | MCP server güvenli auth kazanır |
| Çoklu Hesap Rotasyonu | AGENT | ai-stack-mcp | Load balancing iyileşir |
| Token Optimizasyonu | ai-stack-mcp | AGENT | %30-60 token tasarrufu |
| RAG Sistemi | ai-stack-mcp | AGENT | Belge tabanlı bağlam zenginleştirme |
| Mesaj Sıkıştırma | ai-stack-mcp | AGENT | Uzun konuşmalarda token tasarrufu |
| Otonom Görev Döngüsü | AGENT | ai-stack-mcp | Tam otonom çalışma |
| Gateway (HTTP/WS) | AGENT | ai-stack-mcp | Uzak erişim ve UI desteği |
| 18 Ajan Sistemi | AGENT | ai-stack-mcp | Uzmanlaşmış görev dağılımı |
| Thompson Sampling MAB | ai-stack-mcp | AGENT | Akıllı katman/model seçimi |
| Semantic Cache | ai-stack-mcp | AGENT | Akıllı önbellekleme |
| MCP Protokolü | ai-stack-mcp | AGENT | Claude Code entegrasyonu |
| VS Code Extension | AGENT | ai-stack-mcp | IDE entegrasyonu |

### 5.3 Sinerji Skoru

```
Önbellek Entegrasyonu        : ⭐⭐⭐⭐⭐ (5/5) — Mükemmel uyum
Model Seçimi Optimizasyonu   : ⭐⭐⭐⭐⭐ (5/5) — MAB + çoklu hesap
Token Optimizasyonu          : ⭐⭐⭐⭐☆ (4/5) — Büyük tasarruf potansiyeli
RAG + Ajan Entegrasyonu      : ⭐⭐⭐⭐☆ (4/5) — Bağlam zenginleştirme
Auth + MCP Güvenlik          : ⭐⭐⭐⭐☆ (4/5) — Güvenli MCP
Otonom Döngü + Pipeline      : ⭐⭐⭐⭐☆ (4/5) — Akıllı otomasyon
UI + Optimizasyon Dashboard  : ⭐⭐⭐☆☆ (3/5) — Görsel raporlama
```

---

## 6. DERİN KONTROL PLANI

### Aşama 1: Mevcut Durum Denetimi ✅

- [x] Proje yapılarının çıkarılması
- [x] Her modülün tamamlanma durumunun belirlenmesi
- [x] Kod kalitesi değerlendirmesi
- [x] Bağımlılık analizi
- [x] Dokümantasyon incelemesi

### Aşama 2: Entegrasyon Noktaları Analizi

#### Kontrol Noktası 2.1: API Uyumluluğu
- [ ] AGENT'in HTTP/WS API formatı ↔ MCP protokol uyumu
- [ ] Veri serileştirme: TypeScript ↔ Python JSON formatları
- [ ] Hata kodları standardizasyonu
- [ ] Authentication token formatları

#### Kontrol Noktası 2.2: Veri Akışı
- [ ] AGENT request → ai-stack-mcp optimize → API çağrısı akışı
- [ ] Cache invalidation senkronizasyonu
- [ ] State management (AGENT state ↔ MCP state)
- [ ] Event bus uyumluluğu

#### Kontrol Noktası 2.3: Dil Köprüsü
- [ ] TypeScript ↔ Python iletişim yöntemi (subprocess, HTTP, native bridge)
- [ ] Serileştirme performansı
- [ ] Hata yayılımı mekanizması
- [ ] Ortak yapılandırma formatı

### Aşama 3: Mimari Doğrulama

#### Kontrol Noktası 3.1: AGENT Modülleri
- [ ] Plugin.ts refactor gereksinimi (2139→~500 satır hedef)
- [ ] Gateway thread safety
- [ ] Orkestrasyon motoru performans analizi
- [ ] Veritabanı migrasyon bütünlüğü
- [ ] Test kapsama oranı (hedef: %80+)

#### Kontrol Noktası 3.2: ai-stack-mcp Modülleri
- [ ] ChromaDB bağlantı stabilitesi
- [ ] Ollama timeout yönetimi
- [ ] Compression kalitesi ölçümü
- [ ] RAG chunking stratejisi doğrulama
- [ ] MAB convergence testi

### Aşama 4: Birleştirilmiş Sistem Testi
- [ ] End-to-end akış testi (OAuth → Optimize → Model Call)
- [ ] Yük testi (100+ eşzamanlı istek)
- [ ] Hata senaryoları (ağ kesintisi, token expire, quota aşımı)
- [ ] Performans regresyon testi
- [ ] Güvenlik denetimi (token sızıntısı, CSRF, XSS)

---

## 7. BİRLEŞİM STRATEJİSİ

### Yaklaşım: "Hub-and-Spoke" Mikroservis Mimarisi

```
                    ┌─────────────────────┐
                    │    GATEWAY (TS)      │
                    │  Fastify HTTP/WS     │
                    │  Auth, Rate Limit    │
                    │  Multi-Account       │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
    │  PLUGIN (TS)   │  │ ORCHESTRATOR│  │  MCP BRIDGE │
    │  OpenCode API  │  │    (TS)     │  │   (Python)  │
    │  Model Config  │  │ 18 Agents   │  │             │
    │  Token Mgmt    │  │ Autonomous  │  └──────┬─────┘
    └────────────────┘  │ Loop Engine │         │
                        └──────┬──────┘         │
                               │                │
              ┌────────────────┼────────────────┤
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
    │ OPTIMIZATION   │  │   RAG      │  │   MODELS   │
    │   ENGINE       │  │  ENGINE    │  │  CASCADE   │
    │ (Python/MCP)   │  │ (Python)   │  │ (Python)   │
    │                │  │            │  │            │
    │ • Cache L1/L2  │  │ • Indexer  │  │ • Ollama   │
    │ • Cleaning     │  │ • Retriever│  │ • OpenRouter│
    │ • Compression  │  │ • Chunking │  │ • Circuit B.│
    │ • MAB          │  │            │  │            │
    └────────────────┘  └────────────┘  └────────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │     PERSISTENCE      │
                    │   SQLite + ChromaDB  │
                    └──────────────────────┘
```

### İletişim Protokolü
- **TypeScript ↔ Python:** HTTP REST API (Gateway üzerinden)
- **Plugin → Gateway:** OpenCode Plugin API
- **Gateway → MCP Bridge:** Internal HTTP (localhost)
- **MCP Bridge → Claude Code:** Stdio MCP Protocol

### 7.1 Birleştirme Adımları

#### Adım 1: MCP Bridge Oluşturma (1-2 gün)
- AGENT Gateway'e bir `/optimize` endpoint ekle
- ai-stack-mcp'yi subprocess olarak başlat
- HTTP REST bridge ile iletişim kur

#### Adım 2: Auth Entegrasyonu (2-3 gün)
- AGENT'in OAuth token'larını ai-stack-mcp'ye aktar
- Model erişimi için API key dağıtım mekanizması
- Multi-account rotasyonunu MCP bridge'e taşı

#### Adım 3: Pipeline Birleştirme (3-5 gün)
- AGENT'in request pipeline'ına optimizasyon katmanı ekle
- Cache hit olduğunda API çağrısını atla
- Model önerilerini AGENT'in model seçicisine entegre et

#### Adım 4: Orkestrasyon + MAB Entegrasyonu (3-5 gün)
- AGENT'in otonom döngüsüne token optimizasyon ekle
- MAB ile ajan görev dağılımını optimize et
- Budget tracker + cost tracker birleştirme

#### Adım 5: RAG Entegrasyonu (2-3 gün)
- AGENT'in belge analizine RAG ekle
- Proje bağlamını otomatik zenginleştir
- Keşif ajanı + RAG indeksleyici senkronizasyonu

#### Adım 6: UI ve Raporlama (2-3 gün)
- Token tasarruf dashboard'u
- Cache hit/miss görselleştirme
- Model performans karşılaştırma

---

## 8. BİRLEŞTİRİLMİŞ PROJE MİMARİSİ

### Proje Yapısı (Önerilen)

```
agent-stack/
├── gateway/                    # TypeScript — Fastify Gateway
│   ├── src/
│   │   ├── server.ts           # HTTP/WS sunucu
│   │   ├── auth/               # OAuth 2.0, PKCE, CSRF
│   │   ├── routes/             # REST API endpoint'leri
│   │   │   ├── optimize.ts     # → MCP Bridge
│   │   │   ├── models.ts       # Model listesi/yönetimi
│   │   │   ├── accounts.ts     # Hesap yönetimi
│   │   │   └── dashboard.ts    # UI endpoint'leri
│   │   ├── middleware/          # Rate limit, auth, logging
│   │   └── websocket/          # WS handler
│   ├── package.json
│   └── tsconfig.json
│
├── plugin/                     # TypeScript — OpenCode Plugin
│   ├── src/
│   │   ├── plugin.ts           # OpenCode API entegrasyonu
│   │   ├── accounts.ts         # Hesap havuzu
│   │   ├── rotation.ts         # Hesap rotasyonu
│   │   ├── token.ts            # Token yönetimi
│   │   └── config.ts           # Yapılandırma
│   ├── package.json
│   └── tsconfig.json
│
├── orchestrator/               # TypeScript — Görev Orkestrasyonu
│   ├── src/
│   │   ├── engine.ts           # Otonom döngü motoru
│   │   ├── agents/             # 18 uzman ajan
│   │   ├── phases/             # Faz yönetimi
│   │   ├── gates/              # Koşul kapıları
│   │   ├── skills/             # Yetenek sistemi
│   │   └── persistence/        # SQLite kalıcılık
│   ├── package.json
│   └── tsconfig.json
│
├── optimization/               # Python — Token Optimizasyon (MCP)
│   ├── server.py               # MCP Server (stdio)
│   ├── bridge.py               # HTTP Bridge (Gateway ile)
│   ├── config.py               # Pydantic Settings
│   ├── cache/                  # L1/L2/L3 önbellek
│   │   ├── exact.py
│   │   ├── semantic.py
│   │   └── partial.py
│   ├── cleaning/               # Mesaj temizleme
│   │   ├── cli_cleaner.py
│   │   ├── dedup.py
│   │   ├── noise_filter.py
│   │   └── summarizer.py
│   ├── compression/            # Sıkıştırma
│   │   ├── llmlingua.py
│   │   └── caveman.py
│   ├── pipeline/               # Pipeline yönetimi
│   │   ├── orchestrator.py
│   │   ├── router.py
│   │   ├── mab.py
│   │   └── cost_tracker.py
│   ├── rag/                    # RAG sistemi
│   │   ├── indexer.py
│   │   └── retriever.py
│   ├── models/                 # Model yönetimi
│   │   ├── circuit_breaker.py
│   │   ├── ollama.py
│   │   └── openrouter.py
│   ├── requirements.txt
│   └── pyproject.toml
│
├── ui/                         # React — Dashboard
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── pages/
│   └── package.json
│
├── vscode-extension/           # VS Code Extension
│   ├── src/
│   └── package.json
│
├── docker-compose.yml          # Tüm servisleri ayağa kaldırır
├── README.md
└── Makefile                    # Ortak komutlar
```

---

## 9. YOL HARİTASI

### Sprint 1 (Hafta 1-2): Temel Birleştirme
- [ ] MCP Bridge HTTP endpoint oluşturma
- [ ] Gateway'den MCP'ye istek akışı
- [ ] Temel auth entegrasyonu
- [ ] Docker Compose birleştirme

### Sprint 2 (Hafta 3-4): Pipeline Entegrasyonu
- [ ] Request pipeline'a optimizasyon katmanı ekleme
- [ ] Cache entegrasyonu (AGENT cache → MCP cache)
- [ ] Model seçimi birleştirme (MAB + çoklu hesap)
- [ ] Maliyet/bütçe takip birleştirme

### Sprint 3 (Hafta 5-6): Gelişmiş Özellikler
- [ ] RAG entegrasyonu
- [ ] Orkestrasyon + optimizasyon senkronizasyonu
- [ ] Compression pipeline aktifleştirme
- [ ] Ajan yetenek sistemi genişletme

### Sprint 4 (Hafta 7-8): UI ve Polish
- [ ] Dashboard UI
- [ ] Token tasarruf raporlama
- [ ] VS Code extension güncelleme
- [ ] Dokümantasyon

### Sprint 5 (Hafta 9-10): Test ve Yayın
- [ ] End-to-end test suite
- [ ] Performans optimizasyonu
- [ ] Güvenlik denetimi
- [ ] v1.0.0 release

---

## 10. RİSK DEĞERLENDİRMESİ

| Risk | Olasılık | Etki | Azaltma |
|------|----------|------|---------|
| TypeScript ↔ Python iletişim gecikmesi | Orta | Yüksek | Async HTTP, connection pooling |
| ChromaDB kararsızlığı | Düşük | Orta | Fallback SQLite vektör arama |
| Ollama bağımlılığı (summarizer/embedding) | Yüksek | Orta | Cloud API fallback (OpenRouter) |
| Plugin.ts refactor regresyonu | Orta | Yüksek | Kademeli refactor, test coverage |
| Auth token sızıntısı | Düşük | Kritik | AES-256-GCM, environment isolation |
| Docker Compose karmaşıklığı | Orta | Düşük | Health check, restart policy |
| Test coverage eksikliği | Yüksek | Orta | Her sprint'te %10 artış hedefi |

---

## SONUÇ

**AGENT** ve **ai-stack-mcp** projeleri birbirini mükemmel tamamlayan iki parça:
- AGENT güçlü auth, gateway ve orkestrasyon sunuyor
- ai-stack-mcp akıllı optimizasyon, caching ve RAG getiriyor

Birleşik proje, **"AI Agent Platform"** olarak konumlandırılabilir:
> Kimlik doğrulama + Token optimizasyonu + Akıllı model seçimi + Otonom görev yürütme + RAG destekli bağlam + Çoklu hesap yönetimi

Bu birleşimle **%30-60 token tasarrufu**, **daha akıllı model seçimi** ve **tam otomatik yazılım üretim hattı** hedeflenmektedir.