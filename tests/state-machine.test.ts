import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { determineTimeWasterState, getTimeWasterStateDirectives, type TimeWasterState } from '../src/core/state-machine.js';
import { HumanFirewallCore } from '../src/core/firewall.js';
import { FirewallPipeline } from '../src/core/pipeline.js';
import { ThreadStore, computeHash } from '../src/core/storage.js';
import { setSystemPause } from '../src/core/killswitch.js';
import { resetConfigForTest } from '../src/core/config.js';
import type { LLMClassifier, LLMReplyGenerator } from '../src/core/llm.js';

class MockStateGenerator implements LLMClassifier, LLMReplyGenerator {
  public name = 'MockStateGenerator';
  public lastStatePassed?: string;

  public async classify(_msg: string) {
    return {
      category: 'SCAM' as const,
      action: 'TIME_WASTER' as const,
      risk: 85,
      reason: 'Test scam message',
    };
  }

  public async generateReply(
    _action: 'POLITE_REPLY' | 'TIME_WASTER',
    _msg: string,
    _history?: string,
    timeWasterState?: string,
  ): Promise<string> {
    this.lastStatePassed = timeWasterState;
    if (timeWasterState === 'CONFUSED_CURIOUS') {
      return 'なるほど。具体的にはどういう仕組みなんですか？';
    }
    if (timeWasterState === 'DEEP_PROBING') {
      return '詳しくありがとうございます。どうして私に声をかけてくださったんですか？';
    }
    return 'ご丁寧にありがとうございます。ただ自分には少し難しそうなのでやめておきます。';
  }
}

describe('Phase 6: Time Waster State Machine', () => {
  it('correctly transitions state across replyCount (0 -> 1 -> 2 -> 3)', () => {
    expect(determineTimeWasterState(0)).toBe('CONFUSED_CURIOUS');
    expect(determineTimeWasterState(1)).toBe('DEEP_PROBING');
    expect(determineTimeWasterState(2)).toBe('HESITANT_CLOSING');
    expect(determineTimeWasterState(3)).toBe('HESITANT_CLOSING');
  });

  it('generates non-empty prompt directives for every state', () => {
    const states: TimeWasterState[] = ['CONFUSED_CURIOUS', 'DEEP_PROBING', 'HESITANT_CLOSING'];
    for (const st of states) {
      const directive = getTimeWasterStateDirectives(st);
      expect(directive).toContain('【会話フェーズ:');
      expect(directive.length).toBeGreaterThan(20);
    }
  });

  describe('Pipeline State Transition Integration (Dry Run)', () => {
    let store: ThreadStore;
    let mockGen: MockStateGenerator;
    let pipeline: FirewallPipeline;

    beforeEach(() => {
      setSystemPause(false);
      resetConfigForTest();
      store = new ThreadStore(':memory:');
      mockGen = new MockStateGenerator();
      const firewallCore = new HumanFirewallCore(mockGen, mockGen);
      pipeline = new FirewallPipeline(firewallCore, store);
    });

    afterEach(() => {
      setSystemPause(false);
      store.close();
    });

    it('advances conversational state seamlessly across multi-turn exchanges', async () => {
      const threadId = 'tw-state-thread-1';
      const threadHash = computeHash(threadId);
      const senderIdHash = computeHash('scammer-1');

      // Turn 1: replyCount = 0 -> CONFUSED_CURIOUS
      const turn1 = await pipeline.handleIncomingMessage({
        threadId,
        threadHash,
        senderIdHash,
        lastMessageHash: computeHash('Msg 1: 月利30%の投資案件があります'),
        incomingText: '月利30%の投資案件があります',
      });
      expect(turn1?.timeWasterState).toBe('CONFUSED_CURIOUS');
      expect(mockGen.lastStatePassed).toBe('CONFUSED_CURIOUS');
      expect(turn1?.candidateReply).toContain('仕組み');
      expect(turn1?.finalDecision).toBe('SEND_ALLOWED');
      // In Dry Run, replyCount is not incremented in DB (stays 0) to protect production quotas
      expect(store.getThread(threadHash)?.replyCount).toBe(0);

      // Simulate after 1st actual reply for Turn 2: replyCount = 1 -> DEEP_PROBING
      const state1 = store.getThread(threadHash)!;
      store.upsertThread({ ...state1, replyCount: 1 });

      const turn2 = await pipeline.handleIncomingMessage({
        threadId,
        threadHash,
        senderIdHash,
        lastMessageHash: computeHash('Msg 2: AIトレードを利用して自動で利益が出ます'),
        incomingText: 'AIトレードを利用して自動で利益が出ます',
      });
      expect(turn2?.timeWasterState).toBe('DEEP_PROBING');
      expect(mockGen.lastStatePassed).toBe('DEEP_PROBING');
      expect(turn2?.candidateReply).toContain('どうして私に');
      expect(turn2?.finalDecision).toBe('SEND_ALLOWED');

      // Simulate after 2nd actual reply for Turn 3: replyCount = 2 -> HESITANT_CLOSING
      const state2 = store.getThread(threadHash)!;
      store.upsertThread({ ...state2, replyCount: 2 });

      const turn3 = await pipeline.handleIncomingMessage({
        threadId,
        threadHash,
        senderIdHash,
        lastMessageHash: computeHash('Msg 3: 特別な枠なのであなたに声をかけました'),
        incomingText: '特別な枠なのであなたに声をかけました',
      });
      expect(turn3?.timeWasterState).toBe('HESITANT_CLOSING');
      expect(mockGen.lastStatePassed).toBe('HESITANT_CLOSING');
      expect(turn3?.candidateReply).toContain('やめておきます');
      expect(turn3?.finalDecision).toBe('SEND_ALLOWED');
    });
  });
});
