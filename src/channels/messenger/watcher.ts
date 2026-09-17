import type { Page } from 'playwright';
import {
  assertNotPaused,
  computeHash,
  logEvent,
  type ThreadStore,
} from '../../core/index.js';
import { MESSENGER_SELECTORS } from './selectors.js';
import {
  evaluateThreadEligibility,
  type ThreadEligibilityResult,
  type ThreadMessage,
} from './validator.js';

export interface ScannedThread {
  threadId: string;
  threadHash: string;
  senderIdHash: string;
  lastMessageHash: string;
  lastIncomingText: string;
  eligibility: ThreadEligibilityResult;
}

/**
 * Checks whether the user is logged out (e.g. login form is shown).
 */
export async function isLoginRequired(page: Page): Promise<boolean> {
  for (const selector of MESSENGER_SELECTORS.loginForm) {
    const el = await page.$(selector);
    if (el) {
      return true;
    }
  }
  return false;
}

/**
 * Navigates to the Message Requests tab or URL.
 */
export async function navigateToMessageRequests(page: Page): Promise<boolean> {
  assertNotPaused('Navigation to Message Requests');

  // Try clicking Message Requests tab if present
  for (const selector of MESSENGER_SELECTORS.messageRequestsTab) {
    const tab = await page.$(selector);
    if (tab) {
      await tab.click();
      await page.waitForTimeout(500);
      return true;
    }
  }

  // Fallback direct navigation
  const currentUrl = page.url();
  if (!currentUrl.includes('requests')) {
    await page.goto('https://www.messenger.com/requests/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  return true;
}

/**
 * Extracts all message bubbles currently rendered in the active chat view.
 * Strictly differentiates between incoming and outgoing messages.
 */
export async function extractActiveThreadMessages(page: Page): Promise<ThreadMessage[]> {
  const messages: ThreadMessage[] = [];

  // Query all message rows in sequence
  const rows = await page.$$('[role="row"], .message-row');
  const outgoingSelector = MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.outgoingMessageBubble);

  for (const row of rows) {
    // Ignore system separators or status notices (e.g. "Messages are end-to-end encrypted")
    const isSystemNotice = await row.evaluate((el) => {
      const role = el.getAttribute('role');
      const text = el.textContent || '';
      return (
        role === 'separator' ||
        el.classList.contains('system-message') ||
        text.includes('エンドツーエンド') ||
        text.includes('end-to-end encrypted') ||
        text.includes('メッセージリクエストを承認') ||
        text.includes('accepted the request')
      );
    });

    if (isSystemNotice) {
      continue;
    }

    const isOutgoing = await row.evaluate((el, sel) => {
      return el.matches(sel) || el.querySelector(sel) !== null;
    }, outgoingSelector);

    const textContent = (await row.innerText()).trim();
    if (textContent) {
      messages.push({
        direction: isOutgoing ? 'outgoing' : 'incoming',
        text: textContent,
      });
    }
  }

  return messages;
}

function MEN_SELECTOR_ARRAY(selectors: readonly string[]): string {
  return selectors.join(', ');
}

/**
 * Scans unread message requests in the sidebar, checks eligibility, and deduplicates via SQLite.
 */
export async function scanMessageRequests(
  page: Page,
  store: ThreadStore,
): Promise<ScannedThread[]> {
  assertNotPaused('Scanning Message Requests');

  if (await isLoginRequired(page)) {
    logEvent({
      event: 'LOGIN_REQUIRED',
      reason: 'Login form detected. Manual authentication required in data/browser-profile.',
    });
    return [];
  }

  const scanned: ScannedThread[] = [];
  const threadElements = await page.$$(MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.threadItem));

  for (let i = 0; i < threadElements.length; i++) {
    assertNotPaused(`Processing thread index ${i}`);
    const threadEl = threadElements[i];

    // Check for unread indicator
    const unreadEl = await threadEl.$(MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.unreadIndicator));
    if (!unreadEl) {
      continue; // Skip already read threads
    }

    // Extract thread identifier (id or accessible label)
    const rawId =
      (await threadEl.getAttribute('id')) ||
      (await threadEl.getAttribute('aria-label')) ||
      `thread-${i}`;

    const threadHash = computeHash(rawId);
    const senderIdHash = computeHash(`sender-${rawId}`);

    // Click to activate thread in the main panel
    await threadEl.click().catch(() => {});
    await page.waitForTimeout(300);

    // Extract chat history
    const messages = await extractActiveThreadMessages(page);
    const eligibility = evaluateThreadEligibility(messages);

    if (!eligibility.eligible || !eligibility.lastIncomingMessage) {
      continue;
    }

    const lastMessageHash = computeHash(eligibility.lastIncomingMessage);

    // Check duplication in SQLite
    if (store.isDuplicateMessage(threadHash, lastMessageHash)) {
      continue;
    }

    logEvent({
      event: 'THREAD_DETECTED',
      threadHash,
      details: {
        step: 'UNREAD_MESSAGE_DETECTED',
        messageCount: messages.length,
      },
    });

    logEvent({
      event: 'MESSAGE_RECEIVED',
      threadHash,
      details: {
        step: 'ELIGIBLE_FOR_CLASSIFICATION',
      },
    });

    scanned.push({
      threadId: rawId,
      threadHash,
      senderIdHash,
      lastMessageHash,
      lastIncomingText: eligibility.lastIncomingMessage,
      eligibility,
    });
  }

  return scanned;
}

/**
 * Finds the thread item matching expectedThreadId, activates it via click if not active,
 * and verifies that the thread is currently focused in the main pane before any message send.
 */
export async function selectAndVerifyActiveThread(
  page: Page,
  expectedThreadId: string,
): Promise<boolean> {
  const threadElements = await page.$$(MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.threadItem));

  for (const threadEl of threadElements) {
    const rawId =
      (await threadEl.getAttribute('id')) ||
      (await threadEl.getAttribute('aria-label')) ||
      '';

    if (rawId === expectedThreadId || (expectedThreadId && rawId.includes(expectedThreadId))) {
      // Check if it already has active class or aria-selected
      const isActive = await threadEl.evaluate((el) => {
        return (
          el.classList.contains('active') ||
          el.getAttribute('aria-selected') === 'true'
        );
      });

      if (!isActive) {
        await threadEl.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      return true;
    }
  }

  return false;
}
