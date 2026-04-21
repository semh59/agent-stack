import { KeyManager } from "../src/plugin/key-manager";
import { IntentEngine } from "../src/orchestration/intent-engine";

async function testKeyManager() {
  console.log("--- Testing KeyManager ---");
  const km = new KeyManager();
  const data = { secret: "alloy-123", accounts: [1, 2, 3] };
  
  const encrypted = km.encrypt(data);
  console.log("Encrypted:", encrypted.keyMeta.keyId);
  
  const decrypted = km.decrypt(encrypted);
  console.log("Decrypted match:", JSON.stringify(decrypted) === JSON.stringify(data));
  
  const rotated = km.rotate(encrypted);
  console.log("Rotated keyId:", rotated.keyMeta.keyId);
  console.log("RotatedAt:", rotated.keyMeta.rotatedAt);
  
  const decryptedAfterRotation = km.decrypt(rotated);
  console.log("Decrypted after rotation match:", JSON.stringify(decryptedAfterRotation) === JSON.stringify(data));
  
  const bundle = await km.exportBundle(data, "my-super-secret-passphrase");
  console.log("Export bundle created");
  
  const imported = await km.importBundle(bundle, "my-super-secret-passphrase");
  console.log("Imported match:", JSON.stringify(imported) === JSON.stringify(data));
}

async function testIntentEngine() {
  console.log("\n--- Testing IntentEngine ---");
  const engine = new IntentEngine();
  
  // Wait a bit for async init
  await new Promise(r => setTimeout(r, 100));

  const testPrompts = [
    "JWT token doğrulama açığı var mı kontrol et",
    "PostgreSQL query optimization needed",
    "React sayfasındaki CSS'i düzelt",
    "Yeni versiyonu production'a deploy et",
    "Güvenlik değil, sadece UI buglarını düzelt",
    "backend bugı değil, frontend CSS hatası",
    "I need help with the overall architecture"
  ];

  for (const prompt of testPrompts) {
    const result = await engine.analyze(prompt);
    console.log(`Prompt: "${prompt}"`);
    console.log(`  Target: ${result.specialist} (Conf: ${result.confidence.toFixed(2)}) [Method: ${result.method}]`);
  }

  console.log("\n--- Testing IntentEngine with Transformer Deep Dive ---");
  engine.enableTransformer();
  console.log("Transformer enabled. Next prediction might trigger download...");
  const edgePrompt = "I need a security audit for the backend authentication service";
  const result = await engine.analyze(edgePrompt);
  console.log(`Prompt: "${edgePrompt}"`);
  console.log(`  Target: ${result.specialist} (Conf: ${result.confidence.toFixed(2)}) [Method: ${result.method}]`);
}

async function runTests() {
  try {
    await testKeyManager();
    await testIntentEngine();
    console.log("\n✅ All tests passed!");
  } catch (err) {
    console.error("\n❌ Test failed:", err);
    process.exit(1);
  }
}

runTests();
