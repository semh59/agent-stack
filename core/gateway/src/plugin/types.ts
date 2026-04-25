import type { PluginInput } from "@alloy/plugin";
import type { AlloyTokenExchangeResult } from "../google-gemini/oauth";

export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
}

export interface ApiKeyAuthDetails {
  type: "api_key";
  key: string;
}

export interface NonOAuthAuthDetails {
  type: string;
  [key: string]: unknown;
}

export type AuthDetails = OAuthAuthDetails | ApiKeyAuthDetails | NonOAuthAuthDetails;

export type HeaderStyle = "Alloy" | "gemini-cli";

export type GetAuth = () => Promise<AuthDetails>;

export interface ProviderModel {
  cost?: {
    input: number;
    output: number;
  };
  [key: string]: unknown;
}

export interface Provider {
  models?: Record<string, ProviderModel>;
}

export interface LoaderResult {
  apiKey: string;
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

export type PluginClient = PluginInput["client"];

export interface PluginContext {
  client: PluginClient;
  directory: string;
}

export type AuthPrompt =
  | {
      type: "text";
      key: string;
      message: string;
      placeholder?: string;
      validate?: (value: string) => string | undefined;
      condition?: (inputs: Record<string, string>) => boolean;
    }
  | {
      type: "select";
      key: string;
      message: string;
      options: Array<{ label: string; value: string; hint?: string }>;
      condition?: (inputs: Record<string, string>) => boolean;
    };

export type OAuthAuthorizationResult = { url: string; instructions: string } & (
  | {
      method: "auto";
      callback: () => Promise<AlloyTokenExchangeResult>;
    }
  | {
      method: "code";
      callback: (code: string) => Promise<AlloyTokenExchangeResult>;
    }
);

export interface AuthMethod {
  provider?: string;
  label: string;
  type: "oauth" | "api";
  prompts?: AuthPrompt[];
  authorize?: (inputs?: Record<string, string>) => Promise<OAuthAuthorizationResult>;
}

export interface PluginEventPayload {
  event: {
    type: string;
    properties?: unknown;
  };
}

export interface PluginResult {
  auth: {
    provider: string;
    loader: (getAuth: GetAuth, provider: Provider) => Promise<LoaderResult | Record<string, unknown>>;
    methods: AuthMethod[];
  };
  event?: (payload: PluginEventPayload) => void;
  tool?: Record<string, unknown>;
}

export interface RefreshParts {
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  email?: string;
}

export interface ProjectContextResult {
  auth: OAuthAuthDetails;
  effectiveProjectId: string;
}

export interface MessagePart extends Record<string, unknown> {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  fileData?: {
    mimeType: string;
    fileUri: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
    [key: string]: unknown;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
    id?: string;
    [key: string]: unknown;
  };
  thought?: boolean;
}

export interface MessageContent {
  [key: string]: unknown;
  role?: string;
  parts: MessagePart[];
}

export interface AlloyTool extends Record<string, unknown> {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  parametersJsonSchema?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    parametersJsonSchema?: Record<string, unknown>;
    input_schema?: Record<string, unknown>;
    inputSchema?: Record<string, unknown>;
    [key: string]: unknown;
  };
  functionDeclarations?: AlloyTool[];
  [key: string]: unknown;
}

export interface AlloyRequestRoot extends Record<string, unknown> {
  request?: AlloyRequestRoot;
  sessionId?: string;
  contents?: MessageContent[];
  messages?: MessageContent[];
  tools?: AlloyTool[];
  generationConfig?: Record<string, unknown>;
  extra_body?: Record<string, unknown>;
  project?: string;
  providerOptions?: Record<string, unknown>;
  toolConfig?: Record<string, unknown>;
  safetySettings?: Record<string, unknown>[];
  systemInstruction?: string | Record<string, unknown>;
  cachedContent?: string;
  cached_content?: string;
}
