/**
 * Centralized DOM selectors for Facebook Messenger (messenger.com).
 *
 * Verified against the real messenger.com DOM (Sept 2026):
 * - Class names are obfuscated and there are NO `data-testid` attributes, so only
 *   stable attributes (`role`, `href`, `contenteditable`, `aria-current`) are used.
 * - Every conversation in a list row is `<a role="link" href=".../t/<id>/">`:
 *   `/requests/t/<id>/` on the Message Requests page, `/t/<id>` or `/e2ee/t/<id>` in the inbox.
 *   The active one carries `aria-current="page"`.
 * - The sidebar "chat" nav link is `<a href="/t/">` (no id, not inside a list row); it is
 *   excluded because it has no id and is not in a `[role="row"]`.
 * - Message requests have NO composer (textboxes = 0); the thread shows 承認 / 削除 buttons.
 *   Replying requires accepting the request, which this tool never does.
 * - The composer is a Lexical editor: `div[role="textbox"][contenteditable="true"]` whose
 *   aria-label is "<name>に書く" (not a fixed string), so it must not be matched by label.
 *
 * - Unread rows contain a `div[role="button"]` (the "mark as read" toggle) inside the row link,
 *   whose child is a small round blue `span` (the dot). Its label is 既読にする / Mark as read.
 *   Presence avatars (green online dots) are NOT inside such a button.
 *
 * Not yet verified against the real DOM:
 * - `sendButton` (Enter is used as fallback; never match `*="送信"` loosely, since
 *   "「いいね！」を送信" / "音声クリップを送信" buttons would be hit).
 */
export const MESSENGER_SELECTORS = {
  // Navigation & Tabs
  messageRequestsTab: [
    'a[aria-label="Message requests" i]',
    'a[aria-label="メッセージリクエスト" i]',
    '[role="tab"][aria-label="Message requests" i]',
    '[role="tab"][aria-label="メッセージリクエスト" i]',
  ],

  // Conversation list entries. The thread id is taken from the href, never from aria-label
  // (which contains the sender's name).
  threadItem: ['[role="row"] a[role="link"][href*="/t/"]'],

  // Unread marker inside a list row: the "mark as read" toggle button.
  // (A geometric fallback for the blue dot lives in watcher.ts.)
  unreadIndicator: [
    '[role="button"][aria-label*="既読にする"]',
    '[role="button"][aria-label*="Mark as read" i]',
  ],

  // Legacy explicit outgoing markers. The real DOM has none of these on message rows,
  // so direction is normally derived from horizontal position (see watcher.ts).
  outgoingMessageBubble: [
    'div[aria-label*="You sent" i]',
    'div[aria-label*="あなたが送信" i]',
    'div[aria-label*="送信済み" i]',
  ],

  // Text input box inside the active thread (Lexical editor).
  messageInput: ['div[role="textbox"][contenteditable="true"]'],

  // Send button (exact labels only). The composer falls back to Enter when absent.
  sendButton: [
    'div[role="button"][aria-label="Press enter to send" i]',
    'div[role="button"][aria-label="送信" i]',
    'button[aria-label="Press enter to send" i]',
    'button[aria-label="送信" i]',
  ],

  // Login form indicator
  loginForm: [
    'input[name="email"]',
    'input[id="email"]',
    'button[name="login"]',
    '#loginbutton',
  ],
} as const;
