import { promises as fs } from "node:fs";
import { KeyManager, type EncryptedPayload } from "../src/plugin/key-manager";
import { getStoragePath, loadAccounts, saveAccounts } from "../src/plugin/storage";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const keyManager = new KeyManager();

async function prompt(question: string, secret = false): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function rotateKeys(): Promise<void> {
  console.log("🔄 Starting key rotation...");
  
  const path = getStoragePath();
  const raw = await fs.readFile(path, "utf-8");
  
  if (!KeyManager.isV3Encrypted(raw)) {
    console.error("❌ Storage is not in v3 format. Please run the application first to migrate.");
    return;
  }

  const encrypted = JSON.parse(raw) as EncryptedPayload;
  const rotated = keyManager.rotate(encrypted);
  
  await fs.writeFile(`${path}.bak`, raw, "utf-8");
  await fs.writeFile(path, JSON.stringify(rotated, null, 2), "utf-8");
  
  console.log("✅ Keys rotated successfully.");
  console.log(`📝 Backup created at ${path}.bak`);
}

async function exportKeys(outputPath: string): Promise<void> {
  const passphrase = await prompt("🔑 Enter passphrase for export (min 12 chars): ");
  if (passphrase.length < 12) {
    console.error("❌ Passphrase too short!");
    return;
  }

  const storage = await loadAccounts();
  if (!storage) {
    console.error("❌ No accounts to export.");
    return;
  }

  const bundle = await keyManager.exportBundle(storage, passphrase);
  await fs.writeFile(outputPath, bundle, "utf-8");
  
  console.log(`✅ Accounts exported to ${outputPath}`);
}

async function importKeys(inputPath: string): Promise<void> {
  const passphrase = await prompt("🔑 Enter passphrase for import: ");
  const bundleJson = await fs.readFile(inputPath, "utf-8");
  
  try {
    const data = await keyManager.importBundle(bundleJson, passphrase);
    await saveAccounts(data as any);
    console.log("✅ Accounts imported and re-encrypted for this machine.");
  } catch (err) {
    console.error("❌ Import failed: Invalid passphrase or corrupted bundle.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "rotate-keys":
      await rotateKeys();
      break;
    case "export-keys":
      const out = args[1] || "alloy-export.bundle";
      await exportKeys(out);
      break;
    case "import-keys":
      const from = args[1];
      if (!from) {
        console.error("❌ Missing input file path. Usage: import-keys <path>");
        process.exit(1);
      }
      await importKeys(from);
      break;
    default:
      console.log("Alloy AI Key Manager");
      console.log("Usage:");
      console.log("  rotate-keys             - Rotate encryption keys");
      console.log("  export-keys [path]      - Export accounts to an encrypted bundle");
      console.log("  import-keys <path>      - Import accounts from a bundle");
  }
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
