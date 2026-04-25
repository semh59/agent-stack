# Alloy AI Platform

A polyglot monorepo that packages an AI gateway, a prompt-optimization bridge, and supporting services into a single deployable stack.

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Alloy AI Platform                      │
│                                                                      │
│  ┌────────────────┐     HTTP     ┌──────────────────────────────┐    │
│  │    Clients     │ ───────────► │   Gateway (TypeScript)        │    │
│  │  (VSCode, CLI, │              │   Fastify  ·  port 3000       │    │
│  │  Web UI)       │ ◄─────────── │   OAuth (Google / Claude)     │    │
│  └────────────────┘              │   Mission orchestration        │    │
│                                  └────────────┬──────────────────┘    │
│                                               │ HTTP + X-Bridge-Secret │
│                                               ▼                        │
│                                  ┌──────────────────────────────┐    │
│                                  │ Optimization Bridge (Python) │    │
│                                  │ aiohttp  ·  port 9100        │    │
│                                  │ ┌──────────────────────────┐ │    │
│                                  │ │  Pipeline Orchestrator   │ │    │
│                                  │ │ ─ Cache (exact/semantic) │ │    │
│                                  │ │ ─ MAB (Thompson)         │ │    │
│                                  │ │ ─ Compression (LLMLingua)│ │    │
│                                  │ │ ─ RAG (Lance + Chroma)   │ │    │
│                                  │ │ ─ ModelCascade + CB      │ │    │
│                                  │ └────────────┬─────────────┘ │    │
│                                  └──────────────┼────────────────┘    │
│                                      ┌──────────┴──────────┐          │
│                                      ▼                     ▼          │
│                              ┌──────────────┐      ┌──────────────┐   │
│                              │   Ollama     │      │  OpenRouter  │   │
│                              │  (local)     │      │   (cloud)    │   │
│                              └──────────────┘      └──────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## Components

| Path                      | Language          | Role                                                                |
|---------------------------|-------------------|---------------------------------------------------------------------|
| `core/gateway/`           | TypeScript (Node) | Fastify gateway, OAuth, mission orchestration, WebSocket UI bridge  |
| `interface/console/`      | React + Vite      | Dashboard webview                                                   |
| `interface/extension/`    | TypeScript        | VS Code extension host (packaging target)                           |
| `core/bridge/`            | Python 3.11       | MCP server + HTTP optimization bridge + all pipeline stages         |
| `infra/terraform/`        | HCL               | AWS ECS Fargate IaC, split into reusable modules + per-env entries  |
| `tools/`                  | Shell + Python    | `dev-runner.js`, `smoke.sh`, `smoke_test.py`                        |
| `env/`                    | dotenv            | Per-env config templates (`.env.development`, `staging`, `production`) |

Full details: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quickstart (local dev)

**Prerequisites:** Node 20+, Python 3.11+, (optional) Docker & Docker Compose.

```bash
# 1. Copy a dev env file and fill in any empty values
cp env/.env.development .env
export $(cat .env | grep -v '^#' | xargs)

# 2. Install gateway deps
cd core/gateway && npm ci && cd ../..

# 3. Install bridge deps
cd core/bridge && pip install -e . && cd ../..

# 4. Boot the whole stack (bridge + gateway, labelled logs)
node tools/dev-runner.js
```

Gateway listens on `http://127.0.0.1:3000`, bridge on `http://127.0.0.1:9100`.

## Quickstart (Docker)

```bash
export GATEWAY_AUTH_TOKEN=$(openssl rand -hex 32)
export BRIDGE_SECRET=$(openssl rand -hex 32)
export APP_ENV=development
docker compose -f infra/docker/docker-compose.unified.yml up --build -d gateway optimization-bridge
```

For the full profile (adds Ollama + caveman compression):

```bash
docker compose -f infra/docker/docker-compose.unified.yml --profile full up -d
```

## Testing

```bash
# Python — unit + contract tests (skips integration that need Ollama)
cd core/bridge && python3 -m pytest -q -m "not integration"

# End-to-end smoke against a locally booted bridge
bash tools/smoke.sh

# TypeScript — typecheck and targeted vitest subset
cd core/gateway && npm run typecheck
npx vitest run --reporter=basic src/gateway/ src/middleware/
```

CI runs all three in GitHub Actions; see [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Configuration

Environment variables are grouped by layer. Templates live in `env/`:

- `env/.env.development` — safe defaults, no secrets
- `env/.env.staging` — injected from AWS Secrets Manager in staging
- `env/.env.production` — injected from AWS Secrets Manager in production

**Critical variables** (see `env/.env.production` for the full list):

| Name | Owner | Required in | Purpose |
|------|-------|-------------|---------|
| `ALLOY_GATEWAY_TOKEN` | gateway | always | Bearer token clients must present |
| `ALLOY_BRIDGE_SECRET` | bridge + gateway | **staging/prod** | Shared secret for bridge auth |
| `APP_ENV` | both | always | `development`/`staging`/`production` — gates dev-only fallbacks |
| `BRIDGE_CORS_ORIGIN` | bridge | prod | Allowed origin for CORS |
| `ALLOY_OPENROUTER_API_KEY` | bridge | optional | Cloud LLM fallback |
| `CLAUDE_API_KEY` | gateway | optional | Direct Claude provider |

In `APP_ENV=staging` or `production` the bridge **refuses to boot** (exit 78 — EX_CONFIG) if `ALLOY_BRIDGE_SECRET` is empty. In `development` a one-time ephemeral secret is generated and logged.

## Deployment

Target platform: **AWS ECS Fargate** behind an Application Load Balancer.

```bash
cd infra/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars   # fill in VPC, image tags, secret ARNs
terraform init
terraform plan
terraform apply
```

See [infra/terraform/README.md](infra/terraform/README.md) for the full layout and the ARNs you need to pre-create in Secrets Manager.
playbook that keeps the console coherent.

## Further docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture and data flow
- [docs/API.md](docs/API.md) — HTTP contract for the bridge and gateway
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — deploy, rollback, incident response
- [docs/SETTINGS.md](docs/SETTINGS.md) — settings service contract and PATCH semantics
- [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md) — console architecture map
- [docs/CONSOLE_UX.md](docs/CONSOLE_UX.md) — UX playbook for the Alloy console
- [docs/PLATFORM_PLAN.md](docs/PLATFORM_PLAN.md) — CTO-level UX/architecture plan
- [PRODUCTION_GAP_ANALYSIS.md](PRODUCTION_GAP_ANALYSIS.md) — initial gap audit
- [PRODUCTION_TASK_PLAN.md](PRODUCTION_TASK_PLAN.md) — remediation plan driving this work
