import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createDashboardServer } from '../src/dashboard/server.js';
import { ThreadStore, computeHash } from '../src/core/storage.js';
import { setSystemPause, isSystemPaused } from '../src/core/killswitch.js';
import { resetConfigForTest } from '../src/core/config.js';

describe('Phase 7: Local Dashboard Server (localhost)', () => {
  let store: ThreadStore;
  let serverInstance: ReturnType<typeof createDashboardServer>;
  const testPort = 3999;
  const baseUrl = `http://localhost:${testPort}`;

  beforeAll(async () => {
    store = new ThreadStore(':memory:');
    serverInstance = createDashboardServer({ port: testPort, store });
    await serverInstance.start();
  });

  afterAll(async () => {
    await serverInstance.close();
    store.close();
  });

  beforeEach(() => {
    setSystemPause(false);
    resetConfigForTest();
  });

  afterEach(() => {
    setSystemPause(false);
  });

  it('serves dashboard HTML on GET /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Messenger Human Firewall Dashboard');
  });

  it('returns system status JSON on GET /api/status', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.paused).toBe(false);
    expect(data.dryRun).toBeDefined();
    expect(data.maxReplies).toBeDefined();
  });

  it('toggles global Kill Switch via POST /api/killswitch', async () => {
    expect(isSystemPaused()).toBe(false);

    // Turn pause ON
    const resOn = await fetch(`${baseUrl}/api/killswitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    expect(resOn.status).toBe(200);
    expect(isSystemPaused()).toBe(true);

    // Turn pause OFF
    const resOff = await fetch(`${baseUrl}/api/killswitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: false }),
    });
    expect(resOff.status).toBe(200);
    expect(isSystemPaused()).toBe(false);
  });

  it('lists stored threads via GET /api/threads and supports per-thread pausing', async () => {
    const threadHash = computeHash('thread-dashboard-test');
    store.upsertThread({
      threadId: threadHash,
      senderIdHash: computeHash('sender-1'),
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      lastMessageHash: computeHash('Hello'),
      mode: 'TIME_WASTER',
      messageCount: 2,
      replyCount: 1,
      riskScore: 85,
      paused: false,
      humanRequired: false,
    });

    const resList = await fetch(`${baseUrl}/api/threads`);
    expect(resList.status).toBe(200);
    const threads = await resList.json();
    expect(threads).toHaveLength(1);
    expect(threads[0].threadId).toBe(threadHash);
    expect(threads[0].mode).toBe('TIME_WASTER');
    expect(threads[0].paused).toBe(false);

    // Pause this thread
    const resPause = await fetch(`${baseUrl}/api/threads/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: threadHash, paused: true }),
    });
    expect(resPause.status).toBe(200);
    expect(store.getThread(threadHash)?.paused).toBe(true);
  });
});
