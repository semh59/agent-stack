# Plan 06 — Altyapı: %70 → %100

## Mevcut Durum
- Gateway ve Bridge ECS'de tanımlı ✅
- Bridge secrets sadece `openrouter_key_arn` + `bridge_secret_arn` kapsıyor ❌
- Provider API key'leri (Groq, Cerebras, vb.) Secrets Manager'da yok ❌
- Bridge health check endpoint `/ready` bekleniyor ama gerçek implementation eksik ❌
- Staging ortamında Bridge aynı eksiklikleri paylaşıyor ❌
- `docker-compose.unified.yml` provider API key ortam değişkenlerini geçirmiyor ❌

## Kabul Kriterleri
```bash
cd infra/terraform/envs/production
terraform validate      # hata yok
terraform plan          # değişiklik planı mantıklı

# Docker compose:
docker compose -f infra/docker/docker-compose.unified.yml config   # parse hata yok
```

---

## Görev 1 — Bridge `/health` ve `/ready` endpoint'lerini doğrula

**Dosya:** `core/bridge/bridge.py`

Mevcut endpoint'leri kontrol et:
```bash
grep -n "health\|ready\|/health\|/ready" core/bridge/bridge.py
```

### 1a. `/health` (liveness) — sadece "ayakta mı?"
```python
async def health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "service": "alloy-bridge"})
```

### 1b. `/ready` (readiness) — pipeline initialize oldu mu?
```python
async def ready(request: web.Request) -> web.Response:
    orch = await _get_orch()
    if orch.is_ready:
        return web.json_response({"status": "ready"})
    return web.json_response({"status": "initializing"}, status=503)
```

### 1c. Router'a kayıt et (bridge.py'de `app = web.Application()` satırının altına):
```python
app.router.add_get("/health", health)
app.router.add_get("/ready",  ready)
```

---

## Görev 2 — Terraform variables.tf — tüm provider key'lerini ekle

### 2a. Production variables
**Dosya:** `infra/terraform/envs/production/variables.tf`

Mevcut değişkenlere ekle:
```hcl
# Provider API Keys — Secrets Manager ARN'leri
variable "groq_api_key_arn"       { type = string; default = "" }
variable "cerebras_api_key_arn"   { type = string; default = "" }
variable "sambanova_api_key_arn"  { type = string; default = "" }
variable "mistral_api_key_arn"    { type = string; default = "" }
variable "deepseek_api_key_arn"   { type = string; default = "" }
variable "together_api_key_arn"   { type = string; default = "" }
variable "fireworks_api_key_arn"  { type = string; default = "" }
variable "google_api_key_arn"     { type = string; default = "" }
variable "anthropic_api_key_arn"  { type = string; default = "" }
```

### 2b. Aynısını staging için
**Dosya:** `infra/terraform/envs/staging/variables.tf`

---

## Görev 3 — Terraform IAM policy — yeni secret ARN'leri ekle

**Dosya:** `infra/terraform/envs/production/main.tf`

`data "aws_iam_policy_document" "secrets_read"` bloğunu güncelle:

```hcl
data "aws_iam_policy_document" "secrets_read" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      var.gateway_auth_token_arn,
      var.bridge_secret_arn,
      var.claude_api_key_arn,
      var.openrouter_key_arn,
      var.groq_api_key_arn,
      var.cerebras_api_key_arn,
      var.sambanova_api_key_arn,
      var.mistral_api_key_arn,
      var.deepseek_api_key_arn,
      var.together_api_key_arn,
      var.fireworks_api_key_arn,
      var.google_api_key_arn,
      var.anthropic_api_key_arn,
    ])
  }
}
```

> `compact()` boş string'leri filtreler — isteğe bağlı key'ler için güvenli.

---

## Görev 4 — Bridge ECS module secrets — tüm provider key'leri

**Dosya:** `infra/terraform/envs/production/main.tf`

`module "bridge"` içindeki `secrets` bloğunu genişlet:

```hcl
module "bridge" {
  # ... mevcut alanlar ...
  
  secrets = {
    ALLOY_BRIDGE_SECRET          = var.bridge_secret_arn
    ALLOY_OPENROUTER_API_KEY     = var.openrouter_key_arn
    # Yeni — isteğe bağlı: boş ise module içinde skip edilmeli
    ALLOY_GROQ_API_KEY           = var.groq_api_key_arn
    ALLOY_CEREBRAS_API_KEY       = var.cerebras_api_key_arn
    ALLOY_SAMBANOVA_API_KEY      = var.sambanova_api_key_arn
    ALLOY_MISTRAL_API_KEY        = var.mistral_api_key_arn
    ALLOY_DEEPSEEK_API_KEY       = var.deepseek_api_key_arn
    ALLOY_TOGETHER_API_KEY       = var.together_api_key_arn
    ALLOY_FIREWORKS_API_KEY      = var.fireworks_api_key_arn
    ALLOY_GOOGLE_API_KEY         = var.google_api_key_arn
    ALLOY_ANTHROPIC_API_KEY      = var.anthropic_api_key_arn
  }
}
```

**Not:** ECS `secrets` bloğu boş string ARN geçilemez. `modules/ecs-service/main.tf`
içinde `dynamic` block ile boş değerleri filtrele:

**Dosya:** `infra/terraform/modules/ecs-service/main.tf` — container_definitions içinde:
```hcl
secrets = [
  for k, v in var.secrets : {
    name      = k
    valueFrom = v
  }
  if v != ""
]
```

---

## Görev 5 — Bridge health check → ECS target group

**Dosya:** `infra/terraform/envs/production/main.tf`

Bridge için LB target group yoksa (şu an `target_group_arn = ""`) ama
ECS health check yine de tanımlanmalı. `modules/ecs-service/main.tf`
içinde task definition health check ekle:

```hcl
# modules/ecs-service/main.tf — container_definitions içinde:
healthCheck = {
  command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port}/ready || exit 1"]
  interval    = 30
  timeout     = 5
  retries     = 3
  startPeriod = 60
}
```

---

## Görev 6 — docker-compose.unified.yml — provider key'leri ekle

**Dosya:** `infra/docker/docker-compose.unified.yml`

`optimization-bridge` service `environment` bloğunu genişlet:
```yaml
services:
  optimization-bridge:
    environment:
      APP_ENV: "${APP_ENV:-development}"
      ALLOY_DATA_DIR: "/data"
      LOG_LEVEL: "${LOG_LEVEL:-INFO}"
      ALLOY_BRIDGE_SECRET: "${BRIDGE_SECRET:-}"
      # Provider keys — .env dosyasından okunur
      ALLOY_ANTHROPIC_API_KEY:  "${ANTHROPIC_API_KEY:-}"
      ALLOY_OPENAI_API_KEY:     "${OPENAI_API_KEY:-}"
      ALLOY_GOOGLE_API_KEY:     "${GOOGLE_API_KEY:-}"
      ALLOY_GROQ_API_KEY:       "${GROQ_API_KEY:-}"
      ALLOY_CEREBRAS_API_KEY:   "${CEREBRAS_API_KEY:-}"
      ALLOY_SAMBANOVA_API_KEY:  "${SAMBANOVA_API_KEY:-}"
      ALLOY_MISTRAL_API_KEY:    "${MISTRAL_API_KEY:-}"
      ALLOY_DEEPSEEK_API_KEY:   "${DEEPSEEK_API_KEY:-}"
      ALLOY_TOGETHER_API_KEY:   "${TOGETHER_API_KEY:-}"
      ALLOY_FIREWORKS_API_KEY:  "${FIREWORKS_API_KEY:-}"
      ALLOY_OPENROUTER_API_KEY: "${OPENROUTER_API_KEY:-}"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9100/ready"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s
```

---

## Görev 7 — `.env.example` dosyası oluştur

**Oluştur:** `infra/env/.env.example`

```bash
# Alloy Platform — Ortam Değişkenleri
# Bu dosyayı kopyala: cp .env.example .env
# Sonra kendi key'lerinle doldur

# Gateway
GATEWAY_AUTH_TOKEN=change_me_random_32_chars
BRIDGE_SECRET=change_me_random_32_chars
GATEWAY_PORT=3000

# Deployment
APP_ENV=development    # development | staging | production

# Provider API Keys (hepsi isteğe bağlı — en az 1 gerekli)
# Tier 0 (her zaman aktif — key gerekmez):
OLLAMA_URL=http://localhost:11434

# Tier 1 — Groq (315 TPS, ücretsiz)
GROQ_API_KEY=

# Tier 1 — Cerebras (1M token/gün, ücretsiz)
CEREBRAS_API_KEY=

# Tier 1 — SambaNova (ücretsiz)
SAMBANOVA_API_KEY=

# Tier 2 — Gemini Flash (ücretsiz)
GOOGLE_API_KEY=

# Tier 2 — Mistral (ücretsiz)
MISTRAL_API_KEY=

# Tier 3 — OpenRouter (~30 ücretsiz model)
OPENROUTER_API_KEY=

# Tier 4 — DeepSeek (ucuz)
DEEPSEEK_API_KEY=

# Tier 4 — Together AI
TOGETHER_API_KEY=

# Tier 4 — Fireworks AI
FIREWORKS_API_KEY=

# Tier 5 — Anthropic Claude (ücretli, son çare)
ANTHROPIC_API_KEY=

# Tier 5 — OpenAI (ücretli)
OPENAI_API_KEY=
```

---

## Görev 8 — Staging ortamını production ile senkronize et

**Dosya:** `infra/terraform/envs/staging/main.tf`

Production'da yapılan tüm değişiklikleri staging'e de uygula
(Görev 3, 4, 5 — aynı pattern, sadece `local.env = "staging"`).

---

## Son Kontrol Listesi
- [ ] `bridge.py` → `/health` (200) ve `/ready` (200|503) endpoint mevcut
- [ ] `terraform validate` production → hata yok
- [ ] `terraform validate` staging → hata yok
- [ ] Bridge ECS module — tüm provider secret'lar tanımlı
- [ ] IAM policy — tüm secret ARN'leri kapsıyor
- [ ] `docker-compose.unified.yml` → tüm env key'leri geçiyor
- [ ] `.env.example` mevcut, tüm key'ler belgelenmiş
- [ ] `docker compose ... config` parse hata yok
