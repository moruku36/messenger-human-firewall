import { describe, expect, it } from 'vitest';
import {
  type ClassificationResult,
  HumanFirewallCore,
  type LLMClassifier,
  type LLMReplyGenerator,
} from '../src/core/index.js';
import { GeminiProvider } from '../src/llm/gemini.js';

// Mock Provider for deterministic and offline testing
class MockLLM implements LLMClassifier, LLMReplyGenerator {
  public name = 'mock';

  constructor(
    private mockClassification: ClassificationResult,
    private mockReply: string = 'どのようなご用件でしょうか？',
  ) {}

  public async classify(): Promise<ClassificationResult> {
    return this.mockClassification;
  }

  public async generateReply(): Promise<string> {
    return this.mockReply;
  }
}

describe('Human Firewall AI Core (Classification, Generation & Guard)', () => {
  it('processes normal greetings into POLITE_REPLY with safe inspection', async () => {
    const mock = new MockLLM(
      {
        category: 'NORMAL',
        action: 'POLITE_REPLY',
        risk: 10,
        reason: 'Polite initial greeting',
        reply: 'こんにちは。どのようなご用件でしょうか？',
      },
      'こんにちは。どのようなご用件でしょうか？',
    );

    const firewall = new HumanFirewallCore(mock, mock);
    const result = await firewall.processMessage('はじめまして！', 'thread-hash-1');

    expect(result.classification.action).toBe('POLITE_REPLY');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
    expect(result.candidateReply).toBe('こんにちは。どのようなご用件でしょうか？');
  });

  it('processes scam message into TIME_WASTER with curiosity reply', async () => {
    const mock = new MockLLM(
      {
        category: 'SCAM',
        action: 'TIME_WASTER',
        risk: 85,
        reason: 'Suspicious investment invitation',
        reply: 'なるほど。それは具体的にどういう仕組みなんですか？',
      },
      'なるほど。それは具体的にどういう仕組みなんですか？',
    );

    const firewall = new HumanFirewallCore(mock, mock);
    const result = await firewall.processMessage(
      '誰でも月100万円稼げる最新の投資です！',
      'thread-hash-scam',
    );

    expect(result.classification.action).toBe('TIME_WASTER');
    expect(result.finalDecision).toBe('SEND_ALLOWED');
    expect(result.candidateReply).toContain('どういう仕組みなんですか');
  });

  it('intercepts and BLOCKS replies that contain PII or commitments (Reply Guard integration)', async () => {
    // Simulated LLM that mistakenly hallucinated personal email and meeting commitment
    const dangerousMock = new MockLLM(
      {
        category: 'NORMAL',
        action: 'POLITE_REPLY',
        risk: 20,
        reason: 'Greeting',
        reply: '明日15時にオフィスでお会いしましょう！',
      },
      '明日15時にオフィスでお会いしましょう！',
    );

    const firewall = new HumanFirewallCore(dangerousMock, dangerousMock);
    const result = await firewall.processMessage('明日会えませんか？', 'thread-hash-leak');

    expect(result.finalDecision).toBe('REPLY_BLOCKED');
    expect(result.guardResult?.allowed).toBe(false);
    expect(result.guardResult?.ruleTriggered).toBe('MEETING_COMMITMENT_DETECTED');
  });

  it('handles SPAM with IGNORE decision', async () => {
    const mock = new MockLLM({
      category: 'SPAM',
      action: 'IGNORE',
      risk: 40,
      reason: 'Broadcast marketing spam',
    });

    const firewall = new HumanFirewallCore(mock, mock);
    const result = await firewall.processMessage('本日限りのセール！', 'thread-hash-spam');

    expect(result.finalDecision).toBe('IGNORED');
    expect(result.candidateReply).toBeUndefined();
  });

  it('handles threats and emergencies with HUMAN_REQUIRED', async () => {
    const mock = new MockLLM({
      category: 'HARASSMENT',
      action: 'HUMAN_REQUIRED',
      risk: 95,
      reason: 'Physical threat detected',
    });

    const firewall = new HumanFirewallCore(mock, mock);
    const result = await firewall.processMessage('危害を加えるぞ', 'thread-hash-threat');

    expect(result.finalDecision).toBe('HUMAN_REQUIRED');
  });

  it('handles credential / OTP requests with BLOCK_RECOMMENDED', async () => {
    const mock = new MockLLM({
      category: 'SCAM',
      action: 'BLOCK_RECOMMENDED',
      risk: 99,
      reason: 'SMS OTP verification theft attempt',
    });

    const firewall = new HumanFirewallCore(mock, mock);
    const result = await firewall.processMessage('届いた6桁のコードを教えて', 'thread-hash-otp');

    expect(result.finalDecision).toBe('BLOCK_RECOMMENDED');
  });
});

describe('Live Gemini Provider Integration (with API Key)', () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const runLiveTest = apiKey && apiKey.length > 20 ? it : it.skip;

  runLiveTest('live Gemini classifies scam message accurately', async () => {
    const provider = new GeminiProvider(apiKey);
    const result = await provider.classify('月利50%保証の暗号通貨投資です。今すぐ参加してください。');

    expect(result.category).toBe('SCAM');
    expect(['TIME_WASTER', 'BLOCK_RECOMMENDED']).toContain(result.action);
    expect(result.risk).toBeGreaterThanOrEqual(60);
  }, 15000);

  runLiveTest('live Gemini generates safe TIME_WASTER response with question', async () => {
    const provider = new GeminiProvider(apiKey);
    const reply = await provider.generateReply(
      'TIME_WASTER',
      '月30万円稼げる副業の案件に興味ありませんか？',
    );

    expect(reply.length).toBeGreaterThan(0);
    // Must contain a question mark (Japanese or Western)
    expect(reply).toMatch(/[？?]/);
  }, 30000);
});
