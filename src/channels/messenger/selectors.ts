/**
 * Centralized, strict DOM Selectors for Facebook Messenger.
 * Avoid generic positional/wide selectors (e.g. role="row", role="gridcell").
 * Strongly separates incoming vs outgoing messages.
 */
export const MESSENGER_SELECTORS = {
  // Navigation & Tabs
  messageRequestsTab: [
    'a[aria-label="Message requests" i]',
    'a[aria-label="メッセージリクエスト" i]',
    '[role="tab"][aria-label="Message requests" i]',
    '[role="tab"][aria-label="メッセージリクエスト" i]',
  ],

  // Specific thread container in the Message Requests list
  threadItem: [
    'div[data-testid="messenger-chat-list-item"]',
    'div[role="listitem"][aria-label*="とのチャット" i]',
    'div[role="listitem"][aria-label*="Conversation with" i]',
  ],

  // Strict Unread badge (excludes broad media tags)
  unreadIndicator: [
    'span[aria-label*="未読" i]',
    'span[aria-label*="unread" i]',
    'div[aria-label*="未読" i]',
    'div[aria-label*="unread" i]',
  ],

  // STRICT SEPARATION: Incoming message from stranger
  incomingMessageBubble: [
    'div[data-testid="incoming_message"]',
    'div[role="row"]:not([aria-label*="あなたが送信" i]):not([aria-label*="You sent" i]) div[dir="auto"]',
  ],

  // STRICT SEPARATION: Outgoing message sent by self / bot
  outgoingMessageBubble: [
    'div[data-testid="outgoing_message"]',
    'div[aria-label*="You sent" i]',
    'div[aria-label*="あなたが送信" i]',
    'div[aria-label*="送信済み" i]',
  ],

  // Text input box inside active thread
  messageInput: [
    'div[role="textbox"][contenteditable="true"][aria-label*="メッセージ" i]',
    'div[role="textbox"][contenteditable="true"][aria-label*="Message" i]',
  ],

  // Send button
  sendButton: [
    'div[role="button"][aria-label="Press enter to send" i]',
    'div[role="button"][aria-label="送信" i]',
    'button[aria-label="Press enter to send" i]',
    'button[aria-label="送信" i]',
    'div[data-testid="send_button"]',
  ],

  // Login form indicator
  loginForm: [
    'input[name="email"]',
    'input[id="email"]',
    'button[name="login"]',
    '#loginbutton',
  ],
} as const;
