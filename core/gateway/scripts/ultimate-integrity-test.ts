import { SequentialPipeline, PlanMode } from '../src/orchestration/sequential-pipeline';
import { SharedMemory } from '../src/orchestration/shared-memory';
import { loadAccounts } from '../src/plugin/storage';
import * as fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'ultimate-integrity-benchmark');
  
  console.log('--- ULTIMATE INTEGRITY STRESS TEST ---');
  console.log(`Test Directory: ${testDir}`);

  // 1. SYSTEM AUDIT: Check Multi-Account State
  const accounts = await loadAccounts();
  const accountCount = accounts?.accounts?.length ?? 0;
  console.log(`[Audit] Active Accounts in Pool: ${accountCount}`);
  
  if (accountCount < 2) {
    console.warn('[Audit] WARNING: Multi-account rotation cannot be fully tested with < 2 accounts.');
  }

  // 2. SETUP ENVIRONMENT
  await fs.mkdir(testDir, { recursive: true });
  const memory = new SharedMemory(testDir);
  await memory.init();
  await memory.clean();

  // 3. CONFIGURE LOOPBACK FOR STRESS SCENARIO
  // Scenario:
  // CEO -> Architect -> Backend (Broken) -> [Backtrack] -> Architect (Fixed) -> Backend (Fixed)
  // This tests:
  // - Reality Anchoring (Exit Code detection)
  // - Self-Healing (Retry on same agent)
  // - Layer-Bound Backtracking (Rollback to previous agent)
  // - Multi-file handling
  
  const loopbackPath = path.join(testDir, '.ai-company', 'llm-loopback.json');
  await fs.mkdir(path.dirname(loopbackPath), { recursive: true });

  const stressData = {
    default: "I am a alloy agent. Proceeding with the requested architecture and implementation steps.",
    ceo: "CEO: Build a High-Performance Logging Service. Requirement: Zero-dependency, file-based.",
    pm: "PM: Ensuring milestone alignment for Logging Service.",
    architect: "Architect: Define a singleton structure for the logger. Use TypeScript.",
    ui_ux: "UI/UX: Define logging format and terminal branding indicators.",
    database: "Database: No DB required, will use native filesystem logging.",
    backend: `
@file: package.json
{
  "name": "alloy-logger",
  "version": "1.0.0",
  "scripts": { "build": "tsc" },
  "devDependencies": { "typescript": "^5.0.0" }
}

@file: tsconfig.json
{
  "compilerOptions": { "target": "ESNext", "module": "CommonJS", "outDir": "./dist", "rootDir": "./src", "strict": true }
}

@file: src/logger.ts
export class Logger {
  static log(msg: string) {
    // INTENTIONAL SYNTAX ERROR: Broken variable assignment
    const broken = 
    console.log("[Alloy] " + msg);
  }
}
`,
    unit_test: `
@file: src/logger.test.ts
import { Logger } from './logger';
Logger.log("Testing integrity...");
`
  };

  await fs.writeFile(loopbackPath, JSON.stringify(stressData, null, 2), 'utf-8');

  const pipeline = new SequentialPipeline(testDir);

  const userTask = `
    Build a zero-dependency TypeScript Logging Service with a Singleton pattern.
    1. Must pass "npm run build".
    2. Must include a usage test.
    Requirement: Proactive error recovery and backtracking verification.
  `;

  console.log('[Stress] Commencing Ultimate Integrity Run...');
  
  try {
    const result = await pipeline.start(userTask, {
      planMode: PlanMode.FULL,
      onAgentComplete: (agent, output) => {
        console.log(`[Stress] ✅ ${agent.name} (${agent.role}) completed.`);
      },
      onError: (agent, error) => {
        console.warn(`[Stress] ❌ ${agent.name} failed: ${error.message} (Triggering autonomous recovery)`);
      }
    });

    console.log(`--- STRESS TEST RESULT ---`);
    console.log(`Final Status: ${result.status}`);
    console.log(`Agents Processed: ${result.completedCount}`);
    
    // 4. VERIFY LOGS
    const logPath = path.join(testDir, '.ai-company', 'verification.log');
    const logs = await fs.readFile(logPath, 'utf-8');
    
    const hasBacktrack = logs.includes('BACKTRACKING');
    const hasRetry = logs.includes('RETRY 1');
    const hasFailure = logs.includes('FAILURE');

    console.log('[Audit] Evidence Verification:');
    console.log(`   - Physical Failure Detected: ${hasFailure ? '✅' : '❌'}`);
    console.log(`   - Self-Healing Logic Fired: ${hasRetry ? '✅' : '❌'}`);
    console.log(`   - Backtracking Logic Fired: ${hasBacktrack ? '✅' : '❌'}`);

    if (hasBacktrack && hasRetry) {
      console.log('🏁 PASS: Ultimate Integrity Verification Successful.');
    } else {
      console.log('⚠️  PARTIAL: Logic fired but some states missing. Check logs.');
    }

  } catch (err) {
    console.error('[Stress] Fatal System Breakdown:', err);
    process.exit(1);
  }
}

main().catch(console.error);
