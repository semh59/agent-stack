import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlloyTokenExchangeResult } from "../google-gemini/oauth";
import type { AccountMetadataV3, AccountStorageV3, LoadAccountsResult } from "./storage";
import {
  AccountFileUnreadableError,
  createPersistAccountPool,
  mergeAccountPool,
} from "./persist-account-pool";

const NOW = new Date("2026-01-01T12:00:00.000Z").getTime();

function createAccount(overrides: Partial<AccountMetadataV3> = {}): AccountMetadataV3 {
  return {
    email: "existing@example.com",
    refreshToken: "existing-token",
    projectId: "project-a",
    managedProjectId: "managed-a",
    addedAt: NOW - 1_000,
    lastUsed: NOW - 500,
    enabled: true,
    ...overrides,
  };
}

function createStorage(
  accounts: AccountMetadataV3[],
  activeIndex = 0,
  family: AccountStorageV3["activeIndexByFamily"] = { claude: activeIndex, gemini: activeIndex },
): AccountStorageV3 {
  return {
    version: 3,
    accounts,
    activeIndex,
    activeIndexByFamily: family,
  };
}

function successResult(overrides: Partial<Extract<AlloyTokenExchangeResult, { type: "success" }>> = {}) {
  return {
    type: "success" as const,
    refresh: "new-token|project-b|managed-b",
    access: "access-token",
    expires: NOW + 3_600_000,
    email: "new@example.com",
    projectId: "project-b",
    ...overrides,
  };
}

function okLoad(storage: AccountStorageV3): LoadAccountsResult {
  return { status: "ok", storage };
}

function missingLoad(): LoadAccountsResult {
  return { status: "missing" };
}

function errorLoad(
  errorCode: Extract<LoadAccountsResult, { status: "error" }>["errorCode"],
  error = "mock read failure",
): LoadAccountsResult {
  return { status: "error", errorCode, error };
}

describe("persistAccountPool behavior (Issue #89)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("merging behavior (replaceAll=false)", () => {
    it("merges new account with existing accounts", () => {
      const existing = createStorage([createAccount()]);
      const merged = mergeAccountPool(existing, [successResult()], false, NOW);

      expect(merged?.accounts).toHaveLength(2);
      expect(merged?.accounts[0]?.email).toBe("existing@example.com");
      expect(merged?.accounts[1]?.email).toBe("new@example.com");
    });

    it("deduplicates by email, keeping the newest token", () => {
      const existing = createStorage([
        createAccount({
          email: "shared@example.com",
          refreshToken: "old-token",
          projectId: "old-project",
        }),
      ]);
      const merged = mergeAccountPool(
        existing,
        [successResult({ email: "shared@example.com", refresh: "new-token|new-project|new-managed" })],
        false,
        NOW,
      );

      expect(merged?.accounts).toHaveLength(1);
      expect(merged?.accounts[0]?.refreshToken).toBe("new-token");
      expect(merged?.accounts[0]?.projectId).toBe("new-project");
      expect(merged?.accounts[0]?.managedProjectId).toBe("new-managed");
    });

    it("deduplicates by refresh token when email not available", () => {
      const existing = createStorage([
        createAccount({
          email: undefined,
          refreshToken: "shared-token",
          projectId: "old-project",
        }),
      ]);
      const merged = mergeAccountPool(
        existing,
        [successResult({ email: undefined, refresh: "shared-token|new-project|new-managed" })],
        false,
        NOW,
      );

      expect(merged?.accounts).toHaveLength(1);
      expect(merged?.accounts[0]?.projectId).toBe("new-project");
      expect(merged?.accounts[0]?.managedProjectId).toBe("new-managed");
    });

    it("preserves activeIndex when adding new accounts", () => {
      const existing = createStorage(
        [
          createAccount({ email: "a@example.com", refreshToken: "token-a" }),
          createAccount({ email: "b@example.com", refreshToken: "token-b" }),
        ],
        1,
        { claude: 1, gemini: 0 },
      );
      const merged = mergeAccountPool(existing, [successResult()], false, NOW);

      expect(merged?.activeIndex).toBe(1);
      expect(merged?.activeIndexByFamily?.claude).toBe(1);
      expect(merged?.activeIndexByFamily?.gemini).toBe(0);
    });

    it("updates lastUsed timestamp for existing accounts", () => {
      const existing = createStorage([
        createAccount({
          email: "shared@example.com",
          refreshToken: "old-token",
          lastUsed: NOW - 100_000,
        }),
      ]);
      const merged = mergeAccountPool(
        existing,
        [successResult({ email: "shared@example.com", refresh: "old-token|project-b|managed-b" })],
        false,
        NOW,
      );

      expect(merged?.accounts[0]?.lastUsed).toBe(NOW);
    });
  });

  describe("fresh start behavior (replaceAll=true)", () => {
    it("replaces all existing accounts with new ones", () => {
      const existing = createStorage([createAccount({ email: "old@example.com" })], 0);
      const merged = mergeAccountPool(existing, [successResult()], true, NOW);

      expect(merged?.accounts).toHaveLength(1);
      expect(merged?.accounts[0]?.email).toBe("new@example.com");
    });

    it("resets activeIndex to 0", () => {
      const existing = createStorage(
        [
          createAccount({ email: "old-1@example.com", refreshToken: "old-1" }),
          createAccount({ email: "old-2@example.com", refreshToken: "old-2" }),
        ],
        1,
        { claude: 1, gemini: 1 },
      );
      const merged = mergeAccountPool(existing, [successResult()], true, NOW);

      expect(merged?.activeIndex).toBe(0);
      expect(merged?.activeIndexByFamily?.claude).toBe(0);
      expect(merged?.activeIndexByFamily?.gemini).toBe(0);
    });

    it("ignores existing accounts file", async () => {
      const loadMock = vi.fn<() => Promise<LoadAccountsResult>>();
      const saveMock = vi.fn<(storage: AccountStorageV3) => Promise<void>>().mockResolvedValue(undefined);
      const persist = createPersistAccountPool({
        loadAccountsDetailed: loadMock,
        saveAccounts: saveMock,
        now: () => NOW,
      });

      await persist([successResult()], true);

      expect(loadMock).not.toHaveBeenCalled();
      expect(saveMock).toHaveBeenCalledTimes(1);
      const payload = saveMock.mock.calls[0]?.[0];
      expect(payload?.accounts).toHaveLength(1);
      expect(payload?.accounts[0]?.email).toBe("new@example.com");
    });
  });

  describe("THE BUG: error handling when loadAccounts fails (Issue #89)", () => {
    it("should NOT overwrite accounts when loadAccounts returns null due to permission error", async () => {
      const loadMock = vi.fn<() => Promise<LoadAccountsResult>>().mockResolvedValue(
        errorLoad("PERMISSION_DENIED", "EACCES"),
      );
      const saveMock = vi.fn<(storage: AccountStorageV3) => Promise<void>>().mockResolvedValue(undefined);
      const persist = createPersistAccountPool({
        loadAccountsDetailed: loadMock,
        saveAccounts: saveMock,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toBeInstanceOf(AccountFileUnreadableError);
      expect(saveMock).not.toHaveBeenCalled();
    });

    it("should throw error when file exists but cannot be read", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("READ_ERROR", "unexpected read failure"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toBeInstanceOf(AccountFileUnreadableError);
    });

    it("should prompt user when existing accounts may be lost", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("PARSE_ERROR", "invalid json"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toThrow(
        "Recovery options: (r)etry, (b)ackup and continue, (a)bort.",
      );
    });

    it("should only treat ENOENT as 'safe to create new file'", async () => {
      const saveMock = vi.fn<(storage: AccountStorageV3) => Promise<void>>().mockResolvedValue(undefined);
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => missingLoad(),
        saveAccounts: saveMock,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).resolves.toBeUndefined();
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock.mock.calls[0]?.[0].accounts).toHaveLength(1);
    });
  });
});

describe("TUI flow integration (Issue #89)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("account persistence after OAuth", () => {
    it("should merge new account with existing accounts in TUI flow", async () => {
      const existing = createStorage([createAccount({ email: "existing@example.com" })]);
      const saveMock = vi.fn<(storage: AccountStorageV3) => Promise<void>>().mockResolvedValue(undefined);
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => okLoad(existing),
        saveAccounts: saveMock,
        now: () => NOW,
      });

      await persist([successResult()], false);

      const saved = saveMock.mock.calls[0]?.[0];
      expect(saved?.accounts).toHaveLength(2);
    });

    it("should show warning when existing accounts cannot be loaded", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("PERMISSION_DENIED", "EACCES"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toThrow(
        "Account storage could not be read safely",
      );
    });

    it("should ask user for confirmation before potentially overwriting accounts", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("INVALID_FORMAT", "schema mismatch"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toThrow(
        "Recovery options: (r)etry, (b)ackup and continue, (a)bort.",
      );
    });
  });

  describe("authorize function behavior", () => {
    it("TUI flow (inputs falsy) should check for existing accounts", async () => {
      const loadMock = vi.fn<() => Promise<LoadAccountsResult>>().mockResolvedValue(missingLoad());
      const persist = createPersistAccountPool({
        loadAccountsDetailed: loadMock,
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await persist([successResult()], false);
      expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it("should handle loadAccounts returning null gracefully", async () => {
      const saveMock = vi.fn<(storage: AccountStorageV3) => Promise<void>>().mockResolvedValue(undefined);
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => missingLoad(),
        saveAccounts: saveMock,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).resolves.toBeUndefined();
      expect(saveMock).toHaveBeenCalledTimes(1);
      const saved = saveMock.mock.calls[0]?.[0];
      expect(saved?.accounts[0]?.email).toBe("new@example.com");
    });
  });
});

describe("proposed fix validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadAccounts should distinguish error types", () => {
    it("should return { error: 'ENOENT' } when file doesn't exist", async () => {
      const saveMock = vi.fn<(storage: AccountStorageV3) => Promise<void>>().mockResolvedValue(undefined);
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => missingLoad(),
        saveAccounts: saveMock,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).resolves.toBeUndefined();
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it("should return { error: 'PERMISSION_DENIED' } on EACCES", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("PERMISSION_DENIED", "EACCES"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toMatchObject({
        name: "AccountFileUnreadableError",
        errorCode: "PERMISSION_DENIED",
      });
    });

    it("should return { error: 'PARSE_ERROR' } on invalid JSON", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("PARSE_ERROR", "Unexpected token"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toMatchObject({
        name: "AccountFileUnreadableError",
        errorCode: "PARSE_ERROR",
      });
    });

    it("should return { error: 'INVALID_FORMAT' } on schema mismatch", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("INVALID_FORMAT", "accounts must be array"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toMatchObject({
        name: "AccountFileUnreadableError",
        errorCode: "INVALID_FORMAT",
      });
    });
  });

  describe("persistAccountPool should handle errors safely", () => {
    it("should throw AccountFileUnreadableError when file exists but can't be read", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("READ_ERROR", "disk read failed"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toBeInstanceOf(AccountFileUnreadableError);
    });

    it("should include recovery instructions in error message", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("DECRYPT_ERROR", "cannot decrypt"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toThrow("Fix file permissions or restore");
    });
  });

  describe("user prompts for data safety", () => {
    it("should prompt user when accounts file exists but is unreadable", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("READ_ERROR", "I/O failure"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toThrow("Recovery options:");
    });

    it("should offer options: (r)etry, (b)ackup and continue, (a)bort", async () => {
      const persist = createPersistAccountPool({
        loadAccountsDetailed: async () => errorLoad("PERMISSION_DENIED", "EACCES"),
        saveAccounts: async () => undefined,
        now: () => NOW,
      });

      await expect(persist([successResult()], false)).rejects.toThrow(
        "(r)etry, (b)ackup and continue, (a)bort",
      );
    });
  });
});
