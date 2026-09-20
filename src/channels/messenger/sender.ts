import type { Page } from 'playwright';
import { assertNotPaused, getConfig } from '../../core/index.js';
import { MESSENGER_SELECTORS } from './selectors.js';
import { selectAndVerifyActiveThread } from './watcher.js';

function MEN_SELECTOR_ARRAY(selectors: readonly string[]): string {
  return selectors.join(', ');
}

let lastSentTimestamp = 0;

/**
 * Dispatches a vetted reply to the currently active Messenger thread.
 * Enforces pre-action killswitch assertion, thread verification, stable selectors, and rate limiting.
 */
export async function sendMessageToActiveThread(
  page: Page,
  replyText: string,
  expectedThreadId?: string,
): Promise<boolean> {
  const config = getConfig();

  // 1. Mandatory Kill Switch Guard right before DOM interaction
  assertNotPaused('Messenger DOM Input & Send');

  // 2. Thread verification: ensure active thread matches expectedThreadId if provided
  if (expectedThreadId) {
    const verified = await selectAndVerifyActiveThread(page, expectedThreadId);
    if (!verified) {
      throw new Error(`Active thread verification failed for expectedThreadId: ${expectedThreadId}`);
    }
  }

  // 3. Throttle if minimum interval has not elapsed since previous send
  const intervalMs = config.MIN_REPLY_INTERVAL_SECONDS * 1000;
  const now = Date.now();
  const elapsed = now - lastSentTimestamp;
  if (lastSentTimestamp > 0 && elapsed < intervalMs) {
    const waitMs = process.env.NODE_ENV === 'test' ? Math.min(intervalMs - elapsed, 200) : (intervalMs - elapsed);
    await page.waitForTimeout(waitMs);
  }

  const inputSelector = MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.messageInput);
  const sendSelector = MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.sendButton);

  const inputElement = await page.$(inputSelector);
  if (!inputElement) {
    throw new Error('Message input textbox not found. Aborting send.');
  }

  // 4. Focus and enter reply text.
  // The real composer is a Lexical editor: `fill()` does not reliably update its internal
  // state, so text is inserted through the keyboard (input event) after replacing any draft.
  await inputElement.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(replyText);
  await page.waitForTimeout(300);

  // Never press send unless the composer actually contains the vetted reply.
  const composed = ((await inputElement.innerText().catch(() => '')) || '').trim();
  if (composed !== replyText.trim()) {
    throw new Error('Composer content does not match the vetted reply. Aborting send.');
  }

  // 5. Click send button or press Enter
  const sendBtn = await page.$(sendSelector);
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  lastSentTimestamp = Date.now();

  // 6. Post-send small cool-down wait
  const postWaitMs = process.env.NODE_ENV === 'test' ? 100 : Math.min(intervalMs, 2000);
  await page.waitForTimeout(postWaitMs);

  return true;
}

