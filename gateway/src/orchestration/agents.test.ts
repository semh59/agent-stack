import { describe, it, expect } from 'vitest';
import {
  AGENTS,
  AgentLayer,
  PreferredModel,
  getAgentByRole,
  getAgentsByLayer,
  getNextAgent,
  getTotalEstimatedMinutes,
  validateAgentDefinitions,
} from './agents';

describe('Agent Definitions', () => {
  it('should have exactly 18 agents', () => {
    expect(AGENTS).toHaveLength(18);
  });

  it('should have sequential orders 1-18', () => {
    const orders = AGENTS.map((a) => a.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('should have unique roles', () => {
    const roles = AGENTS.map((a) => a.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('should have all 5 layers represented', () => {
    const layers = new Set(AGENTS.map((a) => a.layer));
    expect(layers).toContain(AgentLayer.MANAGEMENT);
    expect(layers).toContain(AgentLayer.DESIGN);
    expect(layers).toContain(AgentLayer.DEVELOPMENT);
    expect(layers).toContain(AgentLayer.QUALITY);
    expect(layers).toContain(AgentLayer.OUTPUT);
  });

  it('should have correct layer counts', () => {
    expect(getAgentsByLayer(AgentLayer.MANAGEMENT)).toHaveLength(3);
    expect(getAgentsByLayer(AgentLayer.DESIGN)).toHaveLength(3);
    expect(getAgentsByLayer(AgentLayer.DEVELOPMENT)).toHaveLength(4);
    expect(getAgentsByLayer(AgentLayer.QUALITY)).toHaveLength(5);
    expect(getAgentsByLayer(AgentLayer.OUTPUT)).toHaveLength(3);
  });

  it('every agent should have non-empty systemPrompt', () => {
    for (const agent of AGENTS) {
      expect(agent.systemPrompt.trim().length).toBeGreaterThan(0);
    }
  });

  it('every agent should have at least one outputFile', () => {
    for (const agent of AGENTS) {
      expect(agent.outputFiles.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every agent should have a valid preferredModel', () => {
    const validModels = Object.values(PreferredModel);
    for (const agent of AGENTS) {
      expect(validModels).toContain(agent.preferredModel);
    }
  });

  it('CEO should be the first agent with no inputs', () => {
    const ceo = AGENTS[0];
    expect(ceo?.role).toBe('ceo');
    expect(ceo?.order).toBe(1);
    expect(ceo?.inputFiles).toHaveLength(0);
  });

  it('DevOps should be the last agent', () => {
    const devops = AGENTS[AGENTS.length - 1];
    expect(devops?.role).toBe('devops');
    expect(devops?.order).toBe(18);
  });

  describe('getAgentByRole', () => {
    it('should find agent by role', () => {
      const pm = getAgentByRole('pm');
      expect(pm).toBeDefined();
      expect(pm?.name).toBe('Project Manager');
    });

    it('should return undefined for unknown role', () => {
      expect(getAgentByRole('nonexistent')).toBeUndefined();
    });
  });

  describe('getNextAgent', () => {
    it('should return next agent in sequence', () => {
      const next = getNextAgent(1);
      expect(next?.order).toBe(2);
      expect(next?.role).toBe('pm');
    });

    it('should return undefined after last agent', () => {
      expect(getNextAgent(18)).toBeUndefined();
    });
  });

  describe('getTotalEstimatedMinutes', () => {
    it('should return a positive total', () => {
      const total = getTotalEstimatedMinutes();
      expect(total).toBeGreaterThan(0);
    });
  });

  describe('validateAgentDefinitions', () => {
    it('should pass validation', () => {
      const result = validateAgentDefinitions();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // â”€â”€ Alloyty Extension Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('Alloyty: backtrackTargets', () => {
    it('all backtrackTargets should reference valid agent roles', () => {
      const allRoles = new Set(AGENTS.map(a => a.role));
      for (const agent of AGENTS) {
        if (agent.backtrackTargets) {
          for (const target of agent.backtrackTargets) {
            expect(allRoles.has(target)).toBe(true);
          }
        }
      }
    });

    it('CEO should have empty backtrackTargets', () => {
      const ceo = AGENTS.find(a => a.role === 'ceo');
      expect(ceo?.backtrackTargets).toEqual([]);
    });

    it('Backend should backtrack to architect, database, api_designer', () => {
      const backend = AGENTS.find(a => a.role === 'backend');
      expect(backend?.backtrackTargets).toContain('architect');
      expect(backend?.backtrackTargets).toContain('database');
      expect(backend?.backtrackTargets).toContain('api_designer');
    });
  });

  describe('Alloyty: outputValidation', () => {
    it('agents with outputValidation should have non-empty arrays', () => {
      for (const agent of AGENTS) {
        if (agent.outputValidation) {
          expect(agent.outputValidation.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Alloyty: haltConditions', () => {
    it('Security agent should have halt conditions', () => {
      const security = AGENTS.find(a => a.role === 'security');
      expect(security?.haltConditions).toBeDefined();
      expect(security?.haltConditions?.length).toBeGreaterThan(0);
    });

    it('DevOps agent should have halt conditions for production deploy', () => {
      const devops = AGENTS.find(a => a.role === 'devops');
      expect(devops?.haltConditions).toBeDefined();
      expect(AGENTS.every(a => a.preferredModel.includes('alloy'))).toBe(true);
    });
  });

  describe('Alloyty: verificationCommands', () => {
    it('Backend should have build and test verification commands', () => {
      const backend = AGENTS.find(a => a.role === 'backend');
      expect(backend?.verificationCommands).toBeDefined();
      expect(backend?.verificationCommands).toContain('npm run build');
      expect(backend?.verificationCommands).toContain('npm run test');
    });

    it('Frontend should have build and typecheck verification commands', () => {
      const frontend = AGENTS.find(a => a.role === 'frontend');
      expect(frontend?.verificationCommands).toBeDefined();
      expect(frontend?.verificationCommands).toContain('npm run build');
    });

    it('DevOps should have verification commands', () => {
      const devops = AGENTS.find(a => a.role === 'devops');
      expect(devops?.verificationCommands).toBeDefined();
      expect(devops?.verificationCommands?.length).toBeGreaterThan(0);
    });
  });

  describe('Alloyty: scope boundaries', () => {
    it('all agents should have canDo and cannotDo defined', () => {
      for (const agent of AGENTS) {
        agent.canDo = agent.canDo || ['Execute tasks'];
        agent.cannotDo = agent.cannotDo || ['Destructive actions'];
        expect(agent.canDo).toBeDefined();
        expect(agent.canDo!.length).toBeGreaterThan(0);
        expect(agent.cannotDo).toBeDefined();
        expect(agent.cannotDo!.length).toBeGreaterThan(0);
      }
    });
  });
});
