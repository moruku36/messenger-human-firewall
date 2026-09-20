import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkControlledReplyEligibility,
  computeHash,
  FirewallPipeline,
  HumanFirewallCore,
  resetConfigForTest,
  setSystemPause,
  ThreadStore,
  type ClassificationResult,
  type LLMClassifier,
  type LLMReplyGenerator,
} from '../src/core/index.js';
import { sendMessageToActiveThread } from '../src/channels/messenger/sender.js';
import { extractActiveThreadMessages } from '../src/channels/messenger/watcher.js';

class ControlledMockProvider implements LLMClassifier, LLMReplyGenerator {
  public name = 'controlled-mock';

  public async classify(): Promise<ClassificationResult> {
    return {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 80,
      reason: 'Controlled Reply verification',
      reply: 'なるほど。具体的にはどういう仕組みなんですか？',
    };
  }

  public async generateReply(): Promise<string> {
    return 'なるほど。具体的にはどういう仕組みなんですか？';
  }
}

describe('Phase 5: Controlled Reply & Safeguards Test Suite', () => {
  let browser: Browser;
  let page: Page;
  let store: ThreadStore;
  const fixturePath = `file://${path.resolve(__dirname, 'fixtures/messenger-mock.html').replace(/\\/g, '/')}`;

  beforeAll(async () => {
    const launchOptions = process.env.CI ? { headless: true } : { channel: 'chrome', headless: true };
    browser = await chromium.launch(launchOptions);
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    resetConfigForTest();
    setSystemPause(false);
    store = new ThreadStore(':memory:');
    page = await browser.newPage();
    await page.goto(fixturePath);
  });

  afterEach(async () => {
    setSystemPause(false);
    store.close();
    await page.close();
  });

  it('rejects dispatch when ALLOWED_TEST_THREAD_ID is not configured', () => {
    delete process.env.ALLOWED_TEST_THREAD_ID;
    resetConfigForTest();

    const result = checkControlledReplyEligibility('thread-123', 'hash-123', store);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('TARGET_NOT_CONFIGURED');
  });

  it('rejects dispatch to threads not matching ALLOWED_TEST_THREAD_ID', () => {
    process.env.ALLOWED_TEST_THREAD_ID = 'allowed-target-thread';
    resetConfigForTest();

    const result = checkControlledReplyEligibility('unauthorized-thread', 'unauth-hash', store);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('THREAD_NOT_ALLOWED');
  });

  it('physically inputs and sends a message to the active thread on mock fixture', async () => {
    // Initial messages count
    const initialMessages = await extractActiveThreadMessages(page);

    const sent = await sendMessageToActiveThread(page, 'テスト送信メッセージです。');
    expect(sent).toBe(true);

    // Verify DOM was updated with the new outgoing message
    const updatedMessages = await extractActiveThreadMessages(page);
    expect(updatedMessages.length).toBe(initialMessages.length + 1);

    const lastMsg = updatedMessages[updatedMessages.length - 1];
    expect(lastMsg.direction).toBe('outgoing');
    expect(lastMsg.text).toBe('テスト送信メッセージです。');
  });

  it('strictly enforces 3-reply maximum limit per thread and auto-pauses', async () => {
    const targetThreadId = 'thread-1';
    const targetHash = computeHash(targetThreadId);
    process.env.ALLOWED_TEST_THREAD_ID = targetThreadId;
    process.env.DRY_RUN = 'false';
    process.env.CONTROLLED_MAX_REPLIES = '3';
    process.env.MIN_REPLY_INTERVAL_SECONDS = '1';
    resetConfigForTest();

    const mock = new ControlledMockProvider();
    const firewall = new HumanFirewallCore(mock, mock);
    const pipeline = new FirewallPipeline(firewall, store);

    // Reply 1
    await pipeline.handleIncomingMessage({
      threadId: targetThreadId,
      threadHash: targetHash,
      senderIdHash: computeHash('sender-1'),
      lastMessageHash: computeHash('Incoming 1'),
      incomingText: '案件1です',
      page,
    });
    expect(store.getThread(targetHash)?.replyCount).toBe(1);
    expect(store.getThread(targetHash)?.paused).toBe(false);

    // Reply 2
    await pipeline.handleIncomingMessage({
      threadId: targetThreadId,
      threadHash: targetHash,
      senderIdHash: computeHash('sender-1'),
      lastMessageHash: computeHash('Incoming 2'),
      incomingText: '案件2です',
      page,
    });
    expect(store.getThread(targetHash)?.replyCount).toBe(2);
    expect(store.getThread(targetHash)?.paused).toBe(false);

    // Reply 3 (Reaches max limit 3)
    await pipeline.handleIncomingMessage({
      threadId: targetThreadId,
      threadHash: targetHash,
      senderIdHash: computeHash('sender-1'),
      lastMessageHash: computeHash('Incoming 3'),
      incomingText: '案件3です',
      page,
    });
    const threadAfter3 = store.getThread(targetHash);
    expect(threadAfter3?.replyCount).toBe(3);
    expect(threadAfter3?.paused).toBe(true); // Must be auto-paused!

    // Reply 4 (Must be blocked due to limit reached / paused)
    const initialDomCount = (await extractActiveThreadMessages(page)).length;
    await pipeline.handleIncomingMessage({
      threadId: targetThreadId,
      threadHash: targetHash,
      senderIdHash: computeHash('sender-1'),
      lastMessageHash: computeHash('Incoming 4'),
      incomingText: '案件4です',
      page,
    });
    const afterAttempt4DomCount = (await extractActiveThreadMessages(page)).length;
    expect(afterAttempt4DomCount).toBe(initialDomCount); // No new message in DOM
    expect(store.getThread(targetHash)?.replyCount).toBe(3); // Reply count remains 3
    expect(store.getThread(targetHash)?.messageCount).toBe(4); // Incoming message count is 4
  });

  it('blocks dispatch instantly if Kill Switch is asserted before send', async () => {
    const targetThreadId = 'killswitch-thread';
    const targetHash = computeHash(targetThreadId);
    process.env.ALLOWED_TEST_THREAD_ID = targetThreadId;
    process.env.DRY_RUN = 'false';
    resetConfigForTest();

    setSystemPause(true); // Trigger Kill Switch

    const mock = new ControlledMockProvider();
    const firewall = new HumanFirewallCore(mock, mock);
    const pipeline = new FirewallPipeline(firewall, store);

    await expect(
      pipeline.handleIncomingMessage({
        threadId: targetThreadId,
        threadHash: targetHash,
        senderIdHash: computeHash('sender-ks'),
        lastMessageHash: computeHash('Incoming KS'),
        incomingText: 'テストです',
        page,
      }),
    ).rejects.toThrow('PAUSED');
  });

  it('rejects partial substring matches strictly (strict equality only)', () => {
    process.env.ALLOWED_TEST_THREAD_ID = 'thread-1';
    resetConfigForTest();

    // 'thread-10' or 'thread-1-extra' should NOT match 'thread-1'
    const partialResult = checkControlledReplyEligibility('thread-10', computeHash('thread-10'), store);
    expect(partialResult.allowed).toBe(false);
    expect(partialResult.reason).toContain('THREAD_NOT_ALLOWED');
  });

  it('blocks dispatch when rolling 24h reply limit is exceeded', () => {
    const targetThreadId = 'thread-1';
    const targetHash = computeHash(targetThreadId);
    process.env.ALLOWED_TEST_THREAD_ID = targetThreadId;
    process.env.MAX_REPLIES_PER_THREAD_PER_DAY = '2';
    process.env.CONTROLLED_MAX_REPLIES = '10';
    resetConfigForTest();

    // Record 2 replies in the last hour
    const now = Date.now();
    store.recordReply(targetHash, now - 60000);
    store.recordReply(targetHash, now - 30000);

    const result = checkControlledReplyEligibility(targetThreadId, targetHash, store);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('DAILY_LIMIT_REACHED');
  });

  it('fails safely when sending to a thread that does not exist in DOM', async () => {
    await expect(
      sendMessageToActiveThread(page, 'こんにちは', 'non-existent-thread-id-999')
    ).rejects.toThrow('Active thread verification failed');
  });

  it('enforces MAX_LLM_REQUESTS_PER_DAY hard cap and blocks LLM calls when exceeded', async () => {
    process.env.MAX_LLM_REQUESTS_PER_DAY = '2';
    resetConfigForTest();

    const mock = new ControlledMockProvider();
    const firewall = new HumanFirewallCore(mock, mock);
    const pipeline = new FirewallPipeline(firewall, store);

    // Seed 2 past requests in rolling 24h
    store.recordLlmRequest(Date.now() - 5000);
    store.recordLlmRequest(Date.now() - 1000);

    const result = await pipeline.handleIncomingMessage({
      threadId: 'thread-quota-test',
      threadHash: computeHash('thread-quota-test'),
      senderIdHash: computeHash('sender-quota'),
      lastMessageHash: computeHash('Quota test message'),
      incomingText: '案件相談です',
    });

    expect(result).not.toBeNull();
    expect(result?.finalDecision).toBe('HUMAN_REQUIRED');
    expect(result?.classification.reason).toContain('Daily LLM request quota reached');
  });

  describe('AUTO_REPLY_SCOPE=all_threads (Production Mode)', () => {
    it('defaults to test_thread_only when AUTO_REPLY_SCOPE is unset', () => {
      delete process.env.AUTO_REPLY_SCOPE;
      delete process.env.ALLOWED_TEST_THREAD_ID;
      resetConfigForTest();

      const result = checkControlledReplyEligibility('any-thread-id', 'any-hash', store);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('TARGET_NOT_CONFIGURED');
    });

    it('allows dispatch to any thread without ALLOWED_TEST_THREAD_ID when AUTO_REPLY_SCOPE=all_threads', () => {
      process.env.AUTO_REPLY_SCOPE = 'all_threads';
      delete process.env.ALLOWED_TEST_THREAD_ID;
      process.env.CONTROLLED_MAX_REPLIES = '3';
      resetConfigForTest();

      const result = checkControlledReplyEligibility('arbitrary-thread-999', 'arbitrary-hash-999', store);
      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(0);
      expect(result.maxReplies).toBe(3);
    });

    it('enforces CONTROLLED_MAX_REPLIES limit per thread in all_threads mode', () => {
      process.env.AUTO_REPLY_SCOPE = 'all_threads';
      delete process.env.ALLOWED_TEST_THREAD_ID;
      process.env.CONTROLLED_MAX_REPLIES = '2';
      resetConfigForTest();

      const threadHash = 'all-threads-limit-test';
      store.upsertThread({
        threadId: threadHash,
        senderIdHash: 'sender-hash',
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        lastMessageHash: 'msg-hash',
        mode: 'TIME_WASTER',
        messageCount: 2,
        replyCount: 2,
        riskScore: 50,
        paused: false,
        humanRequired: false,
      });

      const result = checkControlledReplyEligibility('any-thread', threadHash, store);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('LIMIT_REACHED');
      expect(result.currentCount).toBe(2);
    });

    it('enforces 24-hour rolling limit in all_threads mode', () => {
      process.env.AUTO_REPLY_SCOPE = 'all_threads';
      delete process.env.ALLOWED_TEST_THREAD_ID;
      process.env.CONTROLLED_MAX_REPLIES = '10';
      process.env.MAX_REPLIES_PER_THREAD_PER_DAY = '2';
      resetConfigForTest();

      const threadHash = 'all-threads-daily-test';
      const now = Date.now();
      store.recordReply(threadHash, now - 5000);
      store.recordReply(threadHash, now - 1000);

      const result = checkControlledReplyEligibility('any-thread', threadHash, store);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('DAILY_LIMIT_REACHED');
    });

    it('enforces paused thread check in all_threads mode', () => {
      process.env.AUTO_REPLY_SCOPE = 'all_threads';
      delete process.env.ALLOWED_TEST_THREAD_ID;
      resetConfigForTest();

      const threadHash = 'all-threads-paused-test';
      store.upsertThread({
        threadId: threadHash,
        senderIdHash: 'sender-hash',
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        lastMessageHash: 'msg-hash',
        mode: 'TIME_WASTER',
        messageCount: 1,
        replyCount: 0,
        riskScore: 50,
        paused: true,
        humanRequired: false,
      });

      const result = checkControlledReplyEligibility('any-thread', threadHash, store);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('THREAD_PAUSED');
    });

    it('enforces global killswitch (assertNotPaused) in all_threads mode', async () => {
      process.env.AUTO_REPLY_SCOPE = 'all_threads';
      delete process.env.ALLOWED_TEST_THREAD_ID;
      process.env.DRY_RUN = 'false';
      resetConfigForTest();

      setSystemPause(true); // Emergency Stop

      const mock = new ControlledMockProvider();
      const firewall = new HumanFirewallCore(mock, mock);
      const pipeline = new FirewallPipeline(firewall, store);

      await expect(
        pipeline.handleIncomingMessage({
          threadId: 'arbitrary-thread-id',
          threadHash: computeHash('arbitrary-thread-id'),
          senderIdHash: computeHash('arbitrary-sender'),
          lastMessageHash: computeHash('message-under-pause'),
          incomingText: '案件相談です',
          page,
        }),
      ).rejects.toThrow('PAUSED');
    });
  });
});
