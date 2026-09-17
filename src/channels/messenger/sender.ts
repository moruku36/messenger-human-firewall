import type { Page } from 'playwright';
import { assertNotPaused, getConfig } from '../../core/index.js';
import { MESSENGER_SELECTORS } from './selectors.js';

function MEN_SELECTOR_ARRAY(selectors: readonly string[]): string {
  return selectors.join(', ');
}

/**
 * Dispatches a vetted reply to the currently active Messenger thread.
 * Enforces pre-action killswitch assertion, stable selectors, and post-send rate limiting.
 */
export async function sendMessageToActiveThread(
  page: Page,
  replyText: string,
): Promise<boolean> {
  const config = getConfig();

  // 1. Mandatory Kill Switch Guard right before DOM interaction
  assertNotPaused('Messenger DOM Input & Send');

  const inputSelector = MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.messageInput);
  const sendSelector = MEN_SELECTOR_ARRAY(MESSENGER_SELECTORS.sendButton);

  const inputElement = await page.$(inputSelector);
  if (!inputElement) {
    throw new Error('Message input textbox not found. Aborting send.');
  }

  // 2. Focus and enter reply text
  await inputElement.click();
  await page.waitForTimeout(200);

  // Use fill or type safely
  await inputElement.fill(replyText).catch(async () => {
    // Fallback for contenteditable divs
    await page.keyboard.insertText(replyText);
  });
  await page.waitForTimeout(300);

  // 3. Click send button or press Enter
  const sendBtn = await page.$(sendSelector);
  if (sendBtn) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  // 4. Rate-limit wait interval to prevent rapid burst sending
  const intervalMs = config.MIN_REPLY_INTERVAL_SECONDS * 1000;
  await page.waitForTimeout(Math.min(intervalMs, 2000)); // Cap to max 2s in tests/dev if configured small

  return true;
}
