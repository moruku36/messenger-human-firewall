import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { HumanFirewallCore } from '../src/core/firewall.js';
import type { LLMClassifier, LLMReplyGenerator } from '../src/core/llm.js';
import { resetConfigForTest } from '../src/core/config.js';
import { JevClassifier } from '../src/llm/jev.js';

describe('Phase 4 & 6: HumanFirewallCore with Jev Shadow Mode Integration', () => {
  let mockGeminiClassifier: LLMClassifier;
  let mockGeminiGenerator: LLMReplyGenerator;

  beforeEach(() => {
    resetConfigForTest();
    process.env.DRY_RUN = 'true';
    process.env.PAUSE_ALL = 'false';
    process.env.JEV_ENABLED = 'true';
    process.env.JEV_SHADOW_MODE = 'true';

    mockGeminiClassifier = {
      name: 'gemini',
      classify: vi.fn().mockResolvedValue({
        category: 'SCAM',
        action: 'TIME_WASTER',
        risk: 85,
        reason: 'Gemini detected crypto investment scam',
        reply: '詳しく教えていただけますか？',
      }),
    };

    mockGeminiGenerator = {
      name: 'gemini',
      generateReply: vi.fn().mockResolvedValue('詳しく教えていただけますか？'),
    };
  });

  it('runs Gemini as Production Decision and Jev as Shadow Decision in parallel', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'SCAM', confidence: 0.94 },
          credentialRequest: { noul: 0.1 },
          moneyRequest: { noul: 0.8 },
          threatOrUrgency: { noul: 0.05 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.2 },
          overallRisk: { score: 3 },
        },
      }),
    } as unknown as TypeSafeClient;

    const jevClassifier = new JevClassifier({ client: mockJevClient });
    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      jevClassifier,
    );

    const result = await firewall.processMessage(
      '月利30%の暗号資産ファンドです。',
      'thread-hash-scam-123',
    );

    // Production Decision is strictly dictated by Gemini
    expect(result.classification.category).toBe('SCAM');
    expect(result.classification.action).toBe('TIME_WASTER');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
    expect(result.candidateReply).toBe('詳しく教えていただけますか？');

    // Shadow Mode comparison is recorded
    expect(result.jevDecision).toBeDefined();
    expect(result.jevDecision?.category).toBe('SCAM');
    expect(result.jevDecision?.action).toBe('TIME_WASTER');
    expect(result.comparison).toBeDefined();
    expect(result.comparison?.actionAgreement).toBe(true);
    expect(result.comparison?.categoryAgreement).toBe(true);
  });

  it('preserves Gemini production decision even when Jev fails with API error (Non-invasive Shadow Mode)', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockRejectedValue(new Error('TypeSafe API rate limit exceeded')),
    } as unknown as TypeSafeClient;

    const jevClassifier = new JevClassifier({ client: mockJevClient });
    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      jevClassifier,
    );

    const result = await firewall.processMessage(
      'テストメッセージ',
      'thread-hash-error-test',
    );

    // Gemini production pipeline continues unhindered
    expect(result.classification.category).toBe('SCAM');
    expect(result.classification.action).toBe('TIME_WASTER');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
    expect(result.candidateReply).toBe('詳しく教えていただけますか？');

    // Jev decision fails closed to HUMAN_REQUIRED without blocking production
    expect(result.jevDecision?.action).toBe('HUMAN_REQUIRED');
    expect(result.jevDecision?.reasonCode).toBe('JEV_API_ERROR');
    expect(result.jevDecision?.success).toBe(false);
  });

  it('completely bypasses Jev evaluation when JEV_ENABLED=false (Safe Default)', async () => {
    process.env.JEV_ENABLED = 'false';
    resetConfigForTest();

    const mockJevClient = {
      systemOne: vi.fn(),
    } as unknown as TypeSafeClient;

    const jevClassifier = new JevClassifier({ client: mockJevClient });
    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      jevClassifier,
    );

    const result = await firewall.processMessage(
      '通常の挨拶です。',
      'thread-hash-default',
    );

    expect(result.classification.category).toBe('SCAM');
    expect(mockJevClient.systemOne).not.toHaveBeenCalled();
    expect(result.jevDecision).toBeUndefined();
    expect(result.comparison).toBeUndefined();
  });
});
