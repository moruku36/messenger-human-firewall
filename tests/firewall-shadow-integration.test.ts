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

  it('runs Gemini as Production Decision immediately without waiting for Jev', async () => {
    let jevResolved = false;
    const mockJevClient = {
      systemOne: vi.fn().mockImplementation(async () => {
        // Simulate Jev taking 500ms
        await new Promise((resolve) => setTimeout(resolve, 500));
        jevResolved = true;
        return {
          answers: {
            category: { choice: 'SCAM', confidence: 0.94 },
            credentialRequest: { noul: 0.1 },
            moneyRequest: { noul: 0.8 },
            threatOrUrgency: { noul: 0.05 },
            promptInjection: { noul: 0.0 },
            suspiciousExternalLink: { noul: 0.2 },
            overallRisk: { score: 3 },
          },
        };
      }),
    } as unknown as TypeSafeClient;

    const jevClassifier = new JevClassifier({ client: mockJevClient });
    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      jevClassifier,
    );

    const startTime = Date.now();
    const result = await firewall.processMessage(
      '月利30%の暗号資産ファンドです。',
      'thread-hash-scam-123',
    );
    const duration = Date.now() - startTime;

    // Production Decision is strictly dictated by Gemini and returned immediately
    expect(duration).toBeLessThan(100);
    expect(result.classification.category).toBe('SCAM');
    expect(result.classification.action).toBe('TIME_WASTER');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
    expect(result.candidateReply).toBe('詳しく教えていただけますか？');
    expect(result.jevDecision).toBeUndefined();
    expect(jevResolved).toBe(false);

    // Background shadow evaluation finishes cleanly
    await firewall.waitForPendingShadowTasks();
    expect(jevResolved).toBe(true);
  });

  it('guarantees production path is not blocked even if Jev has severe delay (>= 5s)', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 6000);
          }),
      ),
    } as unknown as TypeSafeClient;

    const jevClassifier = new JevClassifier({ client: mockJevClient });
    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      jevClassifier,
    );

    const startTime = Date.now();
    const result = await firewall.processMessage(
      'テストメッセージ遅延検証',
      'thread-hash-delay-test',
    );
    const duration = Date.now() - startTime;

    // Production completes under 100ms despite Jev pending for 6 seconds
    expect(duration).toBeLessThan(100);
    expect(result.finalDecision).toBe('SEND_ALLOWED');
  });

  it('preserves Gemini production decision and logs telemetry even when Jev fails with API error without blocking', async () => {
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

    // Gemini production pipeline continues immediately unhindered
    expect(result.classification.category).toBe('SCAM');
    expect(result.classification.action).toBe('TIME_WASTER');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
    expect(result.candidateReply).toBe('詳しく教えていただけますか？');

    // Wait for background error handling to complete
    await firewall.waitForPendingShadowTasks();
  });

  it('never emits unhandled promise rejections on unexpected Jev synchronous/asynchronous crashes', async () => {
    let unhandledRejectionDetected = false;
    const rejectionHandler = () => {
      unhandledRejectionDetected = true;
    };
    process.on('unhandledRejection', rejectionHandler);

    try {
      const mockJevClient = {
        systemOne: vi.fn().mockImplementation(() => {
          throw new Error('Fatal unhandled runtime exception in client');
        }),
      } as unknown as TypeSafeClient;

      const jevClassifier = new JevClassifier({ client: mockJevClient });
      const firewall = new HumanFirewallCore(
        mockGeminiClassifier,
        mockGeminiGenerator,
        jevClassifier,
      );

      const result = await firewall.processMessage(
        'テストクラッシュ検証',
        'thread-hash-crash-test',
      );

      expect(result.finalDecision).toBe('SEND_ALLOWED');
      await firewall.waitForPendingShadowTasks();
      expect(unhandledRejectionDetected).toBe(false);
    } finally {
      process.removeListener('unhandledRejection', rejectionHandler);
    }
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
  });

  it('rejects JEV_SHADOW_MODE=false explicitly as unsupported when JEV_ENABLED=true', async () => {
    process.env.JEV_ENABLED = 'true';
    process.env.JEV_SHADOW_MODE = 'false';
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

    await expect(
      firewall.processMessage('テストメッセージ', 'thread-hash-unsupported'),
    ).rejects.toThrowError(
      'JEV_SHADOW_MODE=false is not supported yet. Jev production routing is not implemented.',
    );
    expect(mockJevClient.systemOne).not.toHaveBeenCalled();
  });
});
