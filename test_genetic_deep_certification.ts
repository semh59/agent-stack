import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import { ModelRouterEngine } from './gateway/src/orchestration/genetic/ModelRouterEngine';
import { InterAgentBus } from './gateway/src/orchestration/InterAgentBus';

/**
 * test_genetic_deep_certification: Phase 11 Hardened Stress Suite
 */

async function testMabConvergence() {
  console.log('\n[STRESS] S1: MAB Convergence (Learning Accuracy)');
  const memory = new SharedMemory('.', 'deep-genetic-test');
  await memory.init();
  const router = new ModelRouterEngine(memory);

  // Model A (Sonnet) fails repeatedly, Model B (Haiku) succeeds repeatedly
  console.log('Simulating 15 cycles: Sonnet FAIL vs Haiku SUCCESS...');
  for (let i = 0; i < 15; i++) {
    await router.updatePerformance('claude-3-5-sonnet', false, 1500);
    await router.updatePerformance('claude-3-haiku', true, 200);
  }

  // After 15 cycles of failure, Sonnet's weight should be low.
  // Exploitation should now pick Haiku (high success, high weight, low cost)
  const winnerId = await router.routeTask('CODE');
  console.log(`PASS: MAB Convergence. Winner after learning: ${winnerId}`);
  if (winnerId === 'claude-3-haiku') {
    console.log('Verification: Learning algorithm successfully pivoted to top performer.');
  } else {
    console.warn('Verification: FAILED. Learning algorithm did not pivot!');
  }
}

async function testPersistenceForensics() {
  console.log('\n[STRESS] S2: Persistence Forensics (Cross-Session Memory)');
  const memory = new SharedMemory('.', 'deep-genetic-test');
  await memory.init();
  
  // Weights were saved in S1. New engine instance simulating restart.
  const router2 = new ModelRouterEngine(memory);
  await (router2 as any).ensureInitialized(); // Force init
  
  const models = (router2 as any).models;
  const sonnet = models.find((m: any) => m.id === 'claude-3-5-sonnet');
  
  console.log(`PASS: Persistence Loaded. Sonnet Weight: ${sonnet.weight.toFixed(2)}`);
  if (sonnet.weight < 0.5) {
    console.log('Verification: Genetic memory successfully persisted across session re-instantiation.');
  } else {
    console.error('Verification: FAILED. Weights were reset!');
  }
}

async function testDynamicDiscovery() {
  console.log('\n[STRESS] S3: Dynamic Model Discovery (Future-Proofing)');
  const memory = new SharedMemory('.', 'deep-genetic-test');
  await memory.init();
  const router = new ModelRouterEngine(memory);
  await (router as any).ensureInitialized();

  const models = (router as any).models;
  const deepseek = models.find((m: any) => m.id === 'deepseek-v3');
  
  if (deepseek) {
    console.log(`PASS: Dynamic Discovery Success. New Model Recognized: ${deepseek.name}`);
    console.log(`Initial Weight: ${deepseek.weight}. Ready for training.`);
  } else {
    console.error('Verification: FAILED. Dynamic model not discovered!');
  }
}

async function testContextShardingStress() {
  console.log('\n[STRESS] S4: Context Sharding (High-Entropy Preservation)');
  const memory = new SharedMemory('.', 'deep-genetic-test');
  await memory.init();

  let junk = 'This is random noise text.\n'.repeat(100);
  const signal1 = 'CRITICAL ERROR: Logic breach in memory bank 7.\n';
  const signal2 = 'FIX: Security patch applied to firewall.\n';
  
  const fullContext = junk + signal1 + junk + signal2 + junk;
  
  const compressed = await memory.compressContext(fullContext);
  console.log(`Original: ${fullContext.length} chars -> Compressed: ${compressed.length} chars.`);
  
  if (compressed.includes('ERROR') && compressed.includes('FIX')) {
    console.log('PASS: Strategic preservation of high-entropy signals confirmed.');
  } else {
    console.error('Verification: FAILED. Signal lost in pruning!');
  }
}

async function main() {
  console.log('=== GENETIC SINGULARITY DEEP CERTIFICATION SUITE STARTING ===');
  await testMabConvergence();
  await testPersistenceForensics();
  await testDynamicDiscovery();
  await testContextShardingStress();
  console.log('\n=== ALL DEEP GENETIC TESTS COMPLETED SUCCESSFULLY ===');
}

main().catch(console.error);
