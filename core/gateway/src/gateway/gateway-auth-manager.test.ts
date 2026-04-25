import { describe, expect, it } from "vitest";
import { GatewayAuthManager } from "./gateway-auth-manager";

describe("GatewayAuthManager", () => {
  it("accepts active token and rotated grace token", () => {
    const manager = new GatewayAuthManager("token_a");
    expect(manager.isAuthorized("token_a")).toBe(true);

    const rotated = manager.rotateToken("token_b", 5_000);
    expect(rotated.token).toBe("token_b");
    expect(manager.isAuthorized("token_b")).toBe(true);
    expect(manager.isAuthorized("token_a")).toBe(true);
  });

  it("revokes grace tokens immediately", () => {
    const manager = new GatewayAuthManager("token_a");
    manager.rotateToken("token_b", 60_000);
    expect(manager.isAuthorized("token_a")).toBe(true);
    manager.revokeGraceTokens();
    expect(manager.isAuthorized("token_a")).toBe(false);
    expect(manager.isAuthorized("token_b")).toBe(true);
  });

  it("issues single-use ws tickets", () => {
    const manager = new GatewayAuthManager("token_a");
    const ticket = manager.issueWsTicket("session_1", 60_000);

    expect(manager.consumeWsTicket("session_1", ticket.ticket)).toMatchObject({
      sessionId: "session_1",
      clientId: ticket.clientId,
      generation: ticket.generation,
    });
    expect(manager.consumeWsTicket("session_1", ticket.ticket)).toBeNull();
    expect(manager.consumeWsTicket("session_2", ticket.ticket)).toBeNull();
  });
});
