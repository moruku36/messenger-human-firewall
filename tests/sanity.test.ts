import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNotPaused,
  FirewallPausedError,
  getConfig,
  isSystemPaused,
  parseConfig,
  resetConfigForTest,
  setSystemPause,
} from '../src/core/index.js';
import {
  ClassificationResultSchema,
  SafeLogDetailsSchema,
} from '../src/core/types.js';

describe('Core Configuration & Safety', () => {
  beforeEach(() => {
    resetConfigForTest();
    setSystemPause(false);
  });

  afterEach(() => {
    setSystemPause(false);
  });

  it('loads default configurations safely', () => {
    const config = getConfig();
    expect(config.DRY_RUN).toBe(true);
    expect(config.LLM_PROVIDER).toBe('gemini');
    expect(config.MAX_REPLIES_PER_THREAD_PER_DAY).toBe(20);
    expect(config.MIN_REPLY_INTERVAL_SECONDS).toBe(15);
  });

  it('rejects invalid range and malformed numbers in config', () => {
    // Negative number
    expect(() =>
      parseConfig({ MAX_REPLIES_PER_THREAD_PER_DAY: '-10' }),
    ).toThrow();

    // Out of bounds
    expect(() =>
      parseConfig({ MAX_REPLIES_PER_THREAD_PER_DAY: '99999' }),
    ).toThrow();

    // Malformed boolean
    expect(() => parseConfig({ DRY_RUN: 'yes' })).toThrow();
  });

  it('validates discriminated union for POLITE_REPLY requiring reply', () => {
    const valid = {
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 10,
      reason: 'Standard greeting',
      reply: 'こんにちは。どのようなご用件でしょうか？',
    };
    expect(ClassificationResultSchema.safeParse(valid).success).toBe(true);

    const missingReply = {
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 10,
      reason: 'Standard greeting',
    };
    expect(ClassificationResultSchema.safeParse(missingReply).success).toBe(false);
  });

  it('validates discriminated union for IGNORE rejecting reply', () => {
    const validIgnore = {
      category: 'SPAM',
      action: 'IGNORE',
      risk: 50,
      reason: 'Automated broadcast spam',
    };
    expect(ClassificationResultSchema.safeParse(validIgnore).success).toBe(true);

    const invalidIgnoreWithReply = {
      category: 'SPAM',
      action: 'IGNORE',
      risk: 50,
      reason: 'Automated broadcast spam',
      reply: 'Should not have reply',
    };
    expect(ClassificationResultSchema.safeParse(invalidIgnoreWithReply).success).toBe(false);
  });

  it('enforces assertNotPaused pre-action gate', () => {
    expect(() => assertNotPaused('Pre-send check')).not.toThrow();

    setSystemPause(true);
    expect(isSystemPaused()).toBe(true);
    expect(() => assertNotPaused('Pre-send check')).toThrow(FirewallPausedError);

    const killFile = path.resolve(process.cwd(), 'data', '.killswitch');
    expect(fs.existsSync(killFile)).toBe(true);

    setSystemPause(false);
    expect(() => assertNotPaused('Pre-send check')).not.toThrow();
  });

  it('whitelists log details and blocks arbitrary properties', () => {
    const validDetails = {
      ruleTriggered: 'EMAIL_DETECTED',
      executionTimeMs: 120,
      step: 'REPLY_GUARD',
    };
    expect(SafeLogDetailsSchema.safeParse(validDetails).success).toBe(true);

    const invalidDetailsWithChatText = {
      messageText: 'This is a private message body', // Not in whitelist
    };
    expect(SafeLogDetailsSchema.safeParse(invalidDetailsWithChatText).success).toBe(false);
  });
});
