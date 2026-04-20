# Sovereign AI Platform

A polyglot monorepo that packages an AI gateway, a prompt-optimization bridge, and supporting services into a single deployable stack.

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Sovereign AI Platform                      │
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

| Path                 | Language          | Role                                                                |
|----------------------|-------------------|---------------------------------------------------------------------|
| `AGENT/`             | TypeScript (Node) | Fastify gateway, OAuth, mission orchestration, WebSocket UI bridge  |
| `AGENT/ui/`          | React + Vite      | Dashboard webview                                                   |
| `AGENT/vscode-extension/` | TypeScript   | VS Code extension host (packaging target)                           |
| `ai-stack-mcp/`      | Python 3.11       | MCP server + HTTP optimization bridge + all pipeline stages         |
| `terraform/`         | HCL               | AWS ECS Fargate IaC, split into reusable modules + per-env entries  |
| `scripts/`           | Shell + Python    | `dev-runner.js`, `smoke.sh`, `smoke_test.py`                        |
| `env/`               | dotenv            | Per-env config templates (`.env.development`, `staging`, `production`) |

Full details: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quickstart (local dev)

**Prerequisites:** Node 20+, Python 3.11+, (optional) Docker & Docker Compose.

```bash
# 1. Copy a dev env file and fill in any empty values
cp env/.env.development .env
export $(cat .env | grep -v '^#' | xargs)

# 2. Install gateway deps
cd AGENT && npm ci && cd ..

# 3. Install bridge deps
cd ai-stack-mcp && pip install -e . && cd ..

# 4. Boot the whole stack (bridge + gateway, labelled logs)
node scripts/dev-runner.js
```

Gateway listens on `http://127.0.0.1:3000`, bridge on `http://127.0.0.1:9100`.

## Quickstart (Docker)

```bash
export GATEWAY_AUTH_TOKEN=$(openssl rand -hex 32)
export BRIDGE_SECRET=$(openssl rand -hex 32)
export APP_ENV=development
docker compose -f docker-compose.unified.yml up --build -d gateway optimization-bridge
```

For the full profile (adds Ollama + caveman compression):

```bash
docker compose -f docker-compose.unified.yml --profile full up -d
```

## Testing

```bash
# Python — unit + contract tests (skips integration that need Ollama)
cd ai-stack-mcp && python3 -m pytest -q -m "not integration"

# End-to-end smoke against a locally booted bridge
bash scripts/smoke.sh

# TypeScript — typecheck and targeted vitest subset
cd AGENT && npm run typecheck
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
| `SOVEREIGN_GATEWAY_TOKEN` | gateway | always | Bearer token clients must present |
| `AI_STACK_BRIDGE_SECRET` | bridge + gateway | **staging/prod** | Shared secret for bridge auth |
| `APP_ENV` | both | always | `development`/`staging`/`production` — gates dev-only fallbacks |
| `BRIDGE_CORS_ORIGIN` | bridge | prod | Allowed origin for CORS |
| `AI_STACK_OPENROUTER_API_KEY` | bridge | optional | Cloud LLM fallback |
| `CLAUDE_API_KEY` | gateway | optional | Direct Claude provider |

In `APP_ENV=staging` or `production` the bridge **refuses to boot** (exit 78 — EX_CONFIG) if `AI_STACK_BRIDGE_SECRET` is empty. In `development` a one-time ephemeral secret is generated and logged.

## Deployment

Target platform: **AWS ECS Fargate** behind an Application Load Balancer.

```bash
cd terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars   # fill in VPC, image tags, secret ARNs
terraform init
terraform plan
terraform apply
```

See [terraform/README.md](terraform/README.md) for the full layout and the ARNs you need to pre-create in Secrets Manager.

## The Sovereign Console

The React console under `AGENT/ui/` is the primary interface for operators.
It exposes every environment variable, provider, route, MCP server, and
pipeline layer through a strongly-typed settings service — and ships with a
first-class chat surface wired to the optimization bridge.

- **Chat** (`/chat`) — conversation list, streaming messages, inline model
  picker, session cost footer.
- **Settings** (`/settings`) — Providers, Routing, Pipeline, MCP, Rules &
  Prompts, Observability, Data, Appearance.

Secrets (API keys, OAuth tokens, webhook secrets) are stored in SQLite using
AES-256-GCM envelope encryption. The master key comes from
`SOVEREIGN_MASTER_KEY` (32 bytes base64 or 64-char hex). In development, the
gateway synthesizes an ephemeral key so the dev loop isn't blocked; staging
and production refuse to start without one.

See [docs/SETTINGS.md](docs/SETTINGS.md) for the settings service contract,
[docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md) for the console's
architectural map, and [docs/CONSOLE_UX.md](docs/CONSOLE_UX.md) for the UX
playbook that keeps the console coherent.

## Further docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture and data flow
- [docs/API.md](docs/API.md) — HTTP contract for the bridge and gateway
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — deploy, rollback, incident response
- [docs/SETTINGS.md](docs/SETTINGS.md) — settings service contract and PATCH semantics
- [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md) — console architecture map
- [docs/CONSOLE_UX.md](docs/CONSOLE_UX.md) — UX playbook for the Sovereign console
- [docs/PLATFORM_PLAN.md](docs/PLATFORM_PLAN.md) — CTO-level UX/architecture plan
- [PRODUCTION_GAP_ANALYSIS.md](PRODUCTION_GAP_ANALYSIS.md) — initial gap audit
- [PRODUCTION_TASK_PLAN.md](PRODUCTION_TASK_PLAN.md) — remediation plan driving this work
