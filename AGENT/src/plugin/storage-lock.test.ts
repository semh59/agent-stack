import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountStorageV3 } from "./storage";

const fileStore = new Map<string, string>();
let activeCrossProcessLocks = 0;

function toPathKey(path: unknown): string {
  return String(path);
}

function createErrno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: vi.fn(async (path: unknown) => {
        if (!fileStore.has(toPathKey(path))) {
          throw createErrno("ENOENT");
        }
      }),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn(async (path: unknown) => {
        const value = fileStore.get(toPathKey(path));
        if (value === undefined) {
          throw createErrno("ENOENT");
        }
        return value;
      }),
      writeFile: vi.fn(async (path: unknown, content: unknown) => {
        fileStore.set(toPathKey(path), String(content));
      }),
      rename: vi.fn(async (from: unknown, to: unknown) => {
        const source = toPathKey(from);
        const target = toPathKey(to);
        const value = fileStore.get(source);
        if (value === undefined) {
          throw createErrno("ENOENT");
        }
        fileStore.set(target, value);
        fileStore.delete(source);
      }),
      unlink: vi.fn(async (path: unknown) => {
        fileStore.delete(toPathKey(path));
      }),
      appendFile: vi.fn(async (path: unknown, content: unknown) => {
        const key = toPathKey(path);
        const existing = fileStore.get(key) ?? "";
        fileStore.set(key, existing + String(content));
      }),
    },
  };
});

vi.mock("proper-lockfile", () => ({
  default: {
    lock: vi.fn(async () => {
      if (activeCrossProcessLocks > 0) {
        throw createErrno("ELOCKED");
      }
      activeCrossProcessLocks += 1;
      return async () => {
        activeCrossProcessLocks -= 1;
      };
    }),
  },
}));

describe("saveAccounts lock behavior (Bug #6)", () => {
  beforeEach(() => {
    fileStore.clear();
    activeCrossProcessLocks = 0;
    process.env.OPENCODE_CONFIG_DIR = "C:\\tmp\\opencode-lock-test";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  it("serializes concurrent saveAccounts calls and preserves merged data", async () => {
    const { loadAccounts, saveAccounts } = await import("./storage");

    const storageA: AccountStorageV3 = {
      version: 3,
      activeIndex: 0,
      accounts: [
        {
          email: "a@example.com",
          refreshToken: "r1",
          addedAt: 1,
          lastUsed: 1,
        },
      ],
    };

    const storageB: AccountStorageV3 = {
      version: 3,
      activeIndex: 0,
      accounts: [
        {
          email: "b@example.com",
          refreshToken: "r2",
          addedAt: 2,
          lastUsed: 2,
        },
      ],
    };

    await expect(
      Promise.all([saveAccounts(storageA), saveAccounts(storageB)]),
    ).resolves.toEqual([undefined, undefined]);

    const merged = await loadAccounts();
    expect(merged).not.toBeNull();
    const tokens = merged?.accounts.map((account) => account.refreshToken).sort();
    expect(tokens).toEqual(["r1", "r2"]);
  });

  it("still fails fast when cross-process lock cannot be acquired", async () => {
    const properLockfile = (await import("proper-lockfile")).default;
    vi.mocked(properLockfile.lock).mockRejectedValueOnce(createErrno("ELOCKED"));

    const { saveAccounts } = await import("./storage");
    const storage: AccountStorageV3 = {
      version: 3,
      activeIndex: 0,
      accounts: [
        {
          email: "locked@example.com",
          refreshToken: "locked",
          addedAt: 1,
          lastUsed: 1,
        },
      ],
    };

    await expect(saveAccounts(storage)).rejects.toMatchObject({ code: "ELOCKED" });
  });
});
