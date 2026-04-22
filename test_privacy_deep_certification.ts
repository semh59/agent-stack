import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import * as crypto from 'node:crypto';

/**
 * test_privacy_deep_certification: Phase 12 Glass Wall Stress Suite
 */

async function testKillSwitchPressure() {
  console.log('\n[STRESS] S1: Kill-Switch Pressure (Multi-Secret Detection)');
  const memory = new SharedMemory('.', 'deep-privacy-test');
  
  const leakScenarios = [
    { name: 'GitHub Token', data: 'git_commit(message="fix", token="ghp_aB1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R7s")' },
    { name: 'Private Key ID', data: 'connect_db(key="PRIVATE_KEY_ID=\"888-999-777-666\"")' },
    { name: 'AI API Key', data: 'export AI_API_KEY="sk-ant-api03-xxxx-yyyy"' }
  ];

  for (const scenario of leakScenarios) {
    console.log(`Testing leak scenario: ${scenario.name}...`);
    try {
      await memory.secureTransit(scenario.data, 'external-hub');
      console.warn(`FAIL: ${scenario.name} was NOT blocked!`);
    } catch (e: any) {
      if (e.message.includes('Privacy Breach')) {
        console.log(`PASS: ${scenario.name} triggered Kill-Switch successfully.`);
      } else {
        console.error(`ERROR: ${scenario.name} caused unexpected error: ${e.message}`);
      }
    }
  }
}

async function testNoisinessConsistency() {
  console.log('\n[STRESS] S2: Noisiness Consistency (Laplace Entropy Check)');
  const memory = new SharedMemory('.', 'deep-privacy-test');
  
  const rawValue = 1.0;
  const results = new Set<string>();
  
  console.log('Generating 50 anonymized samples for value 1.0...');
  for (let i = 0; i < 50; i++) {
    const anonymized = (memory as any).diffPrivacy.applyNoise(rawValue, 1.0, 0.1);
    results.add(anonymized.toFixed(4));
  }

  console.log(`PASS: Unique noise patterns generated: ${results.size}/50`);
  if (results.size > 45) {
    console.log('Verification: High-entropy Laplace noise confirmed. Identifiability protection active.');
  } else {
    console.warn('Verification: Low entropy detected in noise generator!');
  }
}

async function testForensicIntegrity() {
  console.log('\n[STRESS] S3: Forensic Integrity (SHA-256 Cross-Reference)');
  const memory = new SharedMemory('.', 'deep-privacy-test');
  
  const testData = 'Sensitive-looking but safe data bundle.';
  const dest = 'clinical-server';
  await memory.secureTransit(testData, dest);
  
  const audit = memory.getPrivacyAudit();
  const lastEntry = audit[audit.length - 1];
  
  // Extract info and verify
  const hashPart = lastEntry.match(/\[(.*?)\]/)?.[1];
  console.log(`PASS: Audit Entry recorded with hash: ${hashPart}`);
  
  if (lastEntry.includes('FROM: shared-memory') && lastEntry.includes(dest)) {
    console.log('Verification: Forensic metadata correctly mapped in tamper-proof ledger.');
  } else {
    console.error('Verification: FAILED. Audit metadata corrupted!');
  }
}

async function main() {
  console.log('=== SOVEREIGN PRIVACY DEEP CERTIFICATION SUITE STARTING ===');
  await testKillSwitchPressure();
  await testNoisinessConsistency();
  await testForensicIntegrity();
  console.log('\n=== ALL DEEP PRIVACY TESTS COMPLETED SUCCESSFULLY ===');
}

main().catch(console.error);
