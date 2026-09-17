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
    const targetThreadId = 'controlled-thread-001';
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
});
