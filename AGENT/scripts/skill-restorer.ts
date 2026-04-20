import * as fs from 'node:fs';
import * as path from 'node:path';

const SKILLS_DIR = path.resolve('.agent/skills');

const MISSING_SKILLS = [
  // Management
  'architecture', 'concise-planning', 'brainstorming', 'plan-writing', 
  'product-manager-toolkit', 'architect-review', 'architecture-decision-records',
  // Design
  'frontend-design', 'ui-ux-pro-max', 'tailwind-design-system', 'database-design',
  'sql-optimization-patterns', 'api-patterns', 'api-documenter',
  // Development
  'nodejs-backend-patterns', 'fastapi-pro', 'react-patterns', 'nextjs-best-practices',
  'auth-implementation-patterns', 'api-security-best-practices', 
  'api-testing-observability-api-mock', 'e2e-testing-patterns', 'error-handling-patterns',
  // Quality
  'testing-patterns', 'tdd-workflow', 'javascript-testing-patterns', 
  'playwright-skill', 'python-testing-patterns', 'vulnerability-scanner',
  'application-performance-performance-optimization', 'web-performance-optimization',
  'performance-profiling', 'code-review-checklist',
  // Output
  'documentation-templates', 'readme', 'changelog-automation', 
  'code-documentation-doc-generate', 'deployment-procedures', 
  'docker-expert', 'github-actions-templates'
];

async function restore() {
  console.log(`[SkillRestorer] Starting restoration of ${MISSING_SKILLS.length} skills...`);

  for (const skill of MISSING_SKILLS) {
    const dir = path.join(SKILLS_DIR, skill);
    const file = path.join(dir, 'SKILL.md');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Individual files will be populated via specialist injection.
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf-8').includes('[Sovereign Restoration in Progress]')) {
      console.log(`[SkillRestorer] Generating content for: ${skill}...`);
      
      const systemPrompt = `You are a Senior Expert in ${skill}. 
Your task is to write a comprehensive SKILL.md for the Sovereign AI v4 project.
The document must include:
1. Core Principles
2. Best Practices
3. Code Patterns
4. Tool Integration instructions.
Keep it concise but highly technical.`;

      // Simulating the LLM call for now to avoid rapid rate limits, 
      // but in a real sovereign run we would use fetch here.
      const content = `---\nname: ${skill}\ndescription: Expert level knowledge for ${skill}\n---\n\n# ${skill}\n\n## Principles\n- Precision over complexity.\n- Modular design.\n\n## Best Practices\n- Continuous validation.\n- Automated documentation.\n\n## Patterns\n- Use Factory and Strategy patterns for flexibility.`;
      
      fs.writeFileSync(file, content);
      console.log(`[SkillRestorer] Populated: ${skill}`);
    }
  }

  console.log('[SkillRestorer] Hierarchy restored. Ready for content generation.');
}

restore().catch(console.error);
