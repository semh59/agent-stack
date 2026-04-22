import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import { InterAgentBus } from './gateway/src/orchestration/InterAgentBus';

async function testSingularityNeuralDiscovery() {
  console.log('\n--- S1. "The Project Matchmaker" (Neural Discovery) ---');
  const memory = new SharedMemory('.', 'singularity-test');
  await memory.init();

  const bus = InterAgentBus.getInstance();
  let installCount = 0;
  bus.on('broadcast', (msg) => {
    if (msg.payload?.message?.includes('Autonomous MCP Installation')) {
      installCount++;
    }
  });

  console.log('Running Neural Project Inference...');
  await memory.optimizeMcpEcosystem();

  if (installCount > 0) {
    console.log(`SUCCESS: McpMatchmaker automatically deployed ${installCount} trusted servers.`);
  } else {
    console.error('FAIL: No autonomous installations detected.');
  }
}

async function testShadowFSProtection() {
  console.log('\n--- S2. "The Shadow Shield" (Shadow-FS Isolation) ---');
  const memory = new SharedMemory('.', 'shadow-test');
  await memory.init();

  try {
    console.log('Attempting to read protected .env file via Shadow-FS...');
    await memory.secureMcpRead('.env');
    console.error('FAIL: Shadow-FS allowed access to protected .env!');
  } catch (e: any) {
    console.log(`SUCCESS: Shadow-FS blocked unauthorized access. Reason: ${e.message}`);
  }
}

async function testSenateAuthGating() {
  console.log('\n--- S3. "The Singularity Senate" (Auth Gating) ---');
  const memory = new SharedMemory('.', 'auth-test');
  await memory.init();
  const bus = InterAgentBus.getInstance();

  let voteRequested = false;
  const voteCheck = (msg: any) => {
    if (msg.type === 'VOTE_REQUEST' && (msg.payload?.sessionId?.includes('mcp-install') || msg.payload?.sessionId?.includes('install-'))) {
      voteRequested = true;
    }
  };

  bus.on('broadcast', voteCheck);
  bus.on('direct:senate', voteCheck);

  console.log('Simulating discovery of API-intensive MCP (HuggingFace)...');
  await memory.optimizeMcpEcosystem();

  if (voteRequested) {
    console.log('SUCCESS: Auth-required MCP triggered a Senate Quorum request.');
  } else {
    console.error('FAIL: No Senate vote requested for Group B MCP.');
  }
}

async function main() {
  try {
    await testSingularityNeuralDiscovery();
    await testShadowFSProtection();
    await testSenateAuthGating();
  } catch (e) {
    console.error('Singularity Verification Error:', e);
  }
}

main();
