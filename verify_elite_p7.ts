import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function testZIndexShield() {
  console.log('\n--- E1. "The Z-Index Shield" (Occlusion Stress) ---');
  const memory = new SharedMemory('.', 'ztest');
  await memory.init();
  await memory.initBrowser(true);

  try {
    const testHtml = `
      <html>
        <body>
          <button id="target" style="position:absolute; top:50px; left:50px; width:100px; height:50px;">Target</button>
          <div id="modal" style="position:absolute; top:0; left:0; width:200px; height:200px; background:rgba(0,0,0,0.5); z-index:100;">
            MODAL OVERLAY
          </div>
        </body>
      </html>
    `;
    const dataUri = `data:text/html;base64,${Buffer.from(testHtml).toString('base64')}`;
    await memory.executeBrowserAction({ type: 'navigate', url: dataUri });

    console.log('Attempting to click occluded button #target...');
    try {
      await memory.executeBrowserAction({ type: 'click', selector: '#target' });
      console.error('FAIL: Clicked an occluded button! Protection failed.');
    } catch (e: any) {
      console.log(`SUCCESS: Blocked correctly. Error: ${e.message}`);
    }
  } finally {
    await memory.closeBrowser();
  }
}

async function testPerceptualHash() {
  console.log('\n--- E2. "The Visual Fingerprint" (pHash Stress) ---');
  const memory = new SharedMemory('.', 'phashtest');
  await memory.init();
  await memory.initBrowser(true);

  try {
    const page1 = `<html><body><button name="btn">Submit</button></body></html>`;
    const page2 = `<html><body><button name="btn">Login</button></body></html>`; // Text change

    await memory.executeBrowserAction({ type: 'navigate', url: `data:text/html;base64,${Buffer.from(page1).toString('base64')}` });
    const snap1 = await memory.getVisualDomSnapshot();

    await memory.executeBrowserAction({ type: 'navigate', url: `data:text/html;base64,${Buffer.from(page2).toString('base64')}` });
    const snap2 = await memory.getVisualDomSnapshot();

    const findButton = (nodes: any[]): any => {
      for (const n of nodes) {
        if (n.tagName === 'BUTTON') return n;
        if (n.children) {
          const res = findButton(n.children);
          if (res) return res;
        }
      }
      return null;
    };

    const b1 = findButton(snap1);
    const b2 = findButton(snap2);

    const hash1 = b1?.visualHash;
    const hash2 = b2?.visualHash;

    console.log(`Hash 1 (Submit): ${hash1}`);
    console.log(`Hash 2 (Login): ${hash2}`);

    if (hash1 && hash2 && hash1 !== hash2) {
      console.log('SUCCESS: Perceptual hash detected minor text change in UI component.');
    } else {
      console.error('FAIL: Perceptual hash collision or missing hashes.');
      if (!hash1) console.log('Full Snapshot Tree:', JSON.stringify(snap1, null, 2));
    }
  } finally {
    await memory.closeBrowser();
  }
}

async function testSynapseLink() {
  console.log('\n--- E3. "The Synapse Synch" (Visual-Structural Link) ---');
  const memory = new SharedMemory('.', 'synapsetest');
  await memory.init();
  
  // Mock an AST structure in a dummy file
  const dummyFile = path.resolve('synapse_dummy.ts');
  await fs.writeFile(dummyFile, `export class Dashboard { process() { console.log('hi'); } }`);

  try {
    const mockDomNode: any = {
      tagName: 'BUTTON',
      name: 'process',
      visualHash: 'abc123'
    };

    console.log('Linking Visual Button [process] to synapse_dummy.ts...');
    const link = await memory.findSourceForVisualNode(dummyFile, mockDomNode);

    if (link && link.line > 0) {
      console.log(`SUCCESS: Synapse linked visual [process] to Source Line: ${link.line} (Confidence: ${link.confidence})`);
    } else {
      console.error('FAIL: Synapse failed to link visual to AST.');
    }
  } finally {
    await fs.unlink(dummyFile);
  }
}

async function main() {
  try {
    await testZIndexShield();
    await testPerceptualHash();
    await testSynapseLink();
  } catch (e) {
    console.error('Elite Verification Error:', e);
  }
}

main();
