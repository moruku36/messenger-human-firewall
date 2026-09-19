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
  'JEV_SHADOW_EVALUATED',
  'JEV_ERROR',
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
    timeWasterState: z.string().optional(),
    // Jev Shadow Telemetry metrics
    jevCategory: z.string().optional(),
    jevAction: z.string().optional(),
    geminiCategory: z.string().optional(),
    geminiAction: z.string().optional(),
    categoryAgreement: z.boolean().optional(),
    actionAgreement: z.boolean().optional(),
    jevLatencyMs: z.number().optional(),
    jevConfidence: z.number().optional(),
    jevSuccess: z.boolean().optional(),
    jevReasonCode: z.string().optional(),
    triggeredSignals: z.string().optional(),
    primarySignal: z.string().optional(),
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
  reasonCode?: string;
  reason?: string; // Kept for interface compatibility; masked in logger to guarantee zero-dump
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

export type JevReasonCode =
  | 'JEV_SCAM_HIGH_CONFIDENCE'
  | 'JEV_CREDENTIAL_REQUEST'
  | 'JEV_MONEY_REQUEST'
  | 'JEV_THREAT'
  | 'JEV_PROMPT_INJECTION'
  | 'JEV_SUSPICIOUS_LINK'
  | 'JEV_MULTIPLE_HIGH_RISK_SIGNALS'
  | 'JEV_SPAM_HIGH_CONFIDENCE'
  | 'JEV_SALES_PROBING'
  | 'JEV_NORMAL_CONVERSATION'
  | 'JEV_LOW_CONFIDENCE'
  | 'JEV_TIMEOUT'
  | 'JEV_API_ERROR'
  | 'JEV_SCHEMA_ERROR';

export interface JevSignals {
  category: Category;
  categoryConfidence: number;
  categoryProbabilities?: Record<string, number>;
  credentialRequest: number; // 0.0 - 1.0 probability
  moneyRequest: number; // 0.0 - 1.0 probability
  threatOrUrgency: number; // 0.0 - 1.0 probability
  promptInjection: number; // 0.0 - 1.0 probability
  suspiciousExternalLink: number; // 0.0 - 1.0 probability
  overallRisk: number; // 0 to 4 (scale index)
  overallRiskScoreValue?: number; // expectation value
}

export interface JevDecision {
  action: Action;
  category: Category;
  risk: number; // 0-100 normalized risk score
  reasonCode: JevReasonCode;
  reason: string;
  signals?: JevSignals;
  latencyMs?: number;
  success: boolean;
  triggeredSignals?: string[];
  primarySignal?: string;
}

export interface JevComparisonResult {
  threadHash: string;
  timestamp: string;
  geminiCategory: Category;
  jevCategory: Category;
  geminiAction: Action;
  jevAction: Action;
  categoryAgreement: boolean;
  actionAgreement: boolean;
  jevConfidence: number;
  jevRiskProbabilities?: {
    credentialRequest: number;
    moneyRequest: number;
    threatOrUrgency: number;
    promptInjection: number;
    suspiciousExternalLink: number;
  };
  jevLatencyMs: number;
  jevSuccess: boolean;
  jevReasonCode: JevReasonCode;
  triggeredSignals?: string[];
  primarySignal?: string;
}
