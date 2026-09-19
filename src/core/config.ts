import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const BooleanStringSchema = z
  .enum(['true', 'false'], {
    errorMap: () => ({ message: 'Expected strictly "true" or "false"' }),
  })
  .transform((val) => val === 'true');

const PositiveIntSchema = (min: number, max: number, defaultVal: string) =>
  z
    .string()
    .default(defaultVal)
    .refine((val) => /^\d+$/.test(val), { message: 'Must be an unsigned integer' })
    .transform((val) => Number.parseInt(val, 10))
    .pipe(
      z
        .number()
        .int()
        .min(min, { message: `Value must be at least ${min}` })
        .max(max, { message: `Value must be at most ${max}` }),
    );

const ProbabilitySchema = (defaultVal: string) =>
  z
    .string()
    .default(defaultVal)
    .refine((val) => !isNaN(Number(val)), { message: 'Must be a valid number' })
    .transform((val) => Number.parseFloat(val))
    .pipe(
      z
        .number()
        .min(0, { message: 'Value must be at least 0' })
        .max(1, { message: 'Value must be at most 1' }),
    );

export const ConfigSchema = z.object({
  DRY_RUN: BooleanStringSchema.default('true'),
  PAUSE_ALL: BooleanStringSchema.default('false'),
  LLM_PROVIDER: z.literal('gemini').default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  // TypeSafe Jev Configuration
  JEV_ENABLED: BooleanStringSchema.default('false'),
  JEV_SHADOW_MODE: BooleanStringSchema.default('true'),
  TYPESAFE_API_KEY: z.string().optional(),
  JEV_MODEL: z.string().default('jev-latest'),
  JEV_TIMEOUT_MS: PositiveIntSchema(100, 60000, '5000'),
  JEV_HIGH_RISK_THRESHOLD: ProbabilitySchema('0.85'),
  JEV_MIN_CONFIDENCE: ProbabilitySchema('0.80'),
  BROWSER_USER_DATA_DIR: z.string().default('data/browser-profile'),
  HEADLESS: BooleanStringSchema.default('false'),
  MAX_REPLIES_PER_THREAD_PER_DAY: PositiveIntSchema(1, 100, '20'),
  MAX_LLM_REQUESTS_PER_DAY: PositiveIntSchema(1, 10000, '100'),
  MIN_REPLY_INTERVAL_SECONDS: PositiveIntSchema(1, 300, '15'),
  ALLOWED_TEST_THREAD_ID: z.string().optional(),
  CONTROLLED_MAX_REPLIES: PositiveIntSchema(1, 20, '3'),
  DATABASE_PATH: z.string().default('data/firewall.db'),
  PORT: PositiveIntSchema(1024, 65535, '3000'),
  WATCH_POLL_INTERVAL_SECONDS: PositiveIntSchema(10, 3600, '60'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${JSON.stringify(result.error.format())}`);
  }
  return result.data;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = parseConfig(process.env);
  }
  return cachedConfig;
}

export function resetConfigForTest(): void {
  cachedConfig = null;
}
