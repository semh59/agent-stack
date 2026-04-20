import { describe, it, expect } from 'vitest';
import { TerminalExecutor } from './terminal-executor';
import { VerificationEngine } from './verification-engine';
import { extractRetryInfoFromBody } from './gateway-utils';

describe('Critical Fixes Deep Verification', () => {

  describe('Fix 2: Rate Limit Body Parser', () => {
    // We access the private-ish function via casting or just test its behavior if exposed
    // In our case it's a module-level function used by the client.
    it('should parse Google delay format (30s)', async () => {
      const result = await extractRetryInfoFromBody({
        clone: () => ({ json: async () => ({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }] } }) })
      } as unknown as Response);
      expect(result.retryDelayMs).toBe(30000);
    });

    it('should parse Anthropic retry_after', async () => {
      const result = await extractRetryInfoFromBody({
        clone: () => ({ json: async () => ({ retry_after: 5 }) })
      } as unknown as Response);
      expect(result.retryDelayMs).toBe(5000);
    });

    it('should parse OpenAI string format', async () => {
      const result = await extractRetryInfoFromBody({
        clone: () => ({ json: async () => ({ error: { message: "Please retry after 1.5s" } }) })
      } as unknown as Response);
      expect(result.retryDelayMs).toBe(1500);
    });
  });

  describe('Fix 5: Terminal Shell Tokenizer', () => {
    it('should handle complex quoting', () => {
      const args = TerminalExecutor.parseCommandArgs('echo "hello world" \'single quoted\' escaped\\ space');
      expect(args).toEqual(['echo', 'hello world', 'single quoted', 'escaped space']);
    });

    it('should handle nested quotes (as per standard non-shell behavior)', () => {
      const args = TerminalExecutor.parseCommandArgs('grep "O\'Reilly"');
      expect(args).toEqual(['grep', "O'Reilly"]);
    });
  });

  describe('Fix 6: Verification Halt False Positives', () => {
    it('should NOT halt on "0 critical vulnerabilities found"', () => {
      const result = VerificationEngine.checkHaltConditions(
        'Scan report: 0 critical vulnerabilities found',
        [],
        ['Critical severity vulnerability found']
      );
      expect(result.halt).toBe(false);
    });

    it('should NOT halt on "No secret found"', () => {
      const result = VerificationEngine.checkHaltConditions(
        'Search results: No secret found in codebase',
        [],
        ['Secret/API key leak detected']
      );
      expect(result.halt).toBe(false);
    });

    it('should STILL halt on real issues', () => {
      const result = VerificationEngine.checkHaltConditions(
        'ALERT: 5 Critical severity vulnerability found',
        [],
        ['Critical severity vulnerability found']
      );
      expect(result.halt).toBe(true);
    });
  });
});
