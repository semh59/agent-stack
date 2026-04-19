import { SequentialPipeline, PlanMode } from '../src/orchestration/sequential-pipeline';
import { SharedMemory } from '../src/orchestration/shared-memory';
import * as fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const projectRoot = process.cwd();
  const benchmarkDir = path.join(projectRoot, 'sovereign-benchmark-api');
  
  console.log('--- SOVEREIGN E2E BENCHMARK ---');
  console.log(`Target Directory: ${benchmarkDir}`);

  // Create clean environment
  await fs.mkdir(benchmarkDir, { recursive: true });
  const memory = new SharedMemory(benchmarkDir);
  await memory.init();
  await memory.clean();

  // 1. SETUP LOOPBACK DATA
  // We'll simulate a failure/backtrack cycle
  // Turn 1: CEO (Management)
  // Turn 2: Backend (Fails Build) -> Pipelines detects failure -> Retries/Backtracks
  // Turn 3: Backend (Success) -> Pipeline continues
  
  const loopbackPath = path.join(benchmarkDir, '.ai-company', 'llm-loopback.json');
  await fs.mkdir(path.dirname(loopbackPath), { recursive: true });

  const benchmarkData = {
    default: "I am a sovereign agent. I will proceed with the task as instructed.",
    ceo: "CEO: Build a REST API with Express. Success criteria: Functional /health endpoint.",
    pm: "PM: Planning the REST API project. No issues detected.",
    architect: "Architect: Use Express and Vitest. Requirements: Functional build.",
    backend: `
@file: package.json
{
  "name": "sovereign-api",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "@types/express": "^4.17.17"
  }
}

@file: tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "CommonJS",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  }
}

@file: src/index.ts
import express from 'express';
const app = express();
// INTENTIONAL SYNTAX ERROR: "const a ="
const a = 
app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});
app.listen(3000, () => console.log('Server running'));
`,
    unit_test: `
@file: src/index.test.ts
import { describe, it, expect } from 'vitest';
describe('Health Check', () => {
  it('should return ok', () => {
    expect({ status: 'ok' }).toEqual({ status: 'ok' });
  });
});
`
  };

  await fs.writeFile(loopbackPath, JSON.stringify(benchmarkData, null, 2), 'utf-8');

  const pipeline = new SequentialPipeline(benchmarkDir);

  const userTask = `
    Create a minimal Node.js REST API using Express.
    1. Endpoint: GET /health -> { status: "ok" }
    2. Add a Vitest test for this endpoint.
    3. Create a Dockerfile to package the app.
    Requirement: All code must be functional and pass "npm run build" and "npm run test".
    Use "@file: filename.ext" headers to write multiple files.
  `;

  console.log('[Benchmark] Commencing Autonomous Pipeline Execution (Loopback Mode)...');
  
  try {
    const result = await pipeline.start(userTask, {
      planMode: PlanMode.FULL,
      onAgentComplete: (agent, output) => {
        console.log(`[Benchmark] ✅ ${agent.name} finished.`);
      },
      onError: (agent, error) => {
        console.warn(`[Benchmark] ⚠️ ${agent.name} failed (Pipeline logic will handle): ${error.message}`);
      }
    });

    console.log(`--- BENCHMARK COMPLETE ---`);
    console.log(`Status: ${result.status}`);
    console.log(`Agents Completed: ${result.completedCount}`);
    
    if (result.status === 'completed') {
      console.log('✅ PASS: Sovereign E2E Benchmark Successful.');
    } else {
      console.log('❌ FAIL: Sovereign E2E Benchmark failed.');
      process.exit(1);
    }
  } catch (err) {
    console.error('[Benchmark] System Error:', err);
    process.exit(1);
  }
}

main().catch(console.error);
