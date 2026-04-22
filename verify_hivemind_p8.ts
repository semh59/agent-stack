import { SharedMemory } from './gateway/src/orchestration/shared-memory';
import { InterAgentBus } from './gateway/src/orchestration/InterAgentBus';

async function testHiveMindSwarm() {
  console.log('\n--- H1. "The HiveMind Mesh" (IAMB & Swarm Coordination) ---');
  const memory = new SharedMemory('.', 'swarmtest');
  await memory.init();

  const bus = InterAgentBus.getInstance();
  let logCount = 0;
  bus.on('broadcast', (msg) => {
    if (msg.type === 'LOG') logCount++;
  });

  console.log('Registering Specialized Agents...');
  memory.registerSwarmAgent({
    id: 'retina-01',
    type: 'RETINA',
    status: 'idle',
    execute: async (task) => { console.log(`[Retina] Executing Visual analysis for: ${task}`); return 'vision-ok'; }
  });

  memory.registerSwarmAgent({
    id: 'dev-01',
    type: 'DEVELOPER',
    status: 'idle',
    execute: async (task) => { console.log(`[Dev] Executing Code implementation for: ${task}`); return 'code-ok'; }
  });

  console.log('Running Parallel Swarm Task...');
  await memory.runSwarmTask('Update Dashboard UI');

  if (logCount >= 2) {
    console.log(`SUCCESS: IAMB registered and logged ${logCount} agents.`);
  } else {
    console.error(`FAIL: Agent registration telemetry failed. Logs: ${logCount}`);
  }
}

async function testSenateConsensus() {
  console.log('\n--- H2. "The Senate Senate" (Multi-Agent Quorum) ---');
  const memory = new SharedMemory('.', 'senatetest');
  await memory.init();
  const bus = InterAgentBus.getInstance();

  const changeId = 'fix-collision-bug';
  
  // Simulate specialized agents voting in the senate
  console.log('Requesting Senate Approval for change: fix-collision-bug...');
  
  // Start the approval request in background
  const approvalPromise = memory.requestSenateApproval(changeId, 2);

  // Agent 1: Developer Votes YES
  setTimeout(() => {
    console.log('[Dev-Ajan] Voting: APPROVED');
    memory.submitSenateVote(changeId, {
      agentId: 'dev-01',
      approved: true,
      reason: 'Code logic is sound',
      timestamp: Date.now()
    });
  }, 1000);

  // Agent 2: Auditor Votes YES
  setTimeout(() => {
    console.log('[Auditor-Ajan] Voting: APPROVED');
    memory.submitSenateVote(changeId, {
      agentId: 'auditor-01',
      approved: true,
      reason: 'Security audit passed',
      timestamp: Date.now()
    });
  }, 2000);

  const approved = await approvalPromise;

  if (approved) {
    console.log('SUCCESS: Senate Quorum reached (2/2). Change authorized.');
  } else {
    console.error('FAIL: Senate failed to reach quorum.');
  }
}

async function main() {
  try {
    await testHiveMindSwarm();
    await testSenateConsensus();
  } catch (e) {
    console.error('HiveMind Verification Error:', e);
  }
}

main();
