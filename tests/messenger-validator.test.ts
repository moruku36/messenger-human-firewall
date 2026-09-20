import { describe, expect, it } from 'vitest';
import {
  evaluateThreadEligibility,
  type ThreadMessage,
} from '../src/channels/messenger/validator.js';

describe('Messenger Thread Eligibility Validator', () => {
  it('permits response only when the last message is incoming from the stranger', () => {
    const messages: ThreadMessage[] = [
      { direction: 'incoming', text: 'Hello!' },
      { direction: 'outgoing', text: 'Hi, how can I help?' },
      { direction: 'incoming', text: 'Are you available for an investment project?' },
    ];

    const result = evaluateThreadEligibility(messages);
    expect(result.eligible).toBe(true);
    expect(result.lastIncomingMessage).toBe('Are you available for an investment project?');
  });

  it('strictly blocks reply when the last message was outgoing (self/bot)', () => {
    const messages: ThreadMessage[] = [
      { direction: 'incoming', text: 'Hello!' },
      { direction: 'outgoing', text: 'Hi, how can I help?' },
    ];

    const result = evaluateThreadEligibility(messages);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('SELF_REPLIED');
  });

  it('fails safe when the direction of the last message is unknown', () => {
    const messages: ThreadMessage[] = [
      { direction: 'incoming', text: 'Hello!' },
      { direction: 'unknown', text: '不在着信' },
    ];

    const result = evaluateThreadEligibility(messages);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('AMBIGUOUS_DIRECTION');
  });

  it('rejects empty threads or messages without text', () => {
    expect(evaluateThreadEligibility([]).eligible).toBe(false);

    const emptyTextThread: ThreadMessage[] = [
      { direction: 'incoming', text: '   ' },
    ];
    expect(evaluateThreadEligibility(emptyTextThread).eligible).toBe(false);
  });
});
