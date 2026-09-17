import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  DRY_RUN: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true'),
  PAUSE_ALL: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
  LLM_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  BROWSER_USER_DATA_DIR: z.string().default('data/browser-profile'),
  HEADLESS: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
  MAX_REPLIES_PER_THREAD_PER_DAY: z
    .string()
    .default('20')
    .transform((val) => Number.parseInt(val, 10)),
  MIN_REPLY_INTERVAL_SECONDS: z
    .string()
    .default('15')
    .transform((val) => Number.parseInt(val, 10)),
  DATABASE_PATH: z.string().default('data/firewall.db'),
  PORT: z
    .string()
    .default('3000')
    .transform((val) => Number.parseInt(val, 10)),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    const parsed = ConfigSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid configuration: ${JSON.stringify(parsed.error.format())}`);
    }
    cachedConfig = parsed.data;
  }
  return cachedConfig;
}

export function resetConfigForTest(): void {
  cachedConfig = null;
}

const KILL_SWITCH_FILE = path.resolve(process.cwd(), 'data', '.killswitch');

export function isSystemPaused(): boolean {
  const config = getConfig();
  if (config.PAUSE_ALL) {
    return true;
  }
  return fs.existsSync(KILL_SWITCH_FILE);
}

export function setSystemPause(paused: boolean): void {
  const dataDir = path.dirname(KILL_SWITCH_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (paused) {
    fs.writeFileSync(KILL_SWITCH_FILE, JSON.stringify({ pausedAt: new Date().toISOString() }));
  } else if (fs.existsSync(KILL_SWITCH_FILE)) {
    fs.unlinkSync(KILL_SWITCH_FILE);
  }
}
