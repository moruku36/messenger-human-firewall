import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  extractActiveThreadMessages,
  isLoginRequired,
  navigateToMessageRequests,
  scanMessageRequests,
} from '../src/channels/messenger/watcher.js';
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
});
