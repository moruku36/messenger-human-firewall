import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  extractActiveThreadMessages,
  isLoginRequired,
  navigateToMessageRequests,
  scanMessageRequests,
  selectAndVerifyActiveThread,
  threadIdFromHref,
} from '../src/channels/messenger/watcher.js';
import { resetConfigForTest } from '../src/core/config.js';
import { ThreadStore } from '../src/core/storage.js';

describe('Browser Watcher with Fake Messenger HTML Fixture', () => {
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

  afterEach(() => {
    delete process.env.SCAN_INCLUDE_READ_THREADS;
    resetConfigForTest();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    store = new ThreadStore(':memory:');
    await page.goto(fixturePath);
  });

  it('detects login status correctly (logged in on mock)', async () => {
    const loginNeeded = await isLoginRequired(page);
    expect(loginNeeded).toBe(false);
  });

  it('detects login required when login form is present', async () => {
    await page.setContent('<form><input id="email" /><button name="login">Log In</button></form>');
    const loginNeeded = await isLoginRequired(page);
    expect(loginNeeded).toBe(true);
  });

  it('navigates to message requests tab', async () => {
    const success = await navigateToMessageRequests(page);
    expect(success).toBe(true);
  });

  it('extracts incoming messages and identifies direction accurately', async () => {
    const messages = await extractActiveThreadMessages(page);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].direction).toBe('incoming');
    expect(messages[0].text).toContain('はじめまして');
  });

  it('scans unread threads, extracts last incoming text, and deduplicates via SQLite', async () => {
    // First scan: Detects unread Thread 1
    const results = await scanMessageRequests(page, store);
    expect(results.length).toBe(1);

    const first = results[0];
    expect(first.threadId).toBe('thread-1');
    expect(first.lastIncomingText).toContain('月30万円稼げる副業');
    expect(first.eligibility.eligible).toBe(true);

    // Simulate saving state to ThreadStore
    store.upsertThread({
      threadId: first.threadHash,
      senderIdHash: first.senderIdHash,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      lastMessageHash: first.lastMessageHash,
      mode: 'TIME_WASTER',
      messageCount: 1,
      riskScore: 80,
      paused: false,
      humanRequired: false,
    });

    // Second scan: Should be skipped as duplicate
    const secondScan = await scanMessageRequests(page, store);
    expect(secondScan.length).toBe(0);
  });

  it('skips unread threads whose last message is outgoing or of ambiguous direction', async () => {
    // thread-3 (last message outgoing) and thread-4 (last row is a centered notice) are unread
    // but must never be eligible.
    const results = await scanMessageRequests(page, store);
    expect(results.map((r) => r.threadId)).toEqual(['thread-1']);
  });

  it('also processes threads without an unread marker when SCAN_INCLUDE_READ_THREADS=true', async () => {
    process.env.SCAN_INCLUDE_READ_THREADS = 'true';
    resetConfigForTest();

    const results = await scanMessageRequests(page, store);
    expect(results.map((r) => r.threadId).sort()).toEqual(['thread-1', 'thread-2']);
  });

  it('derives direction from horizontal position when rows carry no markers', async () => {
    await page.click('#link-thread-3');
    const messages = await extractActiveThreadMessages(page);
    expect(messages.map((m) => m.direction)).toEqual(['incoming', 'outgoing']);

    await page.click('#link-thread-4');
    const ambiguous = await extractActiveThreadMessages(page);
    expect(ambiguous.map((m) => m.direction)).toEqual(['incoming', 'unknown']);
  });

  it('reads message-request panes (role=log > role=article) using visible text only', async () => {
    await page.setContent(`
      <div role="main">
        <div role="log" style="width:800px">
          <h3 dir="auto">共通の情報</h3>
          <div role="article" style="width:800px">
            <div role="presentation"><span dir="auto" style="display:inline-block;width:300px">はじめまして、投資の件です</span></div>
            <span dir="auto" style="display:inline-block;width:0;height:0;overflow:hidden">hidden accessibility text</span>
          </div>
          <div role="article" style="width:800px">
            <div role="presentation"><span dir="auto" style="display:inline-block;width:300px">こちらのリンクから登録を</span></div>
          </div>
          <div role="alert"><span dir="auto">承認するまで相手には表示されません</span></div>
        </div>
        <div role="button" aria-label="承認">承認</div>
      </div>`);

    const messages = await extractActiveThreadMessages(page);
    expect(messages.map((m) => m.text)).toEqual(['はじめまして、投資の件です', 'こちらのリンクから登録を']);
    expect(messages.every((m) => m.direction === 'incoming')).toBe(true);
  });

  it('classifies wide left-aligned bubbles as incoming and centred notices as unknown', async () => {
    await page.setContent(`
      <div role="grid" style="width:800px">
        <div role="row"><span dir="auto" style="display:block;width:700px">とても長い受信メッセージ</span></div>
        <div role="row" style="text-align:center"><span dir="auto" style="display:block;width:200px;margin:0 auto">不在着信</span></div>
        <div role="row"><span dir="auto" style="display:block;width:300px;margin-left:500px">返信</span></div>
      </div>`);
    const messages = await extractActiveThreadMessages(page);
    expect(messages.map((m) => m.direction)).toEqual(['incoming', 'unknown', 'outgoing']);
  });

  it('treats every message on a /requests/ thread as incoming (requester messages only)', async () => {
    const body = `
      <div role="main"><div role="log" style="width:800px">
        <div role="article" style="width:800px"><span dir="auto" style="display:block;width:200px;margin:0 auto">中央寄りの受信メッセージ</span></div>
      </div></div>`;
    await page.route('https://www.messenger.com/requests/t/1/', (route) =>
      route.fulfill({ contentType: 'text/html', body }),
    );
    await page.goto('https://www.messenger.com/requests/t/1/');
    const messages = await extractActiveThreadMessages(page);
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe('incoming');
  });

  it('extracts the thread id from /t/<id> and /e2ee/t/<id> hrefs, never from names', () => {
    expect(threadIdFromHref('/t/1234567890')).toBe('1234567890');
    expect(threadIdFromHref('/e2ee/t/998877/')).toBe('998877');
    expect(threadIdFromHref('/requests/t/42?x=1')).toBe('42');
    expect(threadIdFromHref('/marketplace/')).toBeNull();
    expect(threadIdFromHref(null)).toBeNull();
  });

  it('selects and verifies the exact active thread by aria-current', async () => {
    expect(await selectAndVerifyActiveThread(page, 'thread-3')).toBe(true);
    expect(await page.getAttribute('#link-thread-3', 'aria-current')).toBe('page');
    expect(await page.getAttribute('#link-thread-1', 'aria-current')).toBeNull();
    expect(await selectAndVerifyActiveThread(page, 'thread-999')).toBe(false);
  });
});
