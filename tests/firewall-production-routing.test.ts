import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { HumanFirewallCore } from '../src/core/firewall.js';
import type { LLMClassifier, LLMReplyGenerator } from '../src/core/llm.js';
import { resetConfigForTest } from '../src/core/config.js';
import { JevClassifier } from '../src/llm/jev.js';

describe('Phase 3: Production Routing Integration with Jev as Primary Triage', () => {
  let mockGeminiClassifier: LLMClassifier;
  let mockGeminiGenerator: LLMReplyGenerator;

  beforeEach(() => {
    resetConfigForTest();
    process.env.DRY_RUN = 'true';
    process.env.PAUSE_ALL = 'false';
    process.env.JEV_ENABLED = 'true';
    process.env.JEV_SHADOW_MODE = 'false'; // Active Mode

    mockGeminiClassifier = {
      name: 'gemini',
      classify: vi.fn(),
    };

    mockGeminiGenerator = {
      name: 'gemini',
      generateReply: vi.fn().mockResolvedValue('こんにちは！ご連絡ありがとうございます。'),
    };
  });

  it('routes NORMAL message: Jev evaluates, Gemini classify NOT called, Gemini reply generator called -> SEND_ALLOWED', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'NORMAL', confidence: 0.95 },
          credentialRequest: { noul: 0.01 },
          moneyRequest: { noul: 0.02 },
          threatOrUrgency: { noul: 0.0 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.01 },
          overallRisk: { score: 0.1 },
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
      '初めまして、昨日の勉強会でご一緒した山田です。',
      'thread-hash-normal-1',
    );

    // Jev was used
    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
    // Gemini classify was NEVER called
    expect(mockGeminiClassifier.classify).not.toHaveBeenCalled();
    // Gemini reply generator was called
    expect(mockGeminiGenerator.generateReply).toHaveBeenCalledTimes(1);
    // Result
    expect(result.classification.category).toBe('NORMAL');
    expect(result.classification.action).toBe('POLITE_REPLY');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
    expect(result.candidateReply).toBe('こんにちは！ご連絡ありがとうございます。');
  });

  it('routes SALES message: Jev evaluates, Gemini classify NOT called, Gemini reply generator called -> SEND_ALLOWED', async () => {
    mockGeminiGenerator.generateReply = vi.fn().mockResolvedValue('あいにくですが、現在は営業のご提案を受け付けておりません。');

    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'SALES', confidence: 0.9 },
          credentialRequest: { noul: 0.05 },
          moneyRequest: { noul: 0.3 },
          threatOrUrgency: { noul: 0.0 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.05 },
          overallRisk: { score: 0.8 },
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
      '弊社AIツールの導入説明会のご案内です。15分ほどお時間をいただけないでしょうか。',
      'thread-hash-sales-1',
    );

    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
    expect(mockGeminiClassifier.classify).not.toHaveBeenCalled();
    expect(mockGeminiGenerator.generateReply).toHaveBeenCalledTimes(1);
    expect(result.classification.category).toBe('SALES');
    expect(result.classification.action).toBe('TIME_WASTER');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
  });

  it('routes SPAM message: Jev evaluates, Gemini classify NOT called, Gemini generator NOT called (Gemini calls = 0) -> IGNORE', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'SPAM', confidence: 0.98 },
          credentialRequest: { noul: 0.0 },
          moneyRequest: { noul: 0.2 },
          threatOrUrgency: { noul: 0.0 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.4 },
          overallRisk: { score: 1.2 },
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
      '【超お得】今なら登録するだけで全員に5000円分ポイント進呈中！詳細はこちら',
      'thread-hash-spam-1',
    );

    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
    expect(mockGeminiClassifier.classify).not.toHaveBeenCalled();
    expect(mockGeminiGenerator.generateReply).not.toHaveBeenCalled();
    expect(result.classification.category).toBe('SPAM');
    expect(result.classification.action).toBe('IGNORE');
    expect(result.finalDecision).toBe('IGNORED');
    expect(result.candidateReply).toBeUndefined();
  });

  it('routes CREDENTIAL SCAM: Jev evaluates, Gemini classify NOT called, Gemini generator NOT called (Gemini calls = 0) -> BLOCK_RECOMMENDED', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'SCAM', confidence: 0.99 },
          credentialRequest: { noul: 0.95 },
          moneyRequest: { noul: 0.1 },
          threatOrUrgency: { noul: 0.8 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.9 },
          overallRisk: { score: 3.8 },
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
      'アカウントが24時間以内にロックされます。解除するにはパスワードと二段階認証コードを今すぐ入力してください。',
      'thread-hash-scam-cred-1',
    );

    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
    expect(mockGeminiClassifier.classify).not.toHaveBeenCalled();
    expect(mockGeminiGenerator.generateReply).not.toHaveBeenCalled();
    expect(result.classification.category).toBe('SCAM');
    expect(result.classification.action).toBe('BLOCK_RECOMMENDED');
    expect(result.finalDecision).toBe('BLOCK_RECOMMENDED');
    expect(result.candidateReply).toBeUndefined();
  });

  it('routes THREAT / HIGH RISK: Jev evaluates, Gemini classify NOT called, Gemini generator NOT called (Gemini calls = 0) -> HUMAN_REQUIRED', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'HARASSMENT', confidence: 0.92 },
          credentialRequest: { noul: 0.0 },
          moneyRequest: { noul: 0.1 },
          threatOrUrgency: { noul: 0.95 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.0 },
          overallRisk: { score: 3.2 },
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
      '今すぐ金を振り込まないと家族の職場に危害を加えるぞ。警察に言ったら終わりだ。',
      'thread-hash-threat-1',
    );

    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
    expect(mockGeminiClassifier.classify).not.toHaveBeenCalled();
    expect(mockGeminiGenerator.generateReply).not.toHaveBeenCalled();
    expect(result.classification.category).toBe('HARASSMENT');
    expect(result.classification.action).toBe('HUMAN_REQUIRED');
    expect(result.finalDecision).toBe('HUMAN_REQUIRED');
    expect(result.candidateReply).toBeUndefined();
  });

  it('fails closed when Jev API returns an error: never calls Gemini classification as fallback, Gemini calls = 0 -> HUMAN_REQUIRED', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockRejectedValue(new Error('Jev API 500 Internal Server Error')),
    } as unknown as TypeSafeClient;

    const jevClassifier = new JevClassifier({ client: mockJevClient });
    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      jevClassifier,
    );

    const result = await firewall.processMessage(
      'ご無沙汰しております。お元気ですか？',
      'thread-hash-jev-fail-1',
    );

    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
    // Strict requirement: Gemini classification MUST NOT be called as fallback
    expect(mockGeminiClassifier.classify).not.toHaveBeenCalled();
    expect(mockGeminiGenerator.generateReply).not.toHaveBeenCalled();
    expect(result.classification.category).toBe('UNKNOWN');
    expect(result.classification.action).toBe('HUMAN_REQUIRED');
    expect(result.finalDecision).toBe('HUMAN_REQUIRED');
    expect(result.candidateReply).toBeUndefined();
  });

  it('fails closed when Gemini reply generation fails (e.g. 429 quota exhaustion): no message sent -> HUMAN_REQUIRED', async () => {
    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'NORMAL', confidence: 0.95 },
          credentialRequest: { noul: 0.01 },
          moneyRequest: { noul: 0.02 },
          threatOrUrgency: { noul: 0.0 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.01 },
          overallRisk: { score: 0.1 },
        },
      }),
    } as unknown as TypeSafeClient;

    // Simulate 429 quota exhausted on reply generation
    mockGeminiGenerator.generateReply = vi.fn().mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: Quota exceeded'));

    const jevClassifier = new JevClassifier({ client: mockJevClient });
    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      jevClassifier,
    );

    const result = await firewall.processMessage(
      '初めまして、昨日の勉強会でご一緒した山田です。',
      'thread-hash-gemini-429-1',
    );

    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
    expect(mockGeminiClassifier.classify).not.toHaveBeenCalled();
    expect(mockGeminiGenerator.generateReply).toHaveBeenCalledTimes(1);
    // In reply generation failure, must fail closed
    expect(result.finalDecision).toBe('HUMAN_REQUIRED');
    expect(result.candidateReply).toBeUndefined();
    expect(result.classification.action).toBe('POLITE_REPLY');
  });

  it('preserves Shadow Mode when JEV_SHADOW_MODE=true: Gemini classifies, Jev runs in background', async () => {
    process.env.JEV_SHADOW_MODE = 'true';

    mockGeminiClassifier.classify = vi.fn().mockResolvedValue({
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 10,
      reason: 'Gemini detected regular contact',
    });

    const mockJevClient = {
      systemOne: vi.fn().mockResolvedValue({
        answers: {
          category: { choice: 'NORMAL', confidence: 0.95 },
          credentialRequest: { noul: 0.01 },
          moneyRequest: { noul: 0.02 },
          threatOrUrgency: { noul: 0.0 },
          promptInjection: { noul: 0.0 },
          suspiciousExternalLink: { noul: 0.01 },
          overallRisk: { score: 0.1 },
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
      '昨日はありがとうございました！',
      'thread-hash-shadow-1',
    );

    // Gemini classified
    expect(mockGeminiClassifier.classify).toHaveBeenCalledTimes(1);
    expect(result.classification.category).toBe('NORMAL');

    // Wait for background shadow task
    await firewall.waitForPendingShadowTasks();
    expect(mockJevClient.systemOne).toHaveBeenCalledTimes(1);
  });

  it('preserves Legacy Mode when JEV_ENABLED=false: Gemini classifies, Jev is not called', async () => {
    process.env.JEV_ENABLED = 'false';

    mockGeminiClassifier.classify = vi.fn().mockResolvedValue({
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 10,
      reason: 'Gemini classified',
    });

    const firewall = new HumanFirewallCore(
      mockGeminiClassifier,
      mockGeminiGenerator,
      undefined,
    );

    const result = await firewall.processMessage(
      '昨日はありがとうございました！',
      'thread-hash-legacy-1',
    );

    expect(mockGeminiClassifier.classify).toHaveBeenCalledTimes(1);
    expect(result.classification.category).toBe('NORMAL');
  });
});
