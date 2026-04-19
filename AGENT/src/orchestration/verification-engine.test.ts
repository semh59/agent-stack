import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationEngine, type VerificationResult } from './verification-engine';
import type { AgentDefinition } from './agents';
import { AgentLayer, PreferredModel } from './agents';
import type { TerminalExecutor, CommandResult } from './terminal-executor';

// Mock TerminalExecutor
function createMockTerminal(results: Record<string, CommandResult>): TerminalExecutor {
  return {
    run: vi.fn(async (command: string) => {
      return results[command] ?? {
        success: false,
        stdout: '',
        stderr: 'Command not mocked',
        exitCode: 1,
        durationMs: 0,
        command,
      };
    }),
  } as unknown as TerminalExecutor;
}

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    order: 7,
    role: 'backend',
    name: 'Backend Developer',
    emoji: '⚙️',
    layer: AgentLayer.DEVELOPMENT,
    preferredModel: PreferredModel.SONNET,
    inputFiles: [],
    outputFiles: ['backend-report.md'],
    estimatedMinutes: 10,
    systemPrompt: 'Test prompt',
    ...overrides,
  };
}

describe('VerificationEngine', () => {
  describe('verify()', () => {
    it('should pass when no verification commands are defined', async () => {
      const terminal = createMockTerminal({});
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({ verificationCommands: undefined });

      const result = await engine.verify(agent, 'Some output');

      expect(result.passed).toBe(true);
      expect(result.commands).toHaveLength(0);
    });

    it('should pass when all verification commands succeed', async () => {
      const terminal = createMockTerminal({
        'npm run build': { success: true, stdout: 'OK', stderr: '', exitCode: 0, durationMs: 100, command: 'npm run build' },
        'npm run test': { success: true, stdout: 'Tests passed', stderr: '', exitCode: 0, durationMs: 200, command: 'npm run test' },
      });
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        verificationCommands: ['npm run build', 'npm run test'],
      });

      const result = await engine.verify(agent, 'Some output');

      expect(result.passed).toBe(true);
      expect(result.commands).toHaveLength(2);
      expect(result.commands[0]!.passed).toBe(true);
      expect(result.commands[1]!.passed).toBe(true);
    });

    it('should fail when any verification command fails', async () => {
      const terminal = createMockTerminal({
        'npm run build': { success: true, stdout: 'OK', stderr: '', exitCode: 0, durationMs: 100, command: 'npm run build' },
        'npm run test': { success: false, stdout: '', stderr: 'FAIL', exitCode: 1, durationMs: 200, command: 'npm run test' },
      });
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        verificationCommands: ['npm run build', 'npm run test'],
      });

      const result = await engine.verify(agent, 'Some output');

      expect(result.passed).toBe(false);
      expect(result.commands[1]!.passed).toBe(false);
    });
  });

  describe('output validation', () => {
    it('should validate output sections exist', async () => {
      const terminal = createMockTerminal({});
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        outputValidation: ['Files Created', 'Key Decisions', 'Known Issues'],
      });

      const output = `# Backend Report
## Files Created
- server.ts
- routes.ts

## Key Decisions
- Used Express

## Known Issues
- None
`;

      const result = await engine.verify(agent, output);

      expect(result.outputValidation).toHaveLength(3);
      expect(result.outputValidation.every(v => v.found)).toBe(true);
    });

    it('should detect missing output sections', async () => {
      const terminal = createMockTerminal({});
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        outputValidation: ['Files Created', 'Key Decisions', 'Missing Section'],
      });

      const output = `# Report
## Files Created
stuff
## Key Decisions
stuff`;

      const result = await engine.verify(agent, output);

      expect(result.outputValidation).toHaveLength(3);
      expect(result.outputValidation[2]!.found).toBe(false);
      expect(result.outputValidation[2]!.section).toBe('Missing Section');
    });
  });

  describe('halt conditions', () => {
    it('should trigger halt on critical vulnerability', async () => {
      const terminal = createMockTerminal({
        'npm audit --audit-level=moderate': {
          success: false,
          stdout: '5 critical vulnerabilities found',
          stderr: '',
          exitCode: 1,
          durationMs: 100,
          command: 'npm audit --audit-level=moderate',
        },
      });
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        role: 'security',
        verificationCommands: ['npm audit --audit-level=moderate'],
        haltConditions: ['Critical severity vulnerability found'],
      });

      const output = 'Security audit report: 5 critical vulnerabilities found';
      const result = await engine.verify(agent, output);

      expect(result.haltTriggered).toBe(true);
      expect(result.haltReason).toContain('Critical');
      expect(result.passed).toBe(false);
    });

    it('should trigger halt on secret leak', async () => {
      const terminal = createMockTerminal({});
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        role: 'security',
        haltConditions: ['Secret/API key leak detected in source code'],
      });

      const output = 'Scan results: API key leak detected in config.ts';
      const result = await engine.verify(agent, output);

      expect(result.haltTriggered).toBe(true);
      expect(result.passed).toBe(false);
    });

    it('should not trigger halt when no conditions match', async () => {
      const terminal = createMockTerminal({});
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        haltConditions: ['Critical severity vulnerability found'],
      });

      const output = 'All clear, no issues found';
      const result = await engine.verify(agent, output);

      expect(result.haltTriggered).toBe(false);
      expect(result.passed).toBe(true);
    });
  });

  describe('formatAsLog()', () => {
    it('should format verification result as readable log', async () => {
      const terminal = createMockTerminal({
        'npm run build': { success: true, stdout: 'OK', stderr: '', exitCode: 0, durationMs: 100, command: 'npm run build' },
      });
      const engine = new VerificationEngine(terminal);
      const agent = makeAgent({
        verificationCommands: ['npm run build'],
        outputValidation: ['Files Created'],
      });

      const result = await engine.verify(agent, '## Files Created\n- test.ts');
      const log = engine.formatAsLog(result);

      expect(log).toContain('VERIFICATION: backend');
      expect(log).toContain('✅ PASSED');
      expect(log).toContain('npm run build');
      expect(log).toContain('Files Created');
    });
  });
});
