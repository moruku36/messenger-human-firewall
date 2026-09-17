import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeHash, ThreadStore } from '../src/core/storage.js';
import type { ThreadState } from '../src/core/types.js';

describe('ThreadStore (SQLite)', () => {
  let store: ThreadStore;

  beforeEach(() => {
    store = new ThreadStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('computes sha256 hash stably', () => {
    const hash1 = computeHash('Hello World');
    const hash2 = computeHash('Hello World  ');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('stores and retrieves thread state without raw message text', () => {
    const threadState: ThreadState = {
      threadId: 'thread-101',
      senderIdHash: computeHash('user_abc'),
      firstSeen: 1700000000,
      lastSeen: 1700000500,
      lastMessageHash: computeHash('First incoming message'),
      mode: 'TIME_WASTER',
      messageCount: 1,
      riskScore: 70,
      paused: false,
      humanRequired: false,
    };

    store.upsertThread(threadState);
    const retrieved = store.getThread('thread-101');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.threadId).toBe('thread-101');
    expect(retrieved?.mode).toBe('TIME_WASTER');
    expect(retrieved?.messageCount).toBe(1);
    expect(retrieved?.riskScore).toBe(70);
  });

  it('detects duplicate messages accurately via hash', () => {
    const initialHash = computeHash('Duplicate test message');
    store.upsertThread({
      threadId: 'thread-dup',
      senderIdHash: computeHash('user_xyz'),
      firstSeen: 100,
      lastSeen: 100,
      lastMessageHash: initialHash,
      mode: 'POLITE_REPLY',
      messageCount: 1,
      riskScore: 10,
      paused: false,
      humanRequired: false,
    });

    expect(store.isDuplicateMessage('thread-dup', initialHash)).toBe(true);

    const newHash = computeHash('New subsequent message');
    expect(store.isDuplicateMessage('thread-dup', newHash)).toBe(false);
  });
});
