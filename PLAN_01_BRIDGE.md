# Plan 01 — Python Bridge: %95 → %100

## Mevcut Durum
Tüm kritik buglar düzeltildi. Kalan iş: test suite'i geçirmek ve
`chromadb` versiyon çakışmasını çözmek.

## Kabul Kriterleri
```bash
cd core/bridge
pip install -r requirements.txt   # hata yok
python server.py                  # başlıyor, crash yok (Ctrl+C ile kapat)
pytest tests/ -x -q               # 0 failure
```

---

## Görev 1 — chromadb versiyon pinini gevşet

**Dosya:** `core/bridge/requirements.txt`

**Sorun:** `chromadb==0.5.3` sabit pin — lancedb, pyarrow ve diğer
paketlerle bağımlılık çakışması riski var. `0.5.x` API'si değişmedi,
ama pip resolver çakışma yaşıyor.

**Düzeltme:**
```
# ÖNCE:
chromadb==0.5.3

# SONRA:
chromadb>=0.5.3,<0.7.0
```

---

## Görev 2 — aiohttp requirements'a ekle (bridge.py için)

**Dosya:** `core/bridge/requirements.txt`

**Sorun:** `bridge.py` başlangıçta `aiohttp`'yu import ediyor ve
bulamazsa `sys.exit(1)` yapıyor. `dependencies.py` bunu "optional"
olarak işaretliyor — bu yanıltıcı.

**Kontrol:** `requirements.txt`'de `aiohttp>=3.9.0` zaten mevcut.
Sadece `dependencies.py` L44'teki `("aiohttp", False, ...)` satırını
`True` yap:

**Dosya:** `core/bridge/dependencies.py` — satır 44:
```python
# ÖNCE:
("aiohttp", False, "HTTP bridge server"),

# SONRA:
("aiohttp", True, "HTTP bridge server (bridge.py requires it)"),
```

---

## Görev 3 — Test hatalarını düzelt

**Çalıştır:**
```bash
cd core/bridge
pip install -r requirements.txt
pytest tests/ -x -q 2>&1 | head -60
```

**Beklenen başarısız testleri düzelt.** Bilinen riskler:

### 3a. `tests/test_mab.py` — `LinUCBAgent` referansı
Eski test dosyaları hâlâ `LinUCBAgent` import ediyor olabilir.
Kontrol et, `BayesianTSAgent` ile değiştir:

```bash
grep -n "LinUCBAgent\|LinUCB" tests/test_mab.py
```

Bulursan:
```python
# ÖNCE:
from pipeline.mab import LinUCBAgent
agent = LinUCBAgent(settings)

# SONRA:
from pipeline.mab import BayesianTSAgent
agent = BayesianTSAgent(settings)
```

### 3b. `tests/test_mab.py` — `select_layers` çağrısı
Eski imzayı kullanıyor olabilir:
```python
# ÖNCE (eski imza):
layers = await agent.select_layers("some message", [{"content": "ctx"}])

# SONRA (yeni imza):
layers = await agent.select_layers(
    ["exact_cache", "semantic_cache", "compression"],
    {"intent_code": 0, "prompt_tokens": 50, "has_code": False, "history_depth": 2}
)
```

### 3c. `tests/test_router.py` — import yolu
```bash
grep -n "from pipeline.mab\|from models" tests/test_router.py
```

### 3d. `tests/test_cache.py` — ChromaDB bağlantısı
Semantic cache testleri ChromaDB bağlantısı gerektirebilir.
Bağlantı yoksa skip ile işaretle:
```python
import pytest
pytestmark = pytest.mark.skipif(
    not _chromadb_available(),
    reason="ChromaDB not available in CI"
)
```

---

## Görev 4 — `router.py` structlog import düzelt

**Dosya:** `core/bridge/pipeline/router.py` — satır 13:
```python
# ÖNCE:
import logging
logger = logging.getLogger(__name__)

# SONRA (projenin geri kalanıyla tutarlı):
import structlog
logger = structlog.get_logger(__name__)
```

---

## Görev 5 — `server.py` health endpoint ekle

**Dosya:** `core/bridge/server.py`

Bridge `server.py` MCP stdio sunucu. HTTP health endpoint'i
`bridge.py`'de zaten mevcut (`GET /health`). Kontrol et:

```bash
grep -n "health\|/health" bridge.py
```

Eksikse `bridge.py`'ye ekle:
```python
async def health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "service": "alloy-bridge"})

# app.router.add_get("/health", health) satırının mevcut olduğunu doğrula
```

---

## Son Kontrol Listesi
- [ ] `pip install -r requirements.txt` hata yok
- [ ] `python server.py` başlıyor, crash yok
- [ ] `pytest tests/ -x -q` geçiyor
- [ ] `python bridge.py &` → `curl http://localhost:9100/health` → `{"status":"ok"}`
