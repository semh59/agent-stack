import { describe, it, expect, vi } from 'vitest';
import { GeminiProvider, AnthropicProvider, OpenAIProvider } from './LLMProviders';

describe('LLMProviders', () => {
  const mockAgent = { name: 'test-agent' } as any;
  const mockOptions = {
    temperature: 0.7,
    maxOutputTokens: 100,
    timeoutMs: 5000,
  };

  describe('GeminiProvider', () => {
    it('should generate correct request and parse usage', async () => {
      const provider = new GeminiProvider();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30
          }
        })
      });

      const result = await provider.execute(mockAgent, 'system', 'user', 'gemini-1.5-flash', {
        ...mockOptions,
        fetchFn: mockFetch as any
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-1.5-flash:generateContent'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"text":"system"')
        })
      );

      expect(result.output).toBe('Hello from Gemini');
      expect(result.tokenUsage.totalTokens).toBe(30);
      expect(result.tokenUsage.estimatedCostUsd).toBe(30 * 0.0000001);
    });

    it('should handle API errors', async () => {
      const provider = new GeminiProvider();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      });

      await expect(provider.execute(mockAgent, 's', 'u', 'm', { ...mockOptions, fetchFn: mockFetch as any }))
        .rejects.toThrow(/Gemini API Error 500/);
    });
  });

  describe('AnthropicProvider', () => {
    it('should generate correct request and parse usage', async () => {
      const provider = new AnthropicProvider();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Hello from Claude' }],
          usage: {
            input_tokens: 50,
            output_tokens: 150
          }
        })
      });

      const result = await provider.execute(mockAgent, 'system', 'user', 'claude-3-5-sonnet-20240620', {
        ...mockOptions,
        fetchFn: mockFetch as any
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'anthropic-version': '2023-06-01'
          })
        })
      );

      expect(result.output).toBe('Hello from Claude');
      expect(result.tokenUsage.promptTokens).toBe(50);
      expect(result.tokenUsage.completionTokens).toBe(150);
    });
  });

  describe('OpenAIProvider', () => {
    it('should generate correct request and parse usage', async () => {
      const provider = new OpenAIProvider();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Hello from GPT' } }],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 60,
            total_tokens: 100
          }
        })
      });

      const result = await provider.execute(mockAgent, 'system', 'user', 'gpt-4o', {
        ...mockOptions,
        fetchFn: mockFetch as any
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"model":"gpt-4o"')
        })
      );

      expect(result.output).toBe('Hello from GPT');
      expect(result.tokenUsage.totalTokens).toBe(100);
    });
  });
});
