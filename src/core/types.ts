import { z } from 'zod';

export const CategorySchema = z.enum([
  'NORMAL',
  'SALES',
  'SPAM',
  'SCAM',
  'HARASSMENT',
  'UNKNOWN',
]);
export type Category = z.infer<typeof CategorySchema>;

export const ActionSchema = z.enum([
  'POLITE_REPLY',
  'TIME_WASTER',
  'IGNORE',
  'HUMAN_REQUIRED',
  'BLOCK_RECOMMENDED',
]);
export type Action = z.infer<typeof ActionSchema>;

const BaseClassificationSchema = z.object({
  category: CategorySchema,
  risk: z.number().min(0).max(100),
  reason: z.string().min(1),
});

export const PoliteReplySchema = BaseClassificationSchema.extend({
  action: z.literal('POLITE_REPLY'),
  reply: z.string().min(1, 'Reply must be provided for POLITE_REPLY'),
});

export const TimeWasterSchema = BaseClassificationSchema.extend({
  action: z.literal('TIME_WASTER'),
  reply: z.string().min(1, 'Reply must be provided for TIME_WASTER'),
});

export const IgnoreSchema = BaseClassificationSchema.extend({
  action: z.literal('IGNORE'),
  reply: z.undefined().optional(),
});

export const HumanRequiredSchema = BaseClassificationSchema.extend({
  action: z.literal('HUMAN_REQUIRED'),
  reply: z.string().nullable().optional().transform((v) => v ?? undefined),
});

export const BlockRecommendedSchema = BaseClassificationSchema.extend({
  action: z.literal('BLOCK_RECOMMENDED'),
  reply: z.string().nullable().optional().transform((v) => v ?? undefined),
});

export const ClassificationResultSchema = z.discriminatedUnion('action', [
  PoliteReplySchema,
  TimeWasterSchema,
  IgnoreSchema,
  HumanRequiredSchema,
  BlockRecommendedSchema,
]);
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

export const ObservabilityEventTypeSchema = z.enum([
  'THREAD_DETECTED',
  'MESSAGE_RECEIVED',
  'CLASSIFIED',
  'REPLY_GENERATED',
  'REPLY_BLOCKED',
  'REPLY_SENT',
  'RATE_LIMITED',
  'HUMAN_REQUIRED',
  'LOGIN_REQUIRED',
  'ERROR',
]);
export type ObservabilityEventType = z.infer<typeof ObservabilityEventTypeSchema>;

/**
 * Whitelist schema for observability log metadata.
 * Raw message text or unvetted blobs are explicitly forbidden.
 */
export const SafeLogDetailsSchema = z
  .object({
    ruleTriggered: z.string().optional(),
    blockReason: z.string().optional(),
    executionTimeMs: z.number().optional(),
    replyLength: z.number().optional(),
    messageCount: z.number().optional(),
    step: z.string().optional(),
    statusMessage: z.string().optional(),
  })
  .strict();
export type SafeLogDetails = z.infer<typeof SafeLogDetailsSchema>;

export interface ObservabilityLog {
  timestamp: string;
  event: ObservabilityEventType;
  threadHash?: string;
  category?: Category;
  action?: Action;
  risk?: number;
  reason?: string;
  details?: SafeLogDetails;
}

export interface ThreadState {
  threadId: string;
  senderIdHash: string;
  firstSeen: number;
  lastSeen: number;
  lastMessageHash: string;
  mode: Action;
  messageCount: number;
  replyCount?: number;
  riskScore: number;
  paused: boolean;
  humanRequired: boolean;
}
