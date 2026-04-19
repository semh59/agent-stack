/**
 * Public façade for the settings service.
 *
 * Other services (gateway routes, MCP host, optimization bridge client)
 * should import from here — never reach into `store.ts` or `schema.ts`
 * directly. Keeps the surface area small and makes future refactors
 * painless.
 */
export {
  settingsSchema,
  providersSchema,
  routingSchema,
  pipelineSchema,
  mcpSchema,
  rulesSchema,
  observabilitySchema,
  dataSchema,
  appearanceSchema,
  SECRET_PATHS,
  defaultSettings,
  type Settings,
  type SettingsInput,
  type SecretPath,
} from "./schema.js";

export {
  SettingsStore,
  getSettingsStore,
  resetSettingsStore,
  type SettingsStoreOptions,
  type SettingsRedacted,
} from "./store.js";

export {
  encryptSecret,
  decryptSecret,
  resolveMasterKey,
  maskSecret,
  SecretEncryptionError,
  MasterKeyMissingError,
  __resetEphemeralKeyForTests,
  type SecretEnvelope,
} from "./encryption.js";

export {
  probeProvider,
  probeOllama,
  probeOpenRouter,
  probeAnthropic,
  probeOpenAI,
  probeLMStudio,
  probeAzure,
  probeGoogle,
  type ProbeResult,
  type ProviderName,
} from "./provider-tests.js";
