
import { getSettingsStore } from "./src/services/settings/store.js";
import path from "node:path";

async function test() {
  console.log("Starting SettingsStore test...");
  try {
    const store = getSettingsStore({
      dbPath: path.resolve("./test-settings.db")
    });
    console.log("Store initialized at:", store.dbPath);
    
    const settings = store.getSettingsRedacted();
    console.log("Settings fetched successfully.");
    console.log("Providers enabled status:");
    Object.entries(settings.providers).forEach(([name, p]: [string, any]) => {
      console.log(` - ${name}: ${p.enabled}`);
    });
    
    store.close();
    console.log("Test completed successfully.");
  } catch (err) {
    console.error("Test failed!");
    console.error(err);
    process.exit(1);
  }
}

test();
