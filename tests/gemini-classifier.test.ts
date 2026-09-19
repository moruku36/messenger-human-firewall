import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/llm/gemini.js';

describe('GeminiProvider Instrumentation & Diagnostics Suite', () => {
  const dummyKey = 'test-gemini-dummy-key';

  it('handles valid Gemini response: success=true, category/action preserved', async () => {
    const provider = new GeminiProvider(dummyKey);

    const validJson = JSON.stringify({
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 10,
      reason: 'Standard polite greeting',
      reply: 'こんにちは。どのようなご用件でしょうか？',
    });

    vi.spyOn(provider as any, 'callApi').mockResolvedValue(validJson);

    const diag = await provider.classifyWithDiagnostics('こんにちは！');

    expect(diag.success).toBe(true);
    expect(diag.failureType).toBeUndefined();
    expect(diag.result.category).toBe('NORMAL');
    expect(diag.result.action).toBe('POLITE_REPLY');
    expect(diag.result.risk).toBe(10);
    expect(diag.rawCategory).toBe('NORMAL');
    expect(diag.rawAction).toBe('POLITE_REPLY');

    // Production classify() returns the exact same result
    const prodResult = await provider.classify('こんにちは！');
    expect(prodResult.category).toBe('NORMAL');
    expect(prodResult.action).toBe('POLITE_REPLY');
  });

  it('handles invalid JSON: success=false, failureType=JSON_PARSE_ERROR, production fails closed', async () => {
    const provider = new GeminiProvider(dummyKey);

    vi.spyOn(provider as any, 'callApi').mockResolvedValue('This is not valid json');

    const diag = await provider.classifyWithDiagnostics('こんにちは！');

    expect(diag.success).toBe(false);
    expect(diag.failureType).toBe('JSON_PARSE_ERROR');
    expect(diag.result.category).toBe('UNKNOWN');
    expect(diag.result.action).toBe('HUMAN_REQUIRED');
    expect(diag.result.risk).toBe(80);

    // Production classify() still returns fail-closed UNKNOWN / HUMAN_REQUIRED
    const prodResult = await provider.classify('こんにちは！');
    expect(prodResult.category).toBe('UNKNOWN');
    expect(prodResult.action).toBe('HUMAN_REQUIRED');
    expect(prodResult.risk).toBe(80);
    expect(prodResult.reason).toContain('LLM Classification failure');
  });

  it('handles invalid schema: success=false, failureType=SCHEMA_ERROR, production fails closed', async () => {
    const provider = new GeminiProvider(dummyKey);

    const invalidSchemaJson = JSON.stringify({
      category: 'INVALID_CATEGORY_NAME',
      action: 'INVALID_ACTION',
      risk: 999, // out of range
      reason: 'malformed schema test',
    });

    vi.spyOn(provider as any, 'callApi').mockResolvedValue(invalidSchemaJson);

    const diag = await provider.classifyWithDiagnostics('テスト');

    expect(diag.success).toBe(false);
    expect(diag.failureType).toBe('SCHEMA_ERROR');
    expect(diag.rawCategory).toBe('INVALID_CATEGORY_NAME');
    expect(diag.rawAction).toBe('INVALID_ACTION');
    expect(diag.result.category).toBe('UNKNOWN');
    expect(diag.result.action).toBe('HUMAN_REQUIRED');
    expect(diag.result.risk).toBe(70);

    // Production classify() fails closed
    const prodResult = await provider.classify('テスト');
    expect(prodResult.category).toBe('UNKNOWN');
    expect(prodResult.action).toBe('HUMAN_REQUIRED');
    expect(prodResult.risk).toBe(70);
  });

  it('handles API failure: success=false, failureType=API_ERROR, production fails closed', async () => {
    const provider = new GeminiProvider(dummyKey);

    vi.spyOn(provider as any, 'callApi').mockRejectedValue(
      new Error('Gemini API error (status 429): Rate limit exceeded / Quota reached'),
    );

    const diag = await provider.classifyWithDiagnostics('テスト');

    expect(diag.success).toBe(false);
    expect(diag.failureType).toBe('API_ERROR');
    expect(diag.errorMessage).toContain('429');
    expect(diag.result.category).toBe('UNKNOWN');
    expect(diag.result.action).toBe('HUMAN_REQUIRED');
    expect(diag.result.risk).toBe(80);

    // Production classify() fails closed
    const prodResult = await provider.classify('テスト');
    expect(prodResult.category).toBe('UNKNOWN');
    expect(prodResult.action).toBe('HUMAN_REQUIRED');
    expect(prodResult.risk).toBe(80);
  });

  it('handles genuine model UNKNOWN: success=true, category=UNKNOWN', async () => {
    const provider = new GeminiProvider(dummyKey);

    const genuineUnknownJson = JSON.stringify({
      category: 'UNKNOWN',
      action: 'HUMAN_REQUIRED',
      risk: 60,
      reason: 'insufficient context to determine intent',
    });

    vi.spyOn(provider as any, 'callApi').mockResolvedValue(genuineUnknownJson);

    const diag = await provider.classifyWithDiagnostics('あ');

    // Key distinction: Success must be TRUE because the model successfully returned valid UNKNOWN inference
    expect(diag.success).toBe(true);
    expect(diag.failureType).toBeUndefined();
    expect(diag.result.category).toBe('UNKNOWN');
    expect(diag.result.action).toBe('HUMAN_REQUIRED');
    expect(diag.result.risk).toBe(60);
    expect(diag.rawCategory).toBe('UNKNOWN');
    expect(diag.rawAction).toBe('HUMAN_REQUIRED');
  });
});
