import type { Page } from 'playwright';
import {
  assertNotPaused,
  computeHash,
  getConfig,
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
  /** Thread id taken from the conversation URL (`/t/<id>`), e.g. "1234567890". */
  threadId: string;
  threadHash: string;
  senderIdHash: string;
  lastMessageHash: string;
  lastIncomingText: string;
  eligibility: ThreadEligibilityResult;
  /** Opened from Message Requests (`/requests/...`): no composer, cannot be replied to. */
  isRequest: boolean;
}

/** Tabs of the Message Requests page (UI language: ja / en). */
const REQUEST_TABS = [
  { name: 'MAYBE_KNOWN', label: /知り合いかも|People you may know|You may know/i, optional: false },
  { name: 'SPAM', label: /スパム|Spam/i, optional: true },
] as const;

/**
 * Activates a Message Requests tab (role=tab whose text matches). Returns false if the tab does
 * not exist. Already-selected tabs are left alone.
 */
async function activateRequestsTab(page: Page, label: RegExp): Promise<boolean> {
  const tab = page.locator('[role="tab"]').filter({ hasText: label }).first();
  if ((await tab.count()) === 0) return false;
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click().catch(() => {});
    // The list is re-rendered client-side after switching tabs.
    await page.waitForTimeout(process.env.NODE_ENV === 'test' ? 150 : 1200);
  }
  return true;
}

function joinSelectors(selectors: readonly string[]): string {
  return selectors.join(', ');
}

/**
 * Alignment = (leftGap - rightGap) / width of the bubble inside the conversation.
 * Incoming bubbles hug the left edge (negative), outgoing ones the right edge (positive),
 * and centred notices are symmetric (~0). Using gaps instead of the bubble centre keeps wide
 * bubbles classifiable. Anything within +/- ALIGN_THRESHOLD is ambiguous.
 */
const ALIGN_THRESHOLD = 0.06;

const SYSTEM_NOTICE_MARKERS = [
  'エンドツーエンド',
  'end-to-end encrypted',
  'メッセージリクエストを承認',
  'accepted the request',
];

/** Scan diagnostics: reason codes and numbers only, never message text or names. */
function scanLog(threadHash: string | null, msg: string): void {
  const who = threadHash ? ` thread=${threadHash.slice(0, 8)}` : '';
  console.log(`[scan]${who} ${msg}`);
}

/**
 * Extracts the stable thread id from a conversation link href.
 * `/t/123` and `/e2ee/t/123` both yield "123". The sender's name (aria-label) is never used.
 */
export function threadIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  let pathname: string;
  try {
    pathname = new URL(href, 'https://www.messenger.com').pathname;
  } catch {
    return null;
  }
  const match = /(?:^|\/)t\/([^/?#]+)/.exec(pathname);
  return match ? match[1] : null;
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
    // The list is rendered client-side; give it a moment before scanning.
    await page.waitForSelector(joinSelectors(MESSENGER_SELECTORS.threadItem), { timeout: 8000 }).catch(() => {});
  }

  return true;
}

/**
 * Extracts message rows from the active conversation.
 *
 * The real DOM marks neither direction nor sender on message rows, so direction is derived
 * from where the bubble sits horizontally inside the conversation grid (incoming = left,
 * outgoing = right). Rows that sit in the middle (date separators, system notices) are
 * reported as 'unknown', and the eligibility validator refuses to reply if the LAST row is
 * unknown, so a misjudged direction can never cause a reply.
 *
 * Two DOM shapes exist (both verified on the real site):
 * - Regular chats: a `[role="grid"]` (that does NOT contain thread-list links) with one
 *   `[role="row"]` per message.
 * - Message requests (`/requests/t/<id>`): no grid; the conversation is a `[role="log"]` with
 *   one `[role="article"]` per message. Only visible text (non-zero size) is used, since the
 *   articles also contain zero-width hidden nodes. Header/info blocks and the 承認/削除
 *   controls live outside the articles.
 */
export async function extractActiveThreadMessages(page: Page): Promise<ThreadMessage[]> {
  const raw = await page.evaluate(
    ({ threadSel, outgoingSel }) => {
      const grids = Array.from(document.querySelectorAll('[role="grid"]')).filter(
        (g) => !g.querySelector(threadSel),
      );
      grids.sort(
        (a, b) => b.querySelectorAll('[role="row"]').length - a.querySelectorAll('[role="row"]').length,
      );

      // Regular chat: one row per message inside the conversation grid.
      if (grids.length > 0 && grids[0].querySelector('[role="row"]')) {
        const grid = grids[0];
        const gridRect = grid.getBoundingClientRect();
        return Array.from(grid.querySelectorAll('[role="row"]')).map((row) => {
          const text = ((row as HTMLElement).innerText || '').trim();
          const bubble = row.querySelector('[dir="auto"]');
          let align: number | null = null;
          if (bubble && gridRect.width > 0) {
            const r = bubble.getBoundingClientRect();
            align = (r.left - gridRect.left - (gridRect.right - r.right)) / gridRect.width;
          }
          const explicitOutgoing = row.matches(outgoingSel) || row.querySelector(outgoingSel) !== null;
          return { text, align, explicitOutgoing, assumeIncoming: false };
        });
      }

      // Message request: one article per message inside the log region.
      const log = document.querySelector('[role="main"] [role="log"]');
      if (!log) return [];
      const logRect = log.getBoundingClientRect();
      return Array.from(log.querySelectorAll('[role="article"]')).map((article) => {
        const leaves = Array.from(article.querySelectorAll('[dir="auto"]')).filter((el) => {
          if (el.querySelector('[dir="auto"]')) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const text = leaves
          .map((el) => ((el as HTMLElement).innerText || '').trim())
          .filter((t) => t.length > 0)
          .join('\n');
        let align: number | null = null;
        if (leaves.length > 0 && logRect.width > 0) {
          const r = leaves[0].getBoundingClientRect();
          align = (r.left - logRect.left - (logRect.right - r.right)) / logRect.width;
        }
        const explicitOutgoing = article.matches(outgoingSel) || article.querySelector(outgoingSel) !== null;
        // A message request only ever contains the requester's messages (once you reply the
        // request is accepted and moves to the inbox), so everything here is incoming.
        const assumeIncoming = location.pathname.startsWith('/requests/');
        return { text, align, explicitOutgoing, assumeIncoming };
      });
    },
    {
      threadSel: joinSelectors(MESSENGER_SELECTORS.threadItem),
      outgoingSel: joinSelectors(MESSENGER_SELECTORS.outgoingMessageBubble),
    },
  );

  const messages: ThreadMessage[] = [];
  for (const row of raw) {
    if (!row.text) continue;
    if (SYSTEM_NOTICE_MARKERS.some((m) => row.text.includes(m))) continue;

    let direction: ThreadMessage['direction'] = 'unknown';
    if (row.explicitOutgoing) {
      direction = 'outgoing';
    } else if (row.assumeIncoming) {
      direction = 'incoming';
    } else if (row.align !== null) {
      if (row.align < -ALIGN_THRESHOLD) direction = 'incoming';
      else if (row.align > ALIGN_THRESHOLD) direction = 'outgoing';
    }
    messages.push({ direction, text: row.text, align: row.align ?? undefined });
  }

  return messages;
}

interface ThreadLinkInfo {
  threadId: string;
  current: boolean;
  unread: boolean;
}

/** Reads all conversation links currently in the list (id, active state, unread marker). */
async function readThreadLinks(page: Page): Promise<ThreadLinkInfo[]> {
  const rows = await page.$$eval(
    joinSelectors(MESSENGER_SELECTORS.threadItem),
    (els, unreadSel) => {
      // Fallback: a small, round, filled element inside a role=button within the row link
      // (the blue unread dot). Presence dots on avatars are not inside such a button.
      const hasDot = (root: Element): boolean =>
        Array.from(root.querySelectorAll('[role="button"] span')).some((s) => {
          const b = s.getBoundingClientRect();
          const cs = getComputedStyle(s);
          return (
            b.width > 0 &&
            b.width <= 16 &&
            Math.abs(b.width - b.height) < 1 &&
            parseFloat(cs.borderTopLeftRadius) >= b.width / 2 - 1 &&
            cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
          );
        });
      return els.map((el) => {
        const row = el.closest('[role="row"]');
        const current = el.getAttribute('aria-current');
        return {
          href: el.getAttribute('href'),
          current: current !== null && current !== '' && current !== 'false',
          unread:
            el.querySelector(unreadSel) !== null ||
            (row !== null && row.querySelector(unreadSel) !== null) ||
            hasDot(el),
        };
      });
    },
    joinSelectors(MESSENGER_SELECTORS.unreadIndicator),
  );

  const seen = new Set<string>();
  const links: ThreadLinkInfo[] = [];
  for (const r of rows) {
    const threadId = threadIdFromHref(r.href);
    if (!threadId || seen.has(threadId)) continue;
    seen.add(threadId);
    links.push({ threadId, current: r.current, unread: r.unread });
  }
  return links;
}

/**
 * The list loads progressively (row count differs between reads right after a tab switch), so
 * wait until the number of conversation rows stops changing before reading it.
 */
async function waitForListToSettle(page: Page): Promise<void> {
  const test = process.env.NODE_ENV === 'test';
  const interval = test ? 50 : 400;
  const maxPolls = test ? 8 : 16;
  const needStable = test ? 2 : 3;
  let last = -1;
  let stable = 0;
  for (let i = 0; i < maxPolls; i++) {
    const count = await page.locator(joinSelectors(MESSENGER_SELECTORS.threadItem)).count();
    stable = count === last ? stable + 1 : 0;
    if (stable >= needStable && count > 0) return;
    last = count;
    await page.waitForTimeout(interval);
  }
}

/** True only if the given thread is the single active (aria-current) conversation in the list. */
async function isOnlyActiveThread(page: Page, threadId: string): Promise<boolean> {
  const links = await readThreadLinks(page);
  const active = links.filter((l) => l.current);
  return active.length === 1 && active[0].threadId === threadId;
}

/**
 * Scrolls the (virtualised) conversation list: to the top, or one page down.
 * Returns false when there is no scrollable list or it cannot move any further.
 */
async function scrollThreadList(page: Page, mode: 'top' | 'down'): Promise<boolean> {
  return page.evaluate(
    ({ threadSel, mode: m }) => {
      let el: HTMLElement | null = document.querySelector(threadSel);
      while (el) {
        el = el.parentElement;
        if (!el) break;
        const overflowY = getComputedStyle(el).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) break;
      }
      if (!el) return false;
      const before = el.scrollTop;
      if (m === 'top') el.scrollTop = 0;
      else el.scrollTop = before + Math.max(el.clientHeight * 0.8, 50);
      return el.scrollTop !== before;
    },
    { threadSel: joinSelectors(MESSENGER_SELECTORS.threadItem), mode },
  );
}

/**
 * Clicks the link for `threadId`. The conversation list is virtualised (rows outside the
 * viewport are not in the DOM), so if the link is missing the list is scrolled to look for it.
 * Returns false if no such link can be found.
 */
async function clickThreadLink(page: Page, threadId: string): Promise<boolean> {
  // Thread ids come from a URL; only plain ids are ever put into a selector.
  if (!/^[\w-]+$/.test(threadId)) return false;
  const base = '[role="row"] a[role="link"]';
  const link = page
    .locator(`${base}[href*="/t/${threadId}/"], ${base}[href$="/t/${threadId}"], ${base}[href*="/t/${threadId}?"]`)
    .first();
  const settle = process.env.NODE_ENV === 'test' ? 60 : 400;
  for (let step = 0; step < 60; step++) {
    if ((await link.count()) > 0) {
      // A locator re-resolves the element, so a re-render while scrolling it into view is fine.
      await link.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
    // Not rendered: rewind to the top first, then page down until the end of the list.
    const moved = await scrollThreadList(page, step === 0 ? 'top' : 'down');
    if (step > 0 && !moved) break;
    await page.waitForTimeout(settle);
  }
  return false;
}

/** Waits until `threadId` is the single active conversation. */
async function waitUntilActive(page: Page, threadId: string, attempts = 20): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isOnlyActiveThread(page, threadId)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/**
 * Scans the Message Requests tabs ("知り合いかも", and "スパム" unless SCAN_SPAM_TAB=false),
 * checks eligibility, and deduplicates via SQLite.
 * Only threads with an unread marker are processed unless SCAN_INCLUDE_READ_THREADS=true.
 */
export async function scanMessageRequests(
  page: Page,
  store: ThreadStore,
): Promise<ScannedThread[]> {
  assertNotPaused('Scanning Message Requests');
  const config = getConfig();

  if (await isLoginRequired(page)) {
    logEvent({
      event: 'LOGIN_REQUIRED',
      reason: 'Login form detected. Manual authentication required in data/browser-profile.',
    });
    return [];
  }

  const scanned: ScannedThread[] = [];
  const seen = new Set<string>();
  for (const tab of REQUEST_TABS) {
    if (tab.optional && !config.SCAN_SPAM_TAB) continue;
    const found = await activateRequestsTab(page, tab.label);
    // The primary tab is scanned even if it cannot be found (already the visible list).
    if (!found && tab.optional) {
      scanLog(null, `tab=${tab.name} not found, skipped`);
      continue;
    }
    scanLog(null, `tab=${tab.name}`);
    scanned.push(...(await scanCurrentList(page, store, seen)));
  }
  return scanned;
}

/** Scans the conversation list that is currently displayed. */
async function scanCurrentList(
  page: Page,
  store: ThreadStore,
  seen: Set<string>,
): Promise<ScannedThread[]> {
  const config = getConfig();
  const scanned: ScannedThread[] = [];
  // Collect ids first: element handles go stale as the SPA re-renders after each click.
  // Newest conversations are at the top of the list: start there.
  await scrollThreadList(page, 'top');
  await waitForListToSettle(page);
  const allLinks = (await readThreadLinks(page)).filter((l) => !seen.has(l.threadId));
  allLinks.forEach((l) => seen.add(l.threadId));
  const candidates = allLinks.filter((l) => l.unread || config.SCAN_INCLUDE_READ_THREADS);
  scanLog(
    null,
    `links=${allLinks.length} unread=${allLinks.filter((l) => l.unread).length} candidates=${candidates.length}`,
  );

  for (const candidate of candidates) {
    assertNotPaused(`Processing thread ${computeHash(candidate.threadId).slice(0, 8)}`);
    const { threadId } = candidate;

    const threadHash = computeHash(threadId);
    const senderIdHash = computeHash(`sender-${threadId}`);

    // Open the thread and make sure it (and only it) is the active conversation before reading.
    if (!(await clickThreadLink(page, threadId))) {
      scanLog(threadHash, 'skip=CLICK_TARGET_NOT_FOUND');
      continue;
    }
    if (!(await waitUntilActive(page, threadId))) {
      const current = (await readThreadLinks(page)).filter((l) => l.current).length;
      scanLog(threadHash, `skip=NOT_SINGLE_ACTIVE (aria-current links=${current})`);
      continue;
    }
    await page.waitForTimeout(process.env.NODE_ENV === 'test' ? 100 : 800);

    const messages = await extractActiveThreadMessages(page);

    // The page must not have switched conversations while we were reading.
    if (!(await isOnlyActiveThread(page, threadId))) {
      scanLog(threadHash, 'skip=ACTIVE_THREAD_CHANGED');
      continue;
    }

    const eligibility = evaluateThreadEligibility(messages);
    if (!eligibility.eligible || !eligibility.lastIncomingMessage) {
      const tail = messages
        .slice(-4)
        .map((m) => `${m.direction}@${m.align === undefined ? '?' : m.align.toFixed(2)}`)
        .join(',');
      scanLog(
        threadHash,
        `skip=INELIGIBLE rows=${messages.length} reason=${(eligibility.reason ?? '').split(':')[0]} last=[${tail}]`,
      );
      continue;
    }

    const lastMessageHash = computeHash(eligibility.lastIncomingMessage);

    // Check duplication in SQLite
    if (store.isDuplicateMessage(threadHash, lastMessageHash)) {
      scanLog(threadHash, 'skip=DUPLICATE_ALREADY_PROCESSED');
      continue;
    }

    logEvent({
      event: 'THREAD_DETECTED',
      threadHash,
      details: {
        step: candidate.unread ? 'UNREAD_MESSAGE_DETECTED' : 'READ_THREAD_INCLUDED',
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
      threadId,
      threadHash,
      senderIdHash,
      lastMessageHash,
      lastIncomingText: eligibility.lastIncomingMessage,
      eligibility,
      isRequest: new URL(page.url(), 'https://www.messenger.com').pathname.startsWith('/requests/'),
    });
  }

  return scanned;
}

/**
 * Activates the conversation for `expectedThreadId` (exact id match) and verifies that it is
 * the single active conversation (`aria-current`) before any message send.
 */
export async function selectAndVerifyActiveThread(
  page: Page,
  expectedThreadId: string,
): Promise<boolean> {
  const links = await readThreadLinks(page);
  const target = links.find((l) => l.threadId === expectedThreadId);

  if (!target?.current) {
    // Also covers a row that is currently outside the virtualised viewport.
    if (!(await clickThreadLink(page, expectedThreadId))) {
      return false;
    }
  }

  // Re-verify against the live DOM: exactly one active conversation, and it is the target.
  return waitUntilActive(page, expectedThreadId, 12);
}
