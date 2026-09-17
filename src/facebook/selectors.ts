/**
 * Centralized Facebook Messenger DOM Selectors.
 * Prioritize accessible names, aria-labels, roles, and stable test ids.
 * Never use fragile positional nth-child paths.
 */
export const MESSENGER_SELECTORS = {
  // Navigation & Sections
  messageRequestsTab: [
    'a[aria-label="Message requests"]',
    'a[aria-label="メッセージリクエスト"]',
    '[role="tab"][aria-label*="request" i]',
    '[role="tab"][aria-label*="リクエスト"]',
  ],

  // Conversation list items
  threadItem: [
    '[role="row"]',
    '[role="listitem"]',
    '[data-testid="messenger-chat-list-item"]',
  ],

  // Unread badge or indicator
  unreadIndicator: [
    '[aria-label*="unread" i]',
    '[aria-label*="未読"]',
    '[data-visualcompletion="ignore-dynamic-media"]',
  ],

  // Message bubbles inside active thread
  messageBubble: [
    '[role="gridcell"]',
    '[data-testid="outgoing_message"]',
    '[data-testid="incoming_message"]',
  ],

  // Message text input area
  messageInput: [
    '[role="textbox"][aria-label*="Message" i]',
    '[role="textbox"][aria-label*="メッセージ" i]',
    'div[contenteditable="true"][role="textbox"]',
  ],

  // Send button
  sendButton: [
    '[aria-label="Press enter to send" i]',
    '[aria-label="送信" i]',
    '[data-testid="send_button"]',
  ],

  // Login detection indicators
  loginForm: [
    'input[name="email"]',
    'input[id="email"]',
    '#loginbutton',
  ],
} as const;
