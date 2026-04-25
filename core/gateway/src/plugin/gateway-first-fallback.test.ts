import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountManager } from "./accounts";
import type { AccountStorageV3 } from "./storage";

/**
 * Test: Alloy-first fallback logic
 * 
 * Requirement: Exhaust Alloy across ALL accounts before falling back to Gemini CLI
 * 
 * Scenario:
 * - Account 0: Alloy rate-limited, gemini-cli available
 * - Account 1: Alloy available
 * 
 * Expected: Switch to Account 1 (use Alloy), NOT fall back to gemini-cli on Account 0
 */
describe("Alloy-first fallback", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("hasOtherAccountWithAlloyAvailable", () => {
    it("returns true when another account has Alloy available", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        ],
        activeIndex: 0,
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccounts();
      
      // Mark account 0's Alloy as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "Alloy");

      // Account 1 should have Alloy available
      const hasOther = manager.hasOtherAccountWithAlloyAvailable(
        accounts[0]!.index,
        "gemini",
        null
      );

      expect(hasOther).toBe(true);
    });

    it("returns false when all other accounts are also rate-limited for Alloy", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        ],
        activeIndex: 0,
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccounts();
      
      // Mark both accounts' Alloy as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "Alloy");
      manager.markRateLimited(accounts[1]!, 60000, "gemini", "Alloy");

      const hasOther = manager.hasOtherAccountWithAlloyAvailable(
        accounts[0]!.index,
        "gemini",
        null
      );

      expect(hasOther).toBe(false);
    });

    it("skips disabled accounts", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0, enabled: false },
        ],
        activeIndex: 0,
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccounts();
      
      // Mark account 0's Alloy as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "Alloy");

      // Account 1 is disabled, so should return false
      const hasOther = manager.hasOtherAccountWithAlloyAvailable(
        accounts[0]!.index,
        "gemini",
        null
      );

      expect(hasOther).toBe(false);
    });

    it("skips cooling down accounts", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        ],
        activeIndex: 0,
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccounts();
      
      // Mark account 0's Alloy as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "Alloy");
      // Mark account 1 as cooling down
      manager.markAccountCoolingDown(accounts[1]!, 60000, "auth-failure");

      const hasOther = manager.hasOtherAccountWithAlloyAvailable(
        accounts[0]!.index,
        "gemini",
        null
      );

      expect(hasOther).toBe(false);
    });

    it("works with model-specific rate limits", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        ],
        activeIndex: 0,
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccounts();
      
      // Mark account 0's Alloy as rate-limited for gemini-3-pro
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "Alloy", "gemini-3-pro");

      // Account 1 should have Alloy available for gemini-3-pro
      const hasOther = manager.hasOtherAccountWithAlloyAvailable(
        accounts[0]!.index,
        "gemini",
        "gemini-3-pro"
      );

      expect(hasOther).toBe(true);
    });

    it("returns false for Claude family (no gemini-cli fallback)", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        ],
        activeIndex: 0,
      };

      const manager = new AccountManager(undefined, stored);

      // For Claude, this method should always return false
      // (Claude has no gemini-cli fallback, only Alloy)
      const hasOther = manager.hasOtherAccountWithAlloyAvailable(
        0,
        "claude",
        null
      );

      expect(hasOther).toBe(false);
    });
  });

  describe("Pre-check fallback logic", () => {
    it("should switch to account with Alloy rather than fall back to gemini-cli", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        ],
        activeIndex: 0,
        activeIndexByFamily: { claude: 0, gemini: 0 },
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccounts();
      
      // Account 0's Alloy is rate-limited but gemini-cli is available
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "Alloy");
      
      // Account 1's Alloy is available
      // (not rate-limited for Alloy)

      // When requesting with Alloy headerStyle:
      // Should switch to account 1 (which has Alloy), NOT fall back to gemini-cli
      
      const nextAccount = manager.getCurrentOrNextForFamily(
        "gemini",
        null,
        "sticky",
        "Alloy"
      );

      expect(nextAccount?.index).toBe(1);
      expect(manager.isRateLimitedForHeaderStyle(nextAccount!, "gemini", "Alloy")).toBe(false);
    });

    it("should only fall back to gemini-cli when ALL accounts exhausted Alloy", () => {
      const stored: AccountStorageV3 = {
        version: 3,
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        ],
        activeIndex: 0,
        activeIndexByFamily: { claude: 0, gemini: 0 },
      };

      const manager = new AccountManager(undefined, stored);
      const accounts = manager.getAccounts();
      
      // Both accounts' Alloy are rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "Alloy");
      manager.markRateLimited(accounts[1]!, 60000, "gemini", "Alloy");

      // Verify no account has Alloy available
      expect(manager.hasOtherAccountWithAlloyAvailable(0, "gemini", null)).toBe(false);
      expect(manager.hasOtherAccountWithAlloyAvailable(1, "gemini", null)).toBe(false);

      // Account 0's gemini-cli should still be available for fallback
      expect(manager.isRateLimitedForHeaderStyle(accounts[0]!, "gemini", "gemini-cli")).toBe(false);
      expect(manager.getAvailableHeaderStyle(accounts[0]!, "gemini")).toBe("gemini-cli");
    });
  });
});
