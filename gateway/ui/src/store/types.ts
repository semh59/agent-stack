export interface GoogleAccount {
  email: string;
  expiresAt: number;
  isValid: boolean;
  status?: "active" | "warning" | "error" | "expired";
}

export interface LogEntry {
  id: number;
  time: string;
  source: string;
  text: string;
  type: "info" | "success" | "warning" | "error" | "agent" | "tool";
}

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  status: "active" | "standby" | "error";
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  status: "active" | "standby" | "error";
}

export interface AgentProgress {
  name: string;
  role: string;
  status: "pending" | "running" | "completed" | "failed" | "halted";
}

export interface PipelineProgress {
  status: string;
  state?: {
    userTask: string;
    startedAt: string;
    completedAt: string | null;
    pipelineStatus?: "running" | "paused" | "completed" | "failed";
    completedAgents?: string[];
    filesCreated?: string[];
  };
  totalAgents?: number;
  completedCount?: number;
  currentAgent?: AgentProgress;
  estimatedRemainingMinutes?: number;
}

export interface AutonomySessionSummary {
  id: string;
  state: string;
  objective: string;
  account: string;
  createdAt: string;
  updatedAt: string;
  queuePosition: number | null;
  branchName: string | null;
  baseBranch: string | null;
  commitHash: string | null;
  currentModel: string | null;
  currentGear: "fast" | "standard" | "elite" | null;
  reviewStatus: "none" | "plan_pending" | "approved" | "rejected";
  reviewUpdatedAt: string | null;
}

export interface AutonomyQueueItem {
  sessionId: string;
  state: string;
  objective: string;
  account: string;
  createdAt: string;
  queuePosition: number;
}

export interface AutonomyTimelineItem {
  id: string;
  type: string;
  timestamp: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface AutonomyGateStatus {
  passed: boolean;
  blockingIssues: string[];
  impactedScopes: string[];
  audit?: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    total: number;
  };
}

export interface AutonomyBudgetStatus {
  limits: {
    maxCycles: number;
    maxDurationMs: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxTPM: number;
    maxRPD: number;
    maxUsd?: number;
  };
  usage: {
    cyclesUsed: number;
    durationMsUsed: number;
    inputTokensUsed: number;
    outputTokensUsed: number;
    currentTPM: number;
    requestsUsed: number;
    reservedTPM?: number;
    reservedRequests?: number;
    cachedInputTokensUsed?: number;
    usdUsed: number;
  };
  warning: boolean;
  warningReason: string | null;
  exceeded: boolean;
  exceedReason: string | null;
}

export interface MissionSnapshotMeta {
  truncated: boolean;
  droppedFields: string[];
  timelineTailCount?: number;
}

export interface StartAutonomySessionInput {
  account: string;
  anchorModel: string;
  objective: string;
  scope: {
    mode: "selected_only";
    paths: string[];
  };
  modelPolicy: "smart_multi";
  startMode?: "queued" | "immediate";
  reviewAfterPlan?: boolean;
  budget?: {
    maxCycles: number;
    maxDurationMs: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxTPM: number;
    maxRPD: number;
    maxUsd?: number;
  };
}

export interface AutonomySessionArtifacts {
  plan: string;
  changeSummary: string;
  nextActionReason: string;
  gateResult: AutonomyGateStatus | null;
  rawResponses: string[];
  contextPack: string;
}

export interface AccountQuota {
  email?: string;
  quota?: Record<string, {
    remainingFraction?: number;
    resetTime?: string;
    modelCount: number;
  }>;
  updatedAt?: number;
  isCoolingDown: boolean;
  cooldownReason?: string;
}

export interface AppState {
  bootState: "idle" | "loading" | "ready" | "error";
  dataState: "idle" | "loading" | "ready" | "error";
  wsTransportState: "healthy" | "recovering" | "fatal";
  wsFatalError: { code: string; message: string; sessionId?: string } | null;
  accounts: GoogleAccount[];
  models: ModelEntry[];
  skills: SkillEntry[];
  activeAccount: string | null;
  stats: Record<string, unknown> | null;
  sidebarOpen: boolean;
  theme: "dark" | "light";
  pipelineStatus: PipelineProgress | null;
  autonomySession: AutonomySessionSummary | null;
  autonomySessionId: string | null;
  autonomyTimeline: AutonomyTimelineItem[];
  activeDiff: string[];
  gateStatus: AutonomyGateStatus | null;
  budgetStatus: AutonomyBudgetStatus | null;
  sessionsById: Record<string, AutonomySessionSummary>;
  sessionOrder: string[];
  activeSessionId: string | null;
  queue: AutonomyQueueItem[];
  timelineBySession: Record<string, AutonomyTimelineItem[]>;
  gateBySession: Record<string, AutonomyGateStatus | null>;
  budgetBySession: Record<string, AutonomyBudgetStatus | null>;
  diffBySession: Record<string, string[]>;
  planArtifactsBySession: Record<string, AutonomySessionArtifacts | null>;
  snapshotMetaBySession: Record<string, MissionSnapshotMeta | null>;
  analyticsBySession: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  logs: LogEntry[];
  lastError: string | null;
  gatewayToken: string | null;
  accountQuotas: AccountQuota[];
  selectedModelId: string | null;
  selectedMode: "smart_multi" | "fast_only" | "pro_only";

  apiKeys: { tavily: string; exa: string };
  notifications: { pipelineCompleted: boolean; modelFallback: boolean };
  security: { dockerSandboxing: boolean };
  modelPreferences: {
    primaryModel: string;
    fastModel: string;
    temperature: number;
    contextWindow: string;
    fallbackModel: string;
    fallbackTriggers: { rateLimit: boolean; serverError: boolean; formatError: boolean };
  };

  // Actions
  toggleSidebar: () => void;
  toggleTheme: () => void;
  setApiKeys: (keys: Partial<AppState["apiKeys"]>) => void;
  setNotifications: (notifs: Partial<AppState["notifications"]>) => void;
  setSecurity: (sec: Partial<AppState["security"]>) => void;
  setModelPreferences: (prefs: Partial<AppState["modelPreferences"]>) => void;
  setLastError: (error: string | null) => void;
  setGatewayToken: (token: string | null) => void;
  runPostBootInitialization: () => Promise<void>;
  fetchAccounts: () => Promise<void>;
  fetchModels: () => Promise<void>;
  fetchSkills: () => Promise<void>;
  fetchQuota: () => Promise<void>;
  setSelectedModel: (modelId: string | null) => void;
  setSelectedMode: (mode: AppState["selectedMode"]) => void;
  selectAccount: (email: string) => Promise<void>;
  selectAutonomySession: (sessionId: string) => void;
  fetchAutonomySessionDetail: (sessionId: string) => Promise<void>;
  fetchAutonomyArtifacts: (sessionId: string) => Promise<void>;
  approveAutonomyPlan: (sessionId: string) => Promise<void>;
  rejectAutonomyPlan: (sessionId: string, reason?: string) => Promise<void>;
  cancelAutonomySession: (sessionId: string, reason?: string) => Promise<void>;
  promoteAutonomySession: (sessionId: string) => Promise<void>;
  stopAutonomySession: (reason?: string) => Promise<void>;
  pauseAutonomySession: (reason?: string) => Promise<void>;
  resumeAutonomySession: (reason?: string) => Promise<void>;
  addAccount: (provider?: string) => Promise<void>;
  removeAccount: (email: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  initializeWebSocket: () => void;
  handleMessageData: (data: unknown) => void;
  subscribeAutonomyEvents: (sessionId: string) => void;
  retryAutonomyTransport: () => void;
  fetchPipelineStatus: () => Promise<void>;
  startPipeline: (userTask: string, planMode?: string) => Promise<void>;
  startAutonomySession: (input: StartAutonomySessionInput) => Promise<void>;
  fetchAutonomySessions: () => Promise<void>;
  fetchAutonomyQueue: () => Promise<void>;
}

/**
 * VS Code Webview Resource API
 */
export interface VSCodeAPI {
  postMessage: (message: unknown) => void;
  setState: (state: unknown) => void;
  getState: () => unknown;
}
