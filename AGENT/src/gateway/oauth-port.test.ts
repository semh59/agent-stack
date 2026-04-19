import * as net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkOAuthCallbackPortAvailability } from "./oauth-port";

const serversToClose = new Set<net.Server>();

async function listenOnRandomPort(): Promise<{ server: net.Server; port: number }> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve ephemeral port"));
        return;
      }
      serversToClose.add(server);
      resolve({ server, port: address.port });
    });
  });
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  serversToClose.delete(server);
}

afterEach(async () => {
  for (const server of Array.from(serversToClose)) {
    await closeServer(server);
  }
});

describe("checkOAuthCallbackPortAvailability", () => {
  it("reports available=true for a free localhost port", async () => {
    const { server, port } = await listenOnRandomPort();
    await closeServer(server);

    const result = await checkOAuthCallbackPortAvailability(port);
    expect(result.available).toBe(true);
    expect(result.code).toBeUndefined();
  });

  it("reports EADDRINUSE when the callback port is already occupied", async () => {
    const { port } = await listenOnRandomPort();

    const result = await checkOAuthCallbackPortAvailability(port);
    expect(result.available).toBe(false);
    expect(result.code).toBe("EADDRINUSE");
  });
});
