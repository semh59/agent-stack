# Phase 1 Walkthrough — Sovereign AI Platform Foundation

## What Was Built

### Deep Audit Findings (Pre-Build)
Audited every source file across both projects. Key findings that adjusted the plan:
- AGENT's autonomous loop engine (1312 lines) is **genuine production-quality** — promoted to crown jewel
- [request-helpers.ts](file:///d:/PROJECT/agent-stack/AGENT/src/plugin/request-helpers.ts) (92KB) was **missing from original report** entirely
- ai-stack-mcp orchestrator is a **fully-wired pipeline**, not a stub
- 18-agent definitions are far more complete than reported (5-layer hierarchy, backtrack, validation)

### New Files Created (8 total)

#### TypeScript Gateway — Dual Provider Auth

| File | Purpose |
|------|---------|
| [provider-types.ts](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/provider-types.ts) | Unified [UnifiedToken](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/provider-types.ts#20-40), [ProviderAdapter](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/provider-types.ts#61-83) interface, dual model registries (4 Google + 3 Claude models) |
| [claude-provider.ts](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/claude-provider.ts) | Claude Code auth via API key validation against Anthropic API, key type detection, quota extraction |
| [google-provider.ts](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/google-provider.ts) | Wraps existing OAuth 2.0 + PKCE into [ProviderAdapter](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/provider-types.ts#61-83) interface |
| [auth-gateway.ts](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/auth-gateway.ts) | Central orchestrator: dual-provider login flows, token lifecycle, provider switching, legacy TokenStore bridge |
| [routes/optimize.ts](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/routes/optimize.ts) | [OptimizationBridge](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/routes/optimize.ts#50-120) client class + 5 route handlers proxying to Python bridge |

#### Python Optimization Engine

| File | Purpose |
|------|---------|
| [bridge.py](file:///d:/PROJECT/agent-stack/ai-stack-mcp/bridge.py) | aiohttp REST server exposing all 9 MCP tools as HTTP endpoints with auth guard |

#### Infrastructure

| File | Purpose |
|------|---------|
| [docker-compose.unified.yml](file:///d:/PROJECT/agent-stack/docker-compose.unified.yml) | Unified service orchestration: Gateway + Bridge + optional Ollama/Caveman |
| [requirements.txt](file:///d:/PROJECT/agent-stack/ai-stack-mcp/requirements.txt) | Added `aiohttp>=3.9.0` dependency |

### Architecture Decisions Made

1. **Claude Code → API key auth** (Anthropic doesn't offer OAuth; we validate against `/v1/models`)
2. **Monorepo** (both projects under `agent-stack/`)
3. **Bridge-first** (MCP bridge delivers value faster than plugin.ts refactor)
4. **React for dashboard** (existing AGENT/ui infrastructure)
5. **Provider adapter pattern** — both providers produce identical [UnifiedToken](file:///d:/PROJECT/agent-stack/AGENT/src/gateway/provider-types.ts#20-40)

### Data Flow

```
User → Dashboard/VSCode
  ↓
Auth Gateway (chooses provider)
  ├→ Google OAuth 2.0 + PKCE → UnifiedToken
  └→ Claude API Key Validation → UnifiedToken
  ↓
Fastify Gateway Server
  ↓ POST /api/optimize
OptimizationBridge Client (fetch → bridge.py)
  ↓
Python aiohttp Bridge (port 9100)
  ↓
Orchestrator Pipeline
  → Cache → Router → MAB → Layers → Cost Log
  ↓
Optimized Response (30-60% token savings)
```

## What's Next — Phase 2 Preview

- Provider-aware model router (MAB extended with provider context)
- Account pool per provider
- Full request pipeline wiring
- Budget tracker ↔ cost_tracker bridge
- Integration tests
