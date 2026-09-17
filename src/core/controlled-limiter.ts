import { getConfig } from './config.js';
import type { ThreadStore } from './storage.js';

export interface ControlledLimitResult {
  allowed: boolean;
  reason?: string;
  currentCount: number;
  maxReplies: number;
}

/**
 * Checks whether a live reply can be safely dispatched to the specified thread.
 * Enforces:
 * 1. Explicit test thread allowance (ALLOWED_TEST_THREAD_ID)
 * 2. Maximum reply limit per thread (Phase 5: default 3 replies)
 * 3. Daily reply limit (24 hours)
 * 4. Thread paused state
 */
export function checkControlledReplyEligibility(
  threadId: string,
  threadHash: string,
  store: ThreadStore,
): ControlledLimitResult {
  const config = getConfig();
  const maxReplies = config.CONTROLLED_MAX_REPLIES;
  const existing = store.getThread(threadHash);
  const currentCount = existing?.replyCount || 0;

  // 1. Thread paused check
  if (existing?.paused) {
    return {
      allowed: false,
      reason: 'THREAD_PAUSED: This thread has reached its reply limit or is manually paused.',
      currentCount,
      maxReplies,
    };
  }

  // 2. Explicit thread allowance check (Strict equality only, no includes)
  const allowedTarget = config.ALLOWED_TEST_THREAD_ID?.trim();
  if (!allowedTarget) {
    return {
      allowed: false,
      reason: 'TARGET_NOT_CONFIGURED: ALLOWED_TEST_THREAD_ID is empty. Only specified test thread is allowed.',
      currentCount,
      maxReplies,
    };
  }

  const isMatchingThread =
    allowedTarget === threadId ||
    allowedTarget === threadHash;

  if (!isMatchingThread) {
    return {
      allowed: false,
      reason: `THREAD_NOT_ALLOWED: Target ${threadHash.slice(0, 8)} does not match ALLOWED_TEST_THREAD_ID.`,
      currentCount,
      maxReplies,
    };
  }

  // 3. Maximum reply limit check (Phase 5 constraint: max 3 replies)
  if (currentCount >= maxReplies) {
    return {
      allowed: false,
      reason: `LIMIT_REACHED: Thread has already received ${currentCount}/${maxReplies} replies.`,
      currentCount,
      maxReplies,
    };
  }

  // 4. Rolling 24-hour daily limit check
  const recent24hCount = store.getRecentReplyCount(threadHash, 24 * 60 * 60 * 1000);
  if (recent24hCount >= config.MAX_REPLIES_PER_THREAD_PER_DAY) {
    return {
      allowed: false,
      reason: `DAILY_LIMIT_REACHED: Thread has exceeded ${config.MAX_REPLIES_PER_THREAD_PER_DAY} replies in rolling 24h (count: ${recent24hCount}).`,
      currentCount,
      maxReplies,
    };
  }

  return {
    allowed: true,
    currentCount,
    maxReplies,
  };
}
