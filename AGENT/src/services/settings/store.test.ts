import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import {
  SettingsStore,
  resetSettingsStore,
  __resetEphemeralKeyForTests,
  SECRET_PATHS,
} from "./index";

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sov-settings-"));
  return path.join(dir, "settings.db");
}

function testEnv(): NodeJS.ProcessEnv {
  return {
    SOVEREIGN_MASTER_KEY: randomBytes(32).toString("base64"),
    APP_ENV: "test",
  } as NodeJS.ProcessEnv;
}

describe("SettingsStore: defaults", () => {
  let store: SettingsStore;
  let dbPath: string;

  beforeEach(() => {
    __resetEphemeralKeyForTests();
    dbPath = tempDbPath();
    store = new SettingsStore({ dbPath, env: testEnv() });
  });

  afterEach(() => {
    store.close();
    resetSettingsStore();
  });

  it("returns a valid defaulted settings object on first read", () => {
    // First read initializes nothing on disk yet â€” still produces defaults.
    const s = store.getSettings();
    expect(s.providers.ollama.base_url).toBe("http://127.0.0.1:11434");
    expect(s.appearance.theme).toBe("dark");
    expect(s.appearance.language).toBe("tr");
  });

  it("getSettingsRedacted replaces secret fields with { set: false }", () => {
    const r = store.getSettingsRedacted();
    expect(r.providers.openrouter.api_key).toEqual({ set: false, updated_at: undefined });
    expect(r.providers.anthropic.api_key).toEqual({ set: false, updated_at: undefined });
  });
});

describe("SettingsStore: writes", () => {
  let store: SettingsStore;

  beforeEach(() => {
    __resetEphemeralKeyForTests();
    store = new SettingsStore({ dbPath: tempDbPath(), env: testEnv() });
  });

  afterEach(() => {
    store.close();
    resetSettingsStore();
  });

  it("persists non-secret fields across reads", () => {
    store.setSettings({
      providers: {
        ollama: { base_url: "http://localhost:11500", default_model: "llama3" },
      },
    } as never);
    const s = store.getSettings();
    expect(s.providers.ollama.base_url).toBe("http://localhost:11500");
    expect(s.providers.ollama.default_model).toBe("llama3");
  });

  it("stores secrets encrypted and redacts them in the public view", () => {
    store.setSettings({
      providers: {
        openrouter: { api_key: "sk-" + "v1-deadbeef" },
      },
    } as never);

    // Redacted â€” UI-safe
    const r = store.getSettingsRedacted();
    expect(r.providers.openrouter.api_key.set).toBe(true);
    expect((r.providers.openrouter.api_key as { value?: string }).value).toBeUndefined();

    // Private accessor returns plaintext
    expect(store.getSecret("providers.openrouter.api_key")).toBe("sk-" + "v1-deadbeef");
  });

  it("leaves existing secrets alone when they're absent from the patch", () => {
    store.setSettings({
      providers: { openrouter: { api_key: "sk-" + "or-original" } },
    } as never);
    store.setSettings({
      providers: { openrouter: { default_model: "anthropic/claude-4" } },
    } as never);
    expect(store.getSecret("providers.openrouter.api_key")).toBe("sk-" + "or-original");
  });

  it("clears a secret when the value is explicitly empty string", () => {
    store.setSettings({
      providers: { openrouter: { api_key: "sk-" + "or-wipe-me" } },
    } as never);
    expect(store.getSecret("providers.openrouter.api_key")).toBe("sk-" + "or-wipe-me");

    store.setSettings({
      providers: { openrouter: { api_key: "" } },
    } as never);
    expect(store.getSecret("providers.openrouter.api_key")).toBeNull();
  });

  it("clears a secret when the value is explicitly null", () => {
    store.setSettings({
      providers: { openrouter: { api_key: "sk-" + "or-nuke-me" } },
    } as never);

    store.setSettings({
      providers: { openrouter: { api_key: null } },
    } as never);
    expect(store.getSecret("providers.openrouter.api_key")).toBeNull();
  });

  it("ignores round-tripped { set: true } tokens from the redacted view", () => {
    store.setSettings({
      providers: { openrouter: { api_key: "sk-or-keep-me" } },
    } as never);
    // UI might re-send the redacted view back on PUT.
    store.setSettings({
      providers: { openrouter: { api_key: { set: true } } },
    } as never);
    expect(store.getSecret("providers.openrouter.api_key")).toBe("sk-or-keep-me");
  });

  it("never stores plaintext secrets in the JSON blob", () => {
    store.setSettings({
      providers: {
        openrouter: { api_key: "sk-" + "or-please-dont-leak" },
        anthropic: { api_key: "sk-" + "ant-dont-leak" },
        openai: { api_key: "sk-" + "oa-dont-leak" },
      },
    } as never);

    const raw = (store as unknown as { db: { prepare: (sql: string) => { get: () => { json: string } } } }).db
      .prepare("SELECT json FROM settings WHERE id = 1")
      .get();
    expect(raw.json).not.toContain("sk-" + "or-please-dont-leak");
    expect(raw.json).not.toContain("sk-" + "ant-dont-leak");
    expect(raw.json).not.toContain("sk-" + "oa-dont-leak");
  });

  it("rejects invalid configs with a ZodError", () => {
    expect(() =>
      store.setSettings({
        providers: {
          ollama: { timeout_s: -5 }, // negative timeout â€” invalid
        },
      } as never),
    ).toThrow();
  });
});

describe("SettingsStore: persistence across instances", () => {
  it("secrets survive a store close/reopen with the same master key", () => {
    __resetEphemeralKeyForTests();
    const env = testEnv();
    const dbPath = tempDbPath();

    const s1 = new SettingsStore({ dbPath, env });
    s1.setSettings({ providers: { anthropic: { api_key: "sk-" + "ant-persistent" } } } as never);
    s1.close();

    const s2 = new SettingsStore({ dbPath, env });
    expect(s2.getSecret("providers.anthropic.api_key")).toBe("sk-" + "ant-persistent");
    s2.close();
  });

  it("secrets become unreadable under a different master key", () => {
    __resetEphemeralKeyForTests();
    const dbPath = tempDbPath();

    const s1 = new SettingsStore({ dbPath, env: testEnv() });
    s1.setSettings({ providers: { anthropic: { api_key: "sk-" + "ant-rotate" } } } as never);
    s1.close();

    const s2 = new SettingsStore({ dbPath, env: testEnv() });
    expect(() => s2.getSecret("providers.anthropic.api_key")).toThrow();
    s2.close();
  });
});

describe("SettingsStore: reset", () => {
  it("wipes secrets and restores defaults", () => {
    __resetEphemeralKeyForTests();
    const store = new SettingsStore({ dbPath: tempDbPath(), env: testEnv() });
    store.setSettings({
      providers: { openrouter: { api_key: "sk-" + "or-will-be-gone" } },
      appearance: { theme: "light" },
    } as never);
    store.reset();
    expect(store.getSecret("providers.openrouter.api_key")).toBeNull();
    expect(store.getSettings().appearance.theme).toBe("dark");
    store.close();
  });
});

describe("SettingsStore: SECRET_PATHS invariant", () => {
  it("every SECRET_PATH round-trips through set/get", () => {
    __resetEphemeralKeyForTests();
    const store = new SettingsStore({ dbPath: tempDbPath(), env: testEnv() });
    const value = "sk-test-value";
    // Build nested input
    const payload: Record<string, unknown> = {};
    for (const p of SECRET_PATHS) {
      const parts = p.split(".");
      let cur: Record<string, unknown> = payload;
      for (let i = 0; i < parts.length - 1; i++) {
        const next = (cur[parts[i]!] as Record<string, unknown>) ?? {};
        cur[parts[i]!] = next;
        cur = next;
      }
      cur[parts[parts.length - 1]!] = value;
    }
    // Azure also needs an endpoint set per schema.
    if ((payload.providers as Record<string, unknown>)?.azure) {
      (payload.providers as Record<string, Record<string, unknown>>).azure!.endpoint =
        "https://example.openai.azure.com";
    }
    store.setSettings(payload as never);
    for (const p of SECRET_PATHS) {
      expect(store.getSecret(p)).toBe(value);
    }
    store.close();
  });
});
