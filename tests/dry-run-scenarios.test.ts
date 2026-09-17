import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FirewallPipeline,
  HumanFirewallCore,
  ThreadStore,
  type LLMClassifier,
  type LLMReplyGenerator,
  type ClassificationResult,
  computeHash,
} from '../src/core/index.js';
import { GeminiProvider } from '../src/llm/gemini.js';

interface ScenarioDefinition {
  title: string;
  incomingText: string;
  expectedCategory: string;
  expectedAction: string;
  minRisk: number;
  mockClassification: ClassificationResult;
  mockReply?: string;
}

const TEN_SCENARIOS: ScenarioDefinition[] = [
  {
    title: '1. 普通の挨拶',
    incomingText: 'はじめまして！タイムラインで見かけてご連絡しました。よろしくお願いします。',
    expectedCategory: 'NORMAL',
    expectedAction: 'POLITE_REPLY',
    minRisk: 0,
    mockClassification: {
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 10,
      reason: '一般的な丁寧な挨拶',
      reply: 'はじめまして。どのようなご用件でしょうか？',
    },
    mockReply: 'はじめまして。どのようなご用件でしょうか？',
  },
  {
    title: '2. 営業',
    incomingText: '突然のDM失礼します。貴社の業務効率を劇的に改善する新世代AIツールのご提案です。',
    expectedCategory: 'SALES',
    expectedAction: 'POLITE_REPLY',
    minRisk: 20,
    mockClassification: {
      category: 'SALES',
      action: 'POLITE_REPLY',
      risk: 30,
      reason: '一般的な営業連絡',
      reply: 'ご連絡ありがとうございます。どのようなツールなのでしょうか？',
    },
    mockReply: 'ご連絡ありがとうございます。どのようなツールなのでしょうか？',
  },
  {
    title: '3. 投資勧誘',
    incomingText: '誰でも初月から元本保証で月利30%が確実に狙える海外FXの自動売買枠に空きが出ました！',
    expectedCategory: 'SCAM',
    expectedAction: 'TIME_WASTER',
    minRisk: 70,
    mockClassification: {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 85,
      reason: '元本保証を謳う投資詐欺の疑い',
      reply: 'なるほど。それは具体的にどういう仕組みなんですか？',
    },
    mockReply: 'なるほど。それは具体的にどういう仕組みなんですか？',
  },
  {
    title: '4. 暗号資産',
    incomingText: '急上昇中の最新Web3エアドロップ銘柄です。今すぐウォレットを接続して受け取ってください。',
    expectedCategory: 'SCAM',
    expectedAction: 'TIME_WASTER',
    minRisk: 70,
    mockClassification: {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 88,
      reason: '悪意あるコントラクト署名を狙う暗号資産スパム',
      reply: 'すみません、まだよく理解できていません。もう少し詳しく教えてもらえますか？',
    },
    mockReply: 'すみません、まだよく理解できていません。もう少し詳しく教えてもらえますか？',
  },
  {
    title: '5. 恋愛詐欺風',
    incomingText: 'とても素敵なプロフィールですね！Messengerはあまり見ないので、LINEでお話ししませんか？',
    expectedCategory: 'SCAM',
    expectedAction: 'TIME_WASTER',
    minRisk: 60,
    mockClassification: {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 75,
      reason: '外部アプリへ誘導する国際ロマンス・投資誘導の手口',
      reply: 'そうなんですね。普段はどういうことをされている方なんですか？',
    },
    mockReply: 'そうなんですね。普段はどういうことをされている方なんですか？',
  },
  {
    title: '6. URL誘導',
    incomingText: '重要なお知らせです。こちらのリンクから詳細の確認をお願いします https://notice-auth.example.com',
    expectedCategory: 'SCAM',
    expectedAction: 'TIME_WASTER',
    minRisk: 60,
    mockClassification: {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 80,
      reason: '不審な外部URLへの誘導',
      reply: '興味深いですね。具体的には何が書かれているものなんですか？',
    },
    mockReply: '興味深いですね。具体的には何が書かれているものなんですか？',
  },
  {
    title: '7. 電話番号要求',
    incomingText: '至急確認したい緊急案件があります。今すぐ折り返しできるお電話番号を教えてください。',
    expectedCategory: 'SCAM',
    expectedAction: 'BLOCK_RECOMMENDED',
    minRisk: 70,
    mockClassification: {
      category: 'SCAM',
      action: 'BLOCK_RECOMMENDED',
      risk: 85,
      reason: '個人情報（電話番号）の要求',
    },
  },
  {
    title: '8. 認証コード要求',
    incomingText: 'お使いのアカウントに問題が発生しました。SMSに届いた6桁の確認コードをこちらに送ってください。',
    expectedCategory: 'SCAM',
    expectedAction: 'BLOCK_RECOMMENDED',
    minRisk: 90,
    mockClassification: {
      category: 'SCAM',
      action: 'BLOCK_RECOMMENDED',
      risk: 99,
      reason: '二要素認証コード（OTP）の詐取目的',
    },
  },
  {
    title: '9. 会おうという誘い',
    incomingText: '面白いビジネスのアイディアがあります。明日渋谷のカフェで直接お会いして詳しくお話ししませんか？',
    expectedCategory: 'SALES',
    expectedAction: 'TIME_WASTER',
    minRisk: 40,
    mockClassification: {
      category: 'SALES',
      action: 'TIME_WASTER',
      risk: 50,
      reason: '対面面談への誘導。コミットせず内容の詳細を尋ねる方針',
      reply: 'どういうアイディアなのか、まずはここで簡単にお聞かせいただけますか？',
    },
    mockReply: 'どういうアイディアなのか、まずはここで簡単にお聞かせいただけますか？',
  },
  {
    title: '10. 意味不明メッセージ',
    incomingText: 'asdfghjk 9999 ??? 🍣🍣🍣',
    expectedCategory: 'UNKNOWN',
    expectedAction: 'HUMAN_REQUIRED',
    minRisk: 20,
    mockClassification: {
      category: 'UNKNOWN',
      action: 'HUMAN_REQUIRED',
      risk: 30,
      reason: '判別不能な意味不明の文字列',
    },
  },
];

class ScenarioMockProvider implements LLMClassifier, LLMReplyGenerator {
  public name = 'scenario-mock';
  constructor(private scenario: ScenarioDefinition) {}

  public async classify(): Promise<ClassificationResult> {
    return this.scenario.mockClassification;
  }

  public async generateReply(): Promise<string> {
    return this.scenario.mockReply || 'どのようなご用件でしょうか？';
  }
}

describe('Phase 4: 10 Standard Scenarios Dry Run Integration Test', () => {
  let store: ThreadStore;

  beforeEach(() => {
    store = new ThreadStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  for (const scenario of TEN_SCENARIOS) {
    it(`evaluates scenario: [${scenario.title}] correctly in pipeline`, async () => {
      const mock = new ScenarioMockProvider(scenario);
      const firewallCore = new HumanFirewallCore(mock, mock);
      const pipeline = new FirewallPipeline(firewallCore, store);

      const threadId = `scenario-thread-${scenario.title}`;
      const threadHash = computeHash(threadId);
      const senderIdHash = computeHash(`sender-${threadId}`);
      const lastMessageHash = computeHash(scenario.incomingText);

      const result = await pipeline.handleIncomingMessage({
        threadId,
        threadHash,
        senderIdHash,
        lastMessageHash,
        incomingText: scenario.incomingText,
      });

      expect(result).not.toBeNull();
      expect(result?.classification.category).toBe(scenario.expectedCategory);
      expect(result?.classification.action).toBe(scenario.expectedAction);

      // Verify SQLite state tracking
      const savedThread = store.getThread(threadHash);
      expect(savedThread).not.toBeNull();
      expect(savedThread?.lastMessageHash).toBe(lastMessageHash);
      expect(savedThread?.mode).toBe(scenario.expectedAction);
      expect(savedThread?.messageCount).toBe(1);

      // If reply was generated, verify that Reply Guard inspected it
      if (result?.candidateReply) {
        expect(result.guardResult).toBeDefined();
        expect(result.guardResult?.allowed).toBe(true);
        expect(result.finalDecision).toBe('SEND_ALLOWED');
      }

      // Test duplicate message suppression
      const duplicateResult = await pipeline.handleIncomingMessage({
        threadId,
        threadHash,
        senderIdHash,
        lastMessageHash,
        incomingText: scenario.incomingText,
      });
      expect(duplicateResult).toBeNull();
    });
  }
});

describe('Phase 4: Live Gemini 3.6 Flash on Key Scenarios', () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const runLive = apiKey && apiKey.length > 20 ? it : it.skip;
  let store: ThreadStore;

  beforeEach(() => {
    store = new ThreadStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  runLive('classifies romance scam and generates curious non-committal reply with Gemini 3.6 Flash', async () => {
    const gemini = new GeminiProvider(apiKey);
    const firewallCore = new HumanFirewallCore(gemini, gemini);
    const pipeline = new FirewallPipeline(firewallCore, store);

    const scenario = TEN_SCENARIOS[4]; // 恋愛詐欺風
    const threadHash = computeHash('live-romance-thread');
    try {
      const result = await pipeline.handleIncomingMessage({
        threadId: 'live-romance-thread',
        threadHash,
        senderIdHash: computeHash('sender-romance'),
        lastMessageHash: computeHash(scenario.incomingText),
        incomingText: scenario.incomingText,
      });

      expect(result).not.toBeNull();
      expect(['SCAM', 'SALES', 'UNKNOWN']).toContain(result?.classification.category);
      expect(['TIME_WASTER', 'BLOCK_RECOMMENDED', 'HUMAN_REQUIRED']).toContain(result?.classification.action);

      if (result?.candidateReply) {
        expect(result.guardResult?.allowed).toBe(true);
        expect(result.candidateReply).toMatch(/[？?]/);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('429')) {
        console.warn('Skipping test assertion due to Gemini 429 quota exhaustion');
        return;
      }
      throw err;
    }
  }, 20000);

  runLive('classifies OTP verification code request as BLOCK_RECOMMENDED with Gemini 3.6 Flash', async () => {
    const gemini = new GeminiProvider(apiKey);
    const firewallCore = new HumanFirewallCore(gemini, gemini);
    const pipeline = new FirewallPipeline(firewallCore, store);

    const scenario = TEN_SCENARIOS[7]; // 認証コード要求
    const threadHash = computeHash('live-otp-thread');
    try {
      const result = await pipeline.handleIncomingMessage({
        threadId: 'live-otp-thread',
        threadHash,
        senderIdHash: computeHash('sender-otp'),
        lastMessageHash: computeHash(scenario.incomingText),
        incomingText: scenario.incomingText,
      });

      expect(result).not.toBeNull();
      if (result?.classification.reason.includes('429')) {
        console.warn('Skipping assertion due to Gemini 429 quota exhaustion');
        return;
      }
      expect(result?.classification.category).toBe('SCAM');
      expect(['BLOCK_RECOMMENDED', 'TIME_WASTER']).toContain(result?.classification.action);
      expect(result?.classification.risk).toBeGreaterThanOrEqual(70);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('429')) {
        console.warn('Skipping test assertion due to Gemini 429 quota exhaustion');
        return;
      }
      throw err;
    }
  }, 20000);
});
