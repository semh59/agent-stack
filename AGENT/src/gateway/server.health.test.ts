import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayServer } from "./server";
import { DEFAULT_OAUTH_CALLBACK_PORT } from "./oauth-port";
import { InMemoryMissionRepository } from "../repositories/mission.repository";
import { NoopRecoveryNotifier } from "../persistence/recovery/RecoveryNotifier";
import { TokenStore, type StoredToken } from "./token-store";

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startPortBlocker(port: number): Promise<net.Server | null> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function closePortBlocker(server: net.Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("GatewayServer health and oauth preflight routes", () => {
  const authToken = "test-gateway-token";
  let gateway: GatewayServer | null = null;
  let tmpDir = "";
  let port = 0;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lojinext-gateway-test-"));
    port = await getFreePort();
    gateway = new GatewayServer({
      port,
      projectRoot: tmpDir,
      authToken,
      host: "127.0.0.1",
      missionRepository: new InMemoryMissionRepository(),
      recoveryNotifier: new NoopRecoveryNotifier(),
    });
    await gateway.start();
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
      gateway = null;
    }
    vi.restoreAllMocks();
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("serves /api/health with auth token", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-limit")).toBe("100");

    const body = (await response.json()) as {
      data?: { status?: string; uptimeSec?: number; timestamp?: string; version?: string };
      meta?: { requestId?: string; timestamp?: string };
      errors?: Array<{ message?: string }>;
    };
    expect(body.errors).toEqual([]);
    expect(typeof body.meta?.requestId).toBe("string");
    expect(typeof body.meta?.timestamp).toBe("string");
    expect(body.data?.status).toBe("ok");
    expect(typeof body.data?.uptimeSec).toBe("number");
    expect(typeof body.data?.timestamp).toBe("string");
    expect(typeof body.data?.version).toBe("string");
  });

  it("returns OAUTH_CALLBACK_PORT_IN_USE when callback port is busy", async () => {
    const blocker = await startPortBlocker(DEFAULT_OAUTH_CALLBACK_PORT);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(response.status).toBe(409);

      const body = (await response.json()) as {
        data: null;
        meta?: { requestId?: string; timestamp?: string; port?: number };
        errors?: Array<{ code?: string; message?: string }>;
      };
      expect(body.data).toBeNull();
      expect(typeof body.meta?.requestId).toBe("string");
      expect(body.meta?.port).toBe(DEFAULT_OAUTH_CALLBACK_PORT);
      expect(body.errors?.[0]?.code).toBe("OAUTH_CALLBACK_PORT_IN_USE");
      expect(body.errors?.[0]?.message).toContain("OAuth callback port");
    } finally {
      await closePortBlocker(blocker);
    }
  });

  it("wraps unknown API routes as ROUTE_NOT_FOUND", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(response.status).toBe(404);

    const body = (await response.json()) as {
      data: null;
      meta?: { requestId?: string };
      errors?: Array<{ code?: string; message?: string }>;
    };
    expect(body.data).toBeNull();
    expect(typeof body.meta?.requestId).toBe("string");
    expect(body.errors?.[0]?.code).toBe("ROUTE_NOT_FOUND");
    expect(body.errors?.[0]?.message).toContain("does-not-exist");
  });

  it("mounts canonical mission routes and returns MISSION_NOT_FOUND for unknown missions", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/missions/missing`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status).toBe(404);

    const body = (await response.json()) as {
      data: null;
      meta?: { requestId?: string };
      errors?: Array<{ code?: string; message?: string }>;
    };
    expect(body.data).toBeNull();
    expect(typeof body.meta?.requestId).toBe("string");
    expect(body.errors?.[0]?.code).toBe("MISSION_NOT_FOUND");
  });

  it("returns 401 from POST /api/missions when the active token is expired and refresh fails", async () => {
    const expiredToken: StoredToken = {
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 60_000,
      email: "engineer@example.com",
      createdAt: Date.now() - 120_000,
    };
    vi.spyOn(TokenStore.prototype, "getActiveToken").mockReturnValue(expiredToken);
    vi.spyOn(TokenStore.prototype, "getValidAccessToken").mockResolvedValue(null);

    const response = await fetch(`http://127.0.0.1:${port}/api/missions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Ship mission routes",
      }),
    });

    expect(response.status).toBe(401);

    const body = (await response.json()) as {
      data: null;
      meta?: { requestId?: string };
      errors?: Array<{ code?: string; message?: string }>;
    };
    expect(body.data).toBeNull();
    expect(typeof body.meta?.requestId).toBe("string");
    expect(body.errors?.[0]?.code).toBe("UNAUTHORIZED");
  });
});
