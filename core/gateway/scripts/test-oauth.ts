import { getProviderAdapterByName } from "../src/gateway/provider-registry";
import { AuthServer } from "../src/gateway/auth-server";
import { checkOAuthCallbackPortAvailability } from "../src/gateway/oauth-port";

async function main() {
  try {
    console.log("Step 1: Importing plugin/storage");
    const storage = await import("../src/plugin/storage");
    console.log("Step 2: Getting provider adapter");
    const adapter = getProviderAdapterByName("google");
    console.log("Step 3: Checking callback port");
    const portCheck = await checkOAuthCallbackPortAvailability(51121);
    console.log("portCheck", portCheck);
    console.log("Step 4: Getting auth URL");
    const authData = await adapter.getAuthUrl();
    console.log("authData generated!");
  } catch (err) {
    console.error("ERROR CAUGHT:");
    console.error(err);
  }
}

main().catch(console.error);
