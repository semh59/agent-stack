import { SharedMemory } from '../src/orchestration/shared-memory.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function testParallelLog() {
  const root = path.resolve(process.cwd(), 'temp_test_memory');
  await fs.mkdir(root, { recursive: true });
  const memory = new SharedMemory('temp_test_memory');
  await memory.init();

  console.log('Starting parallel log test...');
  const tasks = [];
  for (let i = 0; i < 50; i++) {
    tasks.push(memory.appendLog(`agent_${i}`, `log message ${i} - detailed information for testing race conditions`));
  }

  await Promise.all(tasks);
  
  const logContent = await fs.readFile(path.join(root, '.ai-company', 'verification.log'), 'utf-8');
  const lines = logContent.trim().split('\n');
  console.log(`Total lines: ${lines.length}`);
  
  if (lines.length === 50) {
    console.log('SUCCESS: All 50 log lines were written without corruption.');
  } else {
    console.log(`FAILURE: Expected 50 lines but got ${lines.length}.`);
  }

  // Cleanup
  await fs.rm(root, { recursive: true, force: true });
}

testParallelLog().catch(console.error);
