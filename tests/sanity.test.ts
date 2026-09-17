import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getConfig,
  isSystemPaused,
  resetConfigForTest,
  setSystemPause,
} from '../src/config/index.js';
import {
  ClassificationResultSchema,
} from '../src/types/index.js';

describe('Configuration & Types', () => {
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

  it('validates schema for ClassificationResult', () => {
    const valid = {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 85,
      reason: 'Suspicious crypto investment invitation',
      reply: 'なるほど。それは具体的にどういう仕組みなんですか？',
    };

    const parsed = ClassificationResultSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid action in ClassificationResult', () => {
    const invalid = {
      category: 'SCAM',
      action: 'INVALID_ACTION',
      risk: 85,
      reason: 'test',
    };

    const parsed = ClassificationResultSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('toggles kill switch correctly via helper', () => {
    expect(isSystemPaused()).toBe(false);

    setSystemPause(true);
    expect(isSystemPaused()).toBe(true);

    const killFile = path.resolve(process.cwd(), 'data', '.killswitch');
    expect(fs.existsSync(killFile)).toBe(true);

    setSystemPause(false);
    expect(isSystemPaused()).toBe(false);
    expect(fs.existsSync(killFile)).toBe(false);
  });
});
