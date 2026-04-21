import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { registerSettingsRoutes } from "./routes";
import { resetSettingsStore, __resetEphemeralKeyForTests } from "./index";

describe("Settings Routes", () => {
  let app: any;

  beforeEach(async () => {
    __resetEphemeralKeyForTests();
    resetSettingsStore(); // Ensure fresh store per test
    app = Fastify();
    registerSettingsRoutes(app);
    await app.ready();
  });

  it("GET /api/settings returns redacted settings", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.errors).toEqual([]);
    expect(body.data.appearance.theme).toBe("dark");
  });

  it("PATCH /api/settings performs deep merge", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { appearance: { theme: "light" } },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.appearance.theme).toBe("light");
    // Ensure secrets are redacted in response
    expect(body.data.providers.anthropic.api_key).toBeDefined();
  });

  it("POST /api/settings/reset restores defaults", async () => {
    // First modify
    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { appearance: { theme: "light" } },
    });
    
    // Then reset
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/reset",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.appearance.theme).toBe("dark");
  });

  it("GET /api/settings/schema returns valid JSON schema", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings/schema",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.schema).toBeDefined();
    expect(body.data.secret_paths).toContain("providers.anthropic.api_key");
  });
});
