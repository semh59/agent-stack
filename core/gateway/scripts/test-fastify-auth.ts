import fastify from "fastify";
import { registerAuthRoutes } from "../src/api/routers/auth.router";

async function main() {
  const app = fastify();
  
  // mock dependencies
  const mockTokenStore = {
    getAllAccounts: () => [],
    addOrUpdateAccount: () => {},
    removeAccount: () => {}
  } as any;

  const mockAuthManager = {
    isAuthorized: () => true,
    getTokenState: () => ({ valid: true }),
    rotateToken: () => ({ token: "new" }),
    revokeGraceTokens: () => {}
  } as any;

  registerAuthRoutes(app, {
    tokenStore: mockTokenStore,
    authManager: mockAuthManager
  });

  await app.listen({ port: 51234 });
  console.log("Mock server listening on 51234");
  
  try {
    const res = await fetch("http://127.0.0.1:51234/api/auth/login?provider=google&token=mock");
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Body:", text);
  } catch (err) {
    console.error("Fetch error", err);
  }
  
  await app.close();
}

main().catch(console.error);
