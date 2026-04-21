/**
 * D3 — BUG_REPORT.md regression tests.
 *
 * These tests pin down the six critical bugs identified in the Phase-D3
 * remediation so a future regression can't silently reintroduce them.
 * Each `describe` block names the bug from BUG_REPORT.md and documents
 * the original failure mode in its leading comment.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AccountManager,
  type ModelFamily,
} from "./accounts";
import type { AccountStorageV3 } from "./storage";
import { TokenBucketTracker, HealthScoreTracker } from "./rotation";
import { recursivelyParseJsonStrings } from "./request-helpers";

// -------------------------------------------------------------------------
// Bug #1 — Token bucket fractional accumulation.
// Public `getTokens()` must floor its return so external consumers never see
// a partial token. The internal float storage is intentional for smooth
// accrual; only the API boundary needs to be integer-safe.
// -------------------------------------------------------------------------
describe("D3 Bug #1: token bucket returns integer token counts", () => {
  it("getTokens() floors the fractional internal state", () => {
    const tracker = new TokenBucketTracker({
      initialTokens: 1,
      maxTokens: 100,
      regenerationRatePerMinute: 0.1,
    });

    // Drive the regeneration across many small `now` advancements to
    // accumulate fractional tokens in the internal state; the public
    // getter must still surface an integer.
    const baseNow = Date.now();
    const originalNow = Date.now;
    try {
      for (let i = 0; i < 10; i++) {
        Date.now = () => baseNow + i * 1234; // irregular sub-second ticks
        const value = tracker.getTokens(0);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    } finally {
      Date.now = originalNow;
    }
  });
});

// -------------------------------------------------------------------------
// Bug #2 — Health score can go negative.
// `clampScore()` must apply the lower bound of 0 (not only the upper bound).
// -------------------------------------------------------------------------
describe("D3 Bug #2: health score stays non-negative under heavy penalties", () => {
  it("recordFailure floors at zero even under a long failure streak", () => {
    const tracker = new HealthScoreTracker({
      initial: 10,
      maxScore: 100,
      successReward: 1,
      failurePenalty: -50, // larger than initial to force underflow attempts
      rateLimitPenalty: -10,
      recoveryRatePerHour: 0, // no passive recovery during the test
    });

    for (let i = 0; i < 5; i++) {
      tracker.recordFailure(0);
    }

    const score = tracker.getScore(0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(score)).toBe(true);
  });
});

// -------------------------------------------------------------------------
// Bug #3 — Account index out-of-bounds after removal.
// `removeAccount()` sets `currentAccountIndexByFamily[family] = -1` when the
// last account for that family is gone. A later `getCurrentOrNextForFamily`
// with `pidOffsetEnabled=true` used `?? 0` which does NOT catch -1, so the
// PID-offset arithmetic could compute a negative `newIndex` and the caller
// would dereference `accounts[-1]` as `undefined`.
// -------------------------------------------------------------------------
describe("D3 Bug #3: account selection survives -1 sentinel from removal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles `-1` current-index sentinel without returning undefined", () => {
    vi.stubGlobal("process", { ...process, pid: 2 });
    const stored: AccountStorageV3 = {
      version: 3,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r3", projectId: "p3", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 0,
    };
    const manager = new AccountManager(undefined, stored);
    const family: ModelFamily = "claude";

    // Force the post-removal sentinel state.
    (manager as unknown as {
      currentAccountIndexByFamily: Record<ModelFamily, number>;
    }).currentAccountIndexByFamily[family] = -1;

    const account = manager.getCurrentOrNextForFamily(
      family,
      null,
      "sticky",
      "Alloy",
      /* pidOffsetEnabled */ true,
    );

    expect(account).not.toBeNull();
    expect(account?.index).toBeGreaterThanOrEqual(0);
    expect(account?.index).toBeLessThan(stored.accounts.length);
  });

  it("handles the exact `(-1 + 0) % len === -1` regression case", () => {
    // pidOffset 0 + baseIndex -1 was the specific strict-modulo failure.
    vi.stubGlobal("process", { ...process, pid: 2 }); // pid % 2 === 0
    const stored: AccountStorageV3 = {
      version: 3,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 0,
    };
    const manager = new AccountManager(undefined, stored);
    (manager as unknown as {
      currentAccountIndexByFamily: Record<ModelFamily, number>;
    }).currentAccountIndexByFamily.claude = -1;

    const account = manager.getCurrentOrNextForFamily(
      "claude",
      null,
      "sticky",
      "Alloy",
      true,
    );
    expect(account).not.toBeNull();
    expect(account?.index).toBeGreaterThanOrEqual(0);
  });
});

// -------------------------------------------------------------------------
// Bug #5 — Recursive JSON auto-parsing infinite loop / stack overflow.
// Adversarial payloads (cyclic references, deeply nested JSON-encoded
// strings) could previously cause unbounded recursion. The fix caps depth
// at MAX_RECURSIVE_DEPTH (10) and uses a WeakMap to short-circuit cycles.
// -------------------------------------------------------------------------
describe("D3 Bug #5: recursive JSON parsing is depth-bounded", () => {
  it("returns without stack-overflow on a deeply nested JSON-encoded string", () => {
    // Build a payload that would recurse 50 levels if unbounded.
    let inner: unknown = { leaf: true };
    for (let i = 0; i < 50; i++) {
      inner = { next: JSON.stringify(inner) };
    }

    const start = Date.now();
    const result = recursivelyParseJsonStrings(inner);
    const elapsed = Date.now() - start;

    // The cap should short-circuit well under a second even on slow CI.
    expect(elapsed).toBeLessThan(1000);
    expect(result).toBeDefined();
  });

  it("handles cyclic object graphs via the seen-cache", () => {
    type Cyclic = { self?: Cyclic; value: number };
    const a: Cyclic = { value: 1 };
    a.self = a;

    // Must not throw, must not recurse forever.
    expect(() => recursivelyParseJsonStrings(a)).not.toThrow();
  });
});

// -------------------------------------------------------------------------
// Bug #6 — File locking / atomic rename without durability.
// The save path now runs writeFile → fd.sync() → rename and additionally
// sweeps crashed-writer `.tmp` files on the first save of the process.
// This test asserts the observable post-condition: stale `.tmp` files
// older than the grace window are swept, and the real storage file is
// present after a save.
// -------------------------------------------------------------------------
describe("D3 Bug #6: storage write survives crashes and sweeps orphans", () => {
  let tempDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "alloy-d3-"));
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("removes orphaned .tmp files older than the grace window on first save", async () => {
    const storageFile = join(tempDir, "Alloy-accounts.json");
    writeFileSync(storageFile, "{}");

    const staleTmp = join(tempDir, "Alloy-accounts.json.aaaaaa.tmp");
    const freshTmp = join(tempDir, "Alloy-accounts.json.bbbbbb.tmp");
    writeFileSync(staleTmp, "stale");
    writeFileSync(freshTmp, "fresh");
    // Backdate the stale file past the 60-second grace window.
    const past = Date.now() / 1000 - 120;
    utimesSync(staleTmp, past, past);

    // Trigger a save to invoke the memoized cleanup sweep.
    const { saveAccounts } = await import("./storage");
    await saveAccounts(
      {
        version: 3,
        accounts: [],
        activeIndex: 0,
      },
      true,
    );

    const remaining = readdirSync(tempDir).filter((f) => f.endsWith(".tmp"));
    // The stale .tmp must be gone; the fresh one may still exist.
    expect(remaining.includes("Alloy-accounts.json.aaaaaa.tmp")).toBe(false);
    expect(existsSync(storageFile)).toBe(true);
  });
});
