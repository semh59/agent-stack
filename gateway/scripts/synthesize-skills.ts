import * as fs from 'node:fs/promises';
import path from 'node:path';
import { SkillGenerator } from '../src/orchestration/skill-generator';
import { SharedMemory } from '../src/orchestration/shared-memory';

/**
 * synthesize-skills.ts
 * 
 * Uses the SkillGenerator to analyze the current project state (from shared memory)
 * and generate physical SKILL.md files for the project.
 */
async function main() {
  const projectRoot = process.cwd();
  const generator = new SkillGenerator(projectRoot);
  const memory = new SharedMemory(projectRoot);
  
  console.log('[Synthesizer] Analyzing project outputs for skill synthesis...');
  
  // In a real run, this would read from the last pipeline execution
  const proposals = await generator.generateProposals(memory);
  
  if (proposals.length === 0) {
    console.log('[Synthesizer] No new skill patterns detected in current memory.');
    return;
  }
  
  console.log(`[Synthesizer] Found ${proposals.length} skill proposals.`);
  
  for (const proposal of proposals) {
    const skillDir = path.join(projectRoot, '.agent', 'skills', proposal.name);
    await fs.mkdir(skillDir, { recursive: true });
    
    const skillPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(skillPath, proposal.content, 'utf-8');
    
    console.log(`[Synthesizer] COMMITTED SPECIALIST: ${proposal.name} -> ${skillPath}`);
  }
  
  console.log('[Synthesizer] Synthesis complete. Specialist agents are now evolved.');
}

main().catch(err => {
  console.error('[Synthesizer] Failed:', err);
  process.exit(1);
});
