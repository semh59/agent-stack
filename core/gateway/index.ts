export {
  AlloyCLIOAuthPlugin,
  GoogleOAuthPlugin,
} from "./src/plugin";

export {
  authorizeGoogleGemini,
  exchangeGoogleGemini,
} from "./src/google-gemini/oauth";

export type {
  AlloyAuthorization,
  AlloyTokenExchangeResult,
} from "./src/google-gemini/oauth";

// Sequential Pipeline (Seçenek A)
export { SequentialPipeline, PlanMode } from './src/orchestration/sequential-pipeline';
export { SharedMemory } from './src/orchestration/shared-memory';
export { AGENTS, getAgentByRole, getAgentsByLayer, getNextAgent, getTotalEstimatedMinutes, validateAgentDefinitions } from './src/orchestration/agents';
export type { AgentDefinition, AgentLayer, PreferredModel } from './src/orchestration/agents';
export type { PipelineState, TimelineEntry } from './src/orchestration/shared-memory';
export type { PipelineOptions, PipelineResult, AgentResult } from './src/orchestration/sequential-pipeline';

// Phase 2: Skill Integration, Terminal, Self-Improving
export { SkillMapper, getSkillMap } from './src/orchestration/skill-mapper';
export { TerminalExecutor } from './src/orchestration/terminal-executor';
export type { CommandResult, TerminalOptions } from './src/orchestration/terminal-executor';
export { SkillGenerator } from './src/orchestration/skill-generator';
export type { ProposedSkill } from './src/orchestration/skill-generator';

export { PipelineTools } from './src/orchestration/pipeline-tools';

// Phase 3: Auth Gateway (Google Alloy AI OAuth → Otonom Agent Handoff)
export { startGateway, type GatewayOptions } from './src/gateway/gateway';
export { AuthServer, type AuthServerOptions, type AuthResult, type AuthErrorCode } from './src/gateway/auth-server';
export { TokenStore, type StoredToken, type TokenStoreData } from './src/gateway/token-store';
export { launchOAuthBrowser, generateOAuthUrl, type LaunchResult } from './src/gateway/browser-launcher';
export { performHandoff, type HandoffOptions, type HandoffResult } from './src/gateway/agent-handoff';

export { AutonomousLoopEngine } from './src/orchestration/autonomous-loop-engine';
export { SmartMultiModelRouter } from './src/orchestration/autonomy-model-router';
export { StrictGateRunner } from './src/orchestration/autonomy-gate-runner';
export { ScopedToolExecutionEngine } from './src/orchestration/autonomy-scope-engine';
export { AutonomyGitManager } from './src/orchestration/autonomy-git-manager';
export type {
  AutonomySession,
  AutonomyState,
  TaskNode,
  ModelDecision,
  GateResult,
  ScopePolicy,
  CreateAutonomySessionRequest,
  StopAutonomySessionRequest,
  AutonomyEvent,
} from './src/orchestration/autonomy-types';
export { AutonomySessionManager } from './src/gateway/autonomy-session-manager';
