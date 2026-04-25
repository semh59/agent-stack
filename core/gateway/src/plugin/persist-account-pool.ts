import type { AlloyTokenExchangeResult } from "../google-gemini/oauth";
import { parseRefreshParts } from "./auth";
import {
  loadAccountsDetailed,
  saveAccounts,
  type AccountMetadataV3,
  type AccountStorageV3,
  type LoadAccountsErrorCode,
  type LoadAccountsResult,
} from "./storage";

type SuccessfulExchangeResult = Extract<AlloyTokenExchangeResult, { type: "success" }>;

interface PersistAccountPoolDeps {
  loadAccountsDetailed: () => Promise<LoadAccountsResult>;
  saveAccounts: (storage: AccountStorageV3) => Promise<void>;
  now: () => number;
}

const DEFAULT_DEPS: PersistAccountPoolDeps = {
  loadAccountsDetailed,
  saveAccounts,
  now: () => Date.now(),
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function buildUnreadableAccountFileMessage(errorCode: LoadAccountsErrorCode): string {
  return [
    `Account storage could not be read safely (${errorCode}).`,
    "Recovery options: (r)etry, (b)ackup and continue, (a)bort.",
    "Fix file permissions or restore a valid Alloy-accounts.json file, then retry login.",
  ].join(" ");
}

export class AccountFileUnreadableError extends Error {
  readonly errorCode: LoadAccountsErrorCode;
  readonly detail: string;

  constructor(errorCode: LoadAccountsErrorCode, detail: string) {
    super(buildUnreadableAccountFileMessage(errorCode));
    this.name = "AccountFileUnreadableError";
    this.errorCode = errorCode;
    this.detail = detail;
  }
}

function buildIndexMaps(accounts: AccountMetadataV3[]): {
  byRefreshToken: Map<string, number>;
  byEmail: Map<string, number>;
} {
  const byRefreshToken = new Map<string, number>();
  const byEmail = new Map<string, number>();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (!account) continue;
    if (account.refreshToken) byRefreshToken.set(account.refreshToken, i);
    if (account.email) byEmail.set(account.email, i);
  }

  return { byRefreshToken, byEmail };
}

function applyResultToAccounts(
  accounts: AccountMetadataV3[],
  result: SuccessfulExchangeResult,
  now: number,
  byRefreshToken: Map<string, number>,
  byEmail: Map<string, number>,
): void {
  const parts = parseRefreshParts(result.refresh);
  if (!parts.refreshToken) return;

  const existingByEmail = result.email ? byEmail.get(result.email) : undefined;
  const existingByToken = byRefreshToken.get(parts.refreshToken);
  const existingIndex = existingByEmail ?? existingByToken;

  if (existingIndex === undefined) {
    const newIndex = accounts.length;
    accounts.push({
      email: result.email,
      refreshToken: parts.refreshToken,
      projectId: parts.projectId,
      managedProjectId: parts.managedProjectId,
      addedAt: now,
      lastUsed: now,
      enabled: true,
    });
    byRefreshToken.set(parts.refreshToken, newIndex);
    if (result.email) byEmail.set(result.email, newIndex);
    return;
  }

  const existing = accounts[existingIndex];
  if (!existing) return;

  const previousToken = existing.refreshToken;
  const previousEmail = existing.email;
  const nextEmail = result.email ?? existing.email;

  accounts[existingIndex] = {
    ...existing,
    email: nextEmail,
    refreshToken: parts.refreshToken,
    projectId: parts.projectId ?? existing.projectId,
    managedProjectId: parts.managedProjectId ?? existing.managedProjectId,
    lastUsed: now,
    enabled: existing.enabled ?? true,
  };

  if (previousToken !== parts.refreshToken) {
    byRefreshToken.delete(previousToken);
    byRefreshToken.set(parts.refreshToken, existingIndex);
  }
  if (previousEmail && previousEmail !== nextEmail) {
    byEmail.delete(previousEmail);
  }
  if (nextEmail) {
    byEmail.set(nextEmail, existingIndex);
  }
}

export function mergeAccountPool(
  existingStorage: AccountStorageV3 | null,
  results: SuccessfulExchangeResult[],
  replaceAll: boolean,
  now: number,
): AccountStorageV3 | null {
  if (results.length === 0) {
    return null;
  }

  const accounts = replaceAll ? [] : [...(existingStorage?.accounts ?? [])];
  const { byRefreshToken, byEmail } = buildIndexMaps(accounts);

  for (const result of results) {
    applyResultToAccounts(accounts, result, now, byRefreshToken, byEmail);
  }

  if (accounts.length === 0) {
    return null;
  }

  const activeIndex = replaceAll
    ? 0
    : clampInt(existingStorage?.activeIndex ?? 0, 0, accounts.length - 1);
  const existingFamily = existingStorage?.activeIndexByFamily;

  return {
    version: 3,
    accounts,
    activeIndex,
    activeIndexByFamily: {
      claude: clampInt(existingFamily?.claude ?? activeIndex, 0, accounts.length - 1),
      gemini: clampInt(existingFamily?.gemini ?? activeIndex, 0, accounts.length - 1),
    },
  };
}

function toUnreadableError(result: Extract<LoadAccountsResult, { status: "error" }>): AccountFileUnreadableError {
  return new AccountFileUnreadableError(result.errorCode, result.error);
}

export function createPersistAccountPool(overrides: Partial<PersistAccountPoolDeps> = {}) {
  const deps: PersistAccountPoolDeps = {
    ...DEFAULT_DEPS,
    ...overrides,
  };

  return async function persistAccountPool(
    results: SuccessfulExchangeResult[],
    replaceAll = false,
  ): Promise<void> {
    if (results.length === 0) return;

    let existingStorage: AccountStorageV3 | null = null;
    if (!replaceAll) {
      const loaded = await deps.loadAccountsDetailed();
      if (loaded.status === "ok") {
        existingStorage = loaded.storage;
      } else if (loaded.status === "error") {
        throw toUnreadableError(loaded);
      }
    }

    const merged = mergeAccountPool(existingStorage, results, replaceAll, deps.now());
    if (!merged) return;
    await deps.saveAccounts(merged);
  };
}

export const persistAccountPool = createPersistAccountPool();
