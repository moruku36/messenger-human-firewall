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

export const ConfigSchema = z.object({
  DRY_RUN: BooleanStringSchema.default('true'),
  PAUSE_ALL: BooleanStringSchema.default('false'),
  LLM_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  BROWSER_USER_DATA_DIR: z.string().default('data/browser-profile'),
  HEADLESS: BooleanStringSchema.default('false'),
  MAX_REPLIES_PER_THREAD_PER_DAY: PositiveIntSchema(1, 100, '20'),
  MIN_REPLY_INTERVAL_SECONDS: PositiveIntSchema(5, 300, '15'),
  DATABASE_PATH: z.string().default('data/firewall.db'),
  PORT: PositiveIntSchema(1024, 65535, '3000'),
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
