import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function testRetinaEye() {
  console.log('\n--- 1. "The Retina Eye" (Visual Verification) ---');
  const projectRoot = '.';
  const memory = new SharedMemory(projectRoot, 'retinatest');
  await memory.init();

  console.log('Initializing Browser (Headless)...');
  await memory.initBrowser(true);

  try {
    const testHtml = `
      <html>
        <body>
          <header><h1>Alloy Dashboard</h1></header>
          <main>
            <button id="deploy-btn" aria-label="Deploy Application">Deploy</button>
            <a href="/logs">View Logs</a>
          </main>
        </body>
      </html>
    `;
    const dataUri = `data:text/html;base64,${Buffer.from(testHtml).toString('base64')}`;

    console.log('Navigating to Test Data URI...');
    await memory.executeBrowserAction({ type: 'navigate', url: dataUri });

    console.log('Capturing DOM Snapshot...');
    const snapshot = await memory.getVisualDomSnapshot();
    
    // Deep log of snapshot structure
    const printTree = (nodes: any[], depth = 0) => {
      for (const node of nodes) {
        console.log(`${'  '.repeat(depth)}[${node.tagName}] Role: ${node.role || '-'}, Name: ${node.name || '-'}`);
        if (node.children) printTree(node.children, depth + 1);
      }
    };
    printTree(snapshot);

    const hasButton = JSON.stringify(snapshot).includes('Deploy Application');
    if (hasButton) {
      console.log('SUCCESS: Visual DOM Snapshot captured button semantic data.');
    } else {
      console.error('FAIL: Missing semantic data in DOM snapshot.');
    }

    console.log('Capturing Screenshot...');
    const screenshotPath = 'omniview-test.png';
    await memory.executeBrowserAction({ type: 'screenshot', path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);

  } finally {
    await memory.closeBrowser();
  }
}

async function testHippocampusMemory() {
  console.log('\n--- 2. "The Hippocampus Memory" (Context Hydration) ---');
  const projectRoot = '.';
  const memory = new SharedMemory(projectRoot, 'hp-test');
  await memory.init();

  console.log('Hydrating Active Task...');
  await memory.hydrateTaskContext({
    id: 'P7-01',
    name: 'Verification Loop',
    status: 'executing',
    startTime: new Date().toISOString(),
    subTasks: [{ name: 'Retina Test', status: 'completed' }]
  });

  console.log('Recording ADR...');
  await memory.recordArchitectureDecision({
    id: 'ADR-101',
    timestamp: new Date().toISOString(),
    title: 'Adoption of Playwright',
    status: 'accepted',
    context: 'Need visual verification',
    decision: 'Use Playwright Chromium',
    consequences: 'Requires browser installation in CI'
  });

  console.log('Retrieving Context Snapshot...');
  const ctx = await memory.getContextSnapshot();
  console.log('Active Task Found:', !!ctx.activeTask);
  console.log('Recent Decisions Count:', (ctx.recentDecisions as any[]).length);

  if (ctx.activeTask && (ctx.recentDecisions as any[]).length > 0) {
    console.log('SUCCESS: Context hydration verified.');
  } else {
    console.error('FAIL: Context hydration failed.');
  }
}

async function main() {
  try {
    await testRetinaEye();
    await testHippocampusMemory();
  } catch (e) {
    console.error('P7 Verification Error:', e);
  }
}

main();
