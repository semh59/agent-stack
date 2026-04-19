import { AntigravityClient } from "../src/orchestration/antigravity-client";
import { AccountManager } from "../src/plugin/accounts";
import { loadConfig } from "../src/plugin/config/loader";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const config = loadConfig(projectRoot);
  const accountManager = await AccountManager.loadFromDisk();
  
  const accounts = accountManager.getAccounts();
  const primaryAccount = accounts[0];
  if (!primaryAccount) {
    console.error("No accounts found. Cannot discover models.");
    return;
  }

  const client = new AntigravityClient(
    accountManager,
    config,
    "antigravity",
    async () => accountManager.toAuthDetails(primaryAccount)
  );

  console.log("[Discovery] Probing Antigravity proxy for models...");
  
  try {
    // Attempt standard OpenAI-style models list
    const response = await (client as any).fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      method: 'GET'
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'No body');
        console.error(`Status ${response.status}: Failed to fetch models. Error: ${errorText}`);
        return;
    }

    const data = await response.json();
    const models = data.models || [];
    console.log(`[Discovery] Found ${models.length} models.`);
    
    const names = models.map((m: any) => m.name.replace('models/', ''));
    console.log("[Discovery] List of available models:", names);

    // Update agents.ts if we found valid ones
    if (names.length > 0) {
        await updateAgentsTs(names, projectRoot);
    }

  } catch (err) {
    console.error("[Discovery] Error during model discovery:", err);
  }
}

async function updateAgentsTs(names: string[], projectRoot: string) {
    const agentsPath = path.join(projectRoot, "src", "orchestration", "agents.ts");
    let content = await fs.readFile(agentsPath, "utf-8");

    // Strategy: Find constants and replace them with the best matches from 'names'
    const replacements = [
        { key: "OPUS", pattern: /claude.*opus.*thinking/i },
        { key: "SONNET", pattern: /claude.*sonnet.*thinking/i },
        { key: "GEMINI_PRO", pattern: /gemini.*pro|gemini.*3.*1/i },
        { key: "GEMINI_FLASH", pattern: /gemini.*flash/i }
    ];

    for (const r of replacements) {
        const match = names.find(n => r.pattern.test(n));
        if (match) {
            const fullMatch = `google/${match}`;
            const target = new RegExp(`${r.key}: ".*"`, 'g');
            content = content.replace(target, `${r.key}: "${fullMatch}"`);
            console.log(`[Discovery] Updated ${r.key} -> ${fullMatch}`);
        }
    }

    await fs.writeFile(agentsPath, content);
    console.log("[Discovery] agents.ts updated successfully.");
}

main().catch(console.error);
