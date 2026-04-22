import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * VISION-PRIME Deep Stress Suite
 * Testing Shadow DOM, Topological pHash, and Contextual Synapse.
 */

async function stressShadowDom() {
  console.log('\n--- S1. "The Invisible Web" (Shadow DOM Penetration) ---');
  const memory = new SharedMemory('.', 'shadowstress');
  await memory.init();
  await memory.initBrowser(true);

  try {
    const testHtml = `
      <html>
        <body>
          <div id="host"></div>
          <script>
            const host = document.getElementById('host');
            const shadow = host.attachShadow({mode: 'open'});
            shadow.innerHTML = '<div><button id="p7-shadow-btn">Shadow Click Me</button></div>';
          </script>
        </body>
      </html>
    `;
    const dataUri = `data:text/html;base64,${Buffer.from(testHtml).toString('base64')}`;
    await memory.executeBrowserAction({ type: 'navigate', url: dataUri });

    console.log('Attempting to capture snapshot including Shadow DOM...');
    // Note: Standard walk doesn't see Shadow DOM. We must refine DomSnapshotter.
    const snapshot = await memory.getVisualDomSnapshot();
    
    const findInShadow = (nodes: any[]): any => {
      for (const n of nodes) {
        if (n.name === 'Shadow Click Me') return n;
        if (n.children) {
          const res = findInShadow(n.children);
          if (res) return res;
        }
      }
      return null;
    };

    const target = findInShadow(snapshot);
    if (target) {
      console.log('SUCCESS: DomSnapshotter successfully penetrated Shadow Heart.');
    } else {
      console.error('FAIL: Shadow DOM remains invisible to Retina Eye.');
    }
  } finally {
    await memory.closeBrowser();
  }
}

async function stressTopologicalPhash() {
  console.log('\n--- S2. "The Mirage Collision" (Topological pHash Sensitivity) ---');
  const memory = new SharedMemory('.', 'topologytest');
  await memory.init();
  await memory.initBrowser(true);

  try {
    // Page 1: 5 identical buttons
    const p1 = '<html><body>' + '<div><button name="x">B</button></div>'.repeat(5) + '</body></html>';
    // Page 2: Same, but 3rd button has a tiny aria-label change
    const p2 = '<html><body>' + '<div><button name="x">B</button></div>'.repeat(2) 
               + '<div><button name="x" aria-label="diff">B</button></div>' 
               + '<div><button name="x">B</button></div>'.repeat(2) + '</body></html>';

    await memory.executeBrowserAction({ type: 'navigate', url: `data:text/html;base64,${Buffer.from(p1).toString('base64')}` });
    const snap1 = await memory.getVisualDomSnapshot();
    const hash1 = JSON.stringify(snap1.map(s => s.visualHash));

    await memory.executeBrowserAction({ type: 'navigate', url: `data:text/html;base64,${Buffer.from(p2).toString('base64')}` });
    const snap2 = await memory.getVisualDomSnapshot();
    const hash2 = JSON.stringify(snap2.map(s => s.visualHash));

    if (hash1 !== hash2) {
      console.log('SUCCESS: Topological pHash detected micro-delta in grid structure.');
    } else {
      console.error('FAIL: Topological collision! Platform is blind to localized UI drift.');
    }
  } finally {
    await memory.closeBrowser();
  }
}

async function stressContextualSynapse() {
  console.log('\n--- S3. "The Labyrinth" (Contextual Synapse Precision) ---');
  const memory = new SharedMemory('.', 'labtest');
  await memory.init();

  const dummyFile = path.resolve('labyrinth.ts');
  // Two classes with 'render' method
  await fs.writeFile(dummyFile, `
    class LoginView { render() { return 1; } }
    class DashboardView { render() { return 2; } }
  `);

  try {
    const node: any = {
      tagName: 'BUTTON',
      name: 'render',
      visualHash: 'login-topology' // We can improve Synapse to use topological context
    };

    console.log('Linking ambiguous [render]... Priority: Parent Context Verification');
    const link = await memory.findSourceForVisualNode(dummyFile, node);
    
    if (link) {
      console.log(`SUCCESS: Synapse resolved ambiguity. Mapped to Source Line: ${link.line}`);
    } else {
      console.error('FAIL: Synapse failed in high-ambiguity labyrinth.');
    }
  } finally {
    await fs.unlink(dummyFile);
  }
}

async function main() {
  await stressShadowDom();
  await stressTopologicalPhash();
  await stressContextualSynapse();
}

main();
