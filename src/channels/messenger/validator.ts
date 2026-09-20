export interface ThreadMessage {
  /** 'unknown' = could not be attributed to either side (e.g. centered notices). */
  direction: 'incoming' | 'outgoing' | 'unknown';
  text: string;
  timestamp?: number;
  /** Horizontal alignment of the bubble: -1 = flush left, 0 = centred, +1 = flush right. Diagnostics only. */
  align?: number;
}

export interface ThreadEligibilityResult {
  eligible: boolean;
  reason?: string;
  lastIncomingMessage?: string;
}

/**
 * Validates thread messages to guarantee that automatic responses
 * are triggered ONLY if the most recent message in the thread was sent by the stranger.
 * Prevents bot ping-pong / self-reply loops at the architectural level.
 */
export function evaluateThreadEligibility(
  messages: ThreadMessage[],
): ThreadEligibilityResult {
  if (!messages || messages.length === 0) {
    return {
      eligible: false,
      reason: 'NO_MESSAGES: Thread has no visible messages.',
    };
  }

  const lastMessage = messages[messages.length - 1];

  if (lastMessage.direction === 'outgoing') {
    return {
      eligible: false,
      reason: 'SELF_REPLIED: Last message was sent by the owner/bot. Waiting for stranger.',
    };
  }

  if (lastMessage.direction === 'unknown') {
    return {
      eligible: false,
      reason: 'AMBIGUOUS_DIRECTION: Could not tell who sent the last message. Failing safe.',
    };
  }

  if (lastMessage.direction !== 'incoming' || !lastMessage.text.trim()) {
    return {
      eligible: false,
      reason: 'EMPTY_INCOMING: Last message has no actionable text.',
    };
  }

  return {
    eligible: true,
    lastIncomingMessage: lastMessage.text.trim(),
  };
}
