import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalExecutor } from './terminal-executor';
import os from 'node:os';

describe('TerminalExecutor', () => {
  let executor: TerminalExecutor;

  beforeEach(() => {
    executor = new TerminalExecutor(process.cwd());
  });

  describe('allowlist enforcement', () => {
    it('should allow npm commands', async () => {
      const result = await executor.run('npm --version');
      expect(result.success).toBe(true);
      expect(result.stdout).toBeTruthy();
    });

    it('should allow node commands', async () => {
      const result = await executor.run('node --version');
      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/^v\d+/);
    });

    it('should allow git commands', async () => {
      const result = await executor.run('git --version');
      expect(result.success).toBe(true);
    });

    it('should allow echo commands', async () => {
      const result = await executor.run('echo hello');
      expect(result.stderr).not.toContain('BLOCKED');
      if (process.platform !== 'win32') {
        expect(result.success).toBe(true);
        expect(result.stdout).toContain('hello');
      }
    });
  });

  describe('denylist enforcement', () => {
    it('should block rm -rf', async () => {
      const result = await executor.run('rm -rf /');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('BLOCKED');
    });

    it('should block shutdown', async () => {
      const result = await executor.run('shutdown now');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('BLOCKED');
    });

    it('should block format commands', async () => {
      const result = await executor.run('format C:');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('BLOCKED');
    });

    it('should block shell metacharacter chaining with ampersand', async () => {
      const result = await executor.run('npm --version & whoami');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Shell metacharacters');
    });

    it('should block shell metacharacter piping', async () => {
      const result = await executor.run('npm --version | cat');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Shell metacharacters');
    });

    it('should block shell metacharacter chaining with double ampersand', async () => {
      const result = await executor.run('npm --version && whoami');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Shell metacharacters');
    });

    it('should block command substitution syntax', async () => {
      const result = await executor.run('echo $(whoami)');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Command substitution');
    });

    it('should block newline injection payload', async () => {
      const result = await executor.run('npm --version\nwhoami');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Shell metacharacters');
    });

    it('should block windows env expansion syntax', async () => {
      const result = await executor.run('echo %USERNAME%');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Windows command expansion');
    });

    it('should block execute_encoded helper invocations', async () => {
      const result = await executor.run('node -e "execute_encoded(\'Y29tbWFuZA==\')"');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Encoded execution helpers are blocked');
    });

    it('should block decode-and-execute payload patterns', async () => {
      const result = await executor.run(
        'node -e "eval(Buffer.from(\'Y29uc29sZS5sb2coMSk=\', \'base64\').toString())"',
      );
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Decode-and-execute payloads are blocked');
    });
  });

  describe('unknown command blocking', () => {
    it('should block commands not in allowlist', async () => {
      const result = await executor.run('powershell -c "Get-Process"');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not in allowlist');
    });

    it('should block empty commands', async () => {
      const result = await executor.run('');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('BLOCKED');
    });
  });

  describe('execution', () => {
    it('should capture stdout and stderr', async () => {
      const result = await executor.run('node -e "console.log(42)"');
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('42');
    });

    it('should report non-zero exit code as failure', async () => {
      const result = await executor.run('node -e "process.exit(1)"');
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    it('should track duration', async () => {
      const result = await executor.run('node --version');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('timeout', () => {
    it('should respect timeout option', async () => {
      // Use a very short timeout for a long-running command
      const result = await executor.run(
        'node -e "setTimeout(function(){},10000)"',
        { timeout: 500 }
      );
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('timed out');
    }, 5000);
  });

  describe('gate profile', () => {
    it('should block commands not present in immutable gate allowlist', async () => {
      const result = await executor.run('npm --version', {
        profile: 'gate',
        allowedCommands: ['npm run typecheck'],
      });
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not allowed in gate profile');
    });
  });

  describe('convenience methods', () => {
    // Note: We test command STRINGS only — not actual execution — because
    // calling `npm test` inside vitest causes recursive invocation.

    it('runBuild should produce a result with correct command', async () => {
      const result = await executor.runBuild();
      expect(result.command).toBe('npm run build');
      // durationMs is always tracked
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 30000);

    it('runTypecheck should produce a result with correct command', async () => {
      const result = await executor.runTypecheck();
      expect(result.command).toBe('npm run typecheck');
    }, 15000);

    it('runFullVerification should return build and test results', async () => {
      const buildResult = {
        success: true,
        stdout: 'build ok',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
        command: 'npm run build',
      };
      const testResult = {
        success: true,
        stdout: 'test ok',
        stderr: '',
        exitCode: 0,
        durationMs: 10,
        command: 'npm test',
      };
      vi.spyOn(executor, 'runBuild').mockResolvedValue(buildResult);
      vi.spyOn(executor, 'runTests').mockResolvedValue(testResult);

      const result = await executor.runFullVerification();
      expect(result.build).toBeDefined();
      expect(result.test).toBeDefined();
      expect(result.build.command).toBe('npm run build');
      expect(result.test.command).toBe('npm test');
      expect(result.allPassed).toBe(true);
    });
  });
});
