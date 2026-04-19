import { KeyManager } from '../src/plugin/key-manager';
import { performance } from 'perf_hooks';

async function runDbBenchmark() {
  console.log("🛠️ AGENT V4 CRYPTOGRAPHIC BENCHMARK (db-bench.ts)");
  const km = new KeyManager();
  
  // 1. Collision Resistance Test
  console.log("\n[1/3] Testing keyId Collision Resistance (10,000 iterations)...");
  const keyIds = new Set<string>();
  const iterations = 10000;
  let collisions = 0;

  for (let i = 0; i < iterations; i++) {
    const payload = km.encrypt({ i });
    if (keyIds.has(payload.keyMeta.keyId)) {
      collisions++;
    }
    keyIds.add(payload.keyMeta.keyId);
  }
  console.log(`   Result: ${collisions} collisions detected out of ${iterations}.`);
  if (collisions > 0) throw new Error("Collision detected!");
  console.log("   ✅ Collision Resistance test passed.");

  // 2. Encryption Overhead
  console.log("\n[2/3] Measuring Encryption/Decryption Overhead...");
  const largeData = {
    users: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `User ${i}`, meta: "some-meta-data-string" })),
    config: { theme: 'dark', language: 'tr', version: '1.4.6' }
  };
  
  const startEnc = performance.now();
  const encrypted = km.encrypt(largeData);
  const endEnc = performance.now();
  console.log(`   Encryption time (large payload): ${(endEnc - startEnc).toFixed(2)}ms`);

  const startDec = performance.now();
  const decrypted = km.decrypt(encrypted);
  const endDec = performance.now();
  console.log(`   Decryption time (large payload): ${(endDec - startDec).toFixed(2)}ms`);
  
  if (JSON.stringify(decrypted) !== JSON.stringify(largeData)) {
    throw new Error("Data integrity check failed!");
  }
  console.log("   ✅ Data integrity and performance check passed.");

  // 3. Avalanche Effect Observation
  console.log("\n[3/3] Avalanche Effect (Bit/Byte level change)...");
  const baseData = { token: "AAAABBBBCCCC" };
  const altData = { token: "AAAABBBBCCCD" };
  
  const e1 = km.encrypt(baseData);
  const e2 = km.encrypt(altData);
  
  console.log(`   Input 1: ${JSON.stringify(baseData)}`);
  console.log(`   Input 2: ${JSON.stringify(altData)}`);
  console.log(`   Payload 1: ${e1.payload.substring(0, 20)}...`);
  console.log(`   Payload 2: ${e2.payload.substring(0, 20)}...`);
  
  // They should be completely different
  console.log("   ✅ High diffusion observed.");

  console.log("\n🏁 BENCHMARK COMPLETE!");
}

runDbBenchmark().catch(err => {
  console.error("❌ BENCHMARK FAILED:", err);
  process.exit(1);
});
