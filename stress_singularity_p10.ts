import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import { InterAgentBus } from './gateway/src/orchestration/InterAgentBus';

/**
 * stress_singularity_p10: Forensic Chaos Suite
 * Certifying Phase 10 with Extreme Edge Cases.
 */

async function runTraversalAttack() {
  console.log('\n[CHAOS] S1: Path Traversal Attack (Relative)');
  const memory = new SharedMemory('.', 'chaos-test');
  await memory.init();

  try {
    await memory.secureMcpRead('../../../../etc/passwd');
    console.error('CRITICAL FAIL: Shadow-FS allowed traversal outside project root!');
  } catch (e: any) {
    console.log(`PASS: Traversal blocked. Message: ${e.message}`);
  }
}

async function runSensitiveBypass() {
  console.log('\n[CHAOS] S2: Sensitive File Bypass (.env Protection)');
  const memory = new SharedMemory('.', 'chaos-test');
  await memory.init();

  try {
    await memory.secureMcpRead('.env');
    console.error('CRITICAL FAIL: Shadow-FS allowed access to sensitive .env file!');
  } catch (e: any) {
    console.log(`PASS: Sensitive file blocked. Message: ${e.message}`);
  }
}

async function runSenateTimeout() {
  console.log('\n[CHAOS] S3: Senate Timeout (Silent Quorum)');
  const memory = new SharedMemory('.', 'chaos-test');
  await memory.init();
  const vault = memory.getMcpVault();

  console.log('Requesting installation of high-risk MCP (Timeout Test: 2s simulation)...');
  
  // Note: Real timeout is 60s, but for stress test we'll verify it returns a promise that we can race.
  const authTask = vault.authorizeInstallation('Chaos-Server');
  
  // Race against 2s timeout
  const result = await Promise.race([
    authTask,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Test Timeout Accomplished')), 2000))
  ]).catch(err => err.message);

  if (result === 'Test Timeout Accomplished') {
    console.log('PASS: Senate authorization is correctly asynchronous and blocking.');
  } else {
    console.log(`RESULT: ${result}`);
  }
}

async function main() {
  console.log('=== SINGULARITY-PRIME DEEP STRESS SUITE STARTING ===');
  await runTraversalAttack();
  await runSensitiveBypass();
  await runSenateTimeout();
  console.log('\n=== ALL FORENSIC CHAOS SCENARIOS COMPLETED ===');
}

main();
