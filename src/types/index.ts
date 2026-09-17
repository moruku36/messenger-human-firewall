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

export const ClassificationResultSchema = z.object({
  category: CategorySchema,
  action: ActionSchema,
  risk: z.number().min(0).max(100),
  reason: z.string(),
  reply: z.string().optional(),
});
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

export interface ObservabilityLog {
  timestamp: string;
  event: ObservabilityEventType;
  threadHash?: string;
  category?: Category;
  action?: Action;
  risk?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ThreadState {
  threadId: string;
  senderIdHash: string;
  firstSeen: number;
  lastSeen: number;
  lastMessageHash: string;
  mode: Action;
  messageCount: number;
  riskScore: number;
  paused: boolean;
  humanRequired: boolean;
}
