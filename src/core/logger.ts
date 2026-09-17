import {
  type ObservabilityLog,
  SafeLogDetailsSchema,
} from './types.js';

function extractReasonCode(entry: Omit<ObservabilityLog, 'timestamp'>): string | undefined {
  if (entry.reasonCode) {
    return entry.reasonCode.toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 32);
  }
  if (entry.category) {
    return `${entry.category.toUpperCase()}_CLASSIFIED`;
  }
  if (entry.event === 'LOGIN_REQUIRED') return 'LOGIN_REQUIRED';
  if (entry.event === 'ERROR') return 'RUNTIME_ERROR';
  if (entry.event === 'RATE_LIMITED') return 'RATE_LIMIT_EXCEEDED';
  if (entry.event === 'REPLY_BLOCKED') return 'REPLY_GUARD_BLOCKED';
  return undefined;
}

/**
 * Emits structured observability events.
 * Whitelists allowed metadata to guarantee raw chat bodies or arbitrary blobs
 * can never be dumped into application logs.
 */
export function logEvent(entry: Omit<ObservabilityLog, 'timestamp'>): void {
  let safeDetails = entry.details;
  if (safeDetails) {
    const validated = SafeLogDetailsSchema.safeParse(safeDetails);
    if (!validated.success) {
      safeDetails = {
        statusMessage: '[SANITIZED: invalid details format]',
      };
    } else {
      safeDetails = validated.data;
    }
  }

  const log: ObservabilityLog = {
    timestamp: new Date().toISOString(),
    event: entry.event,
    threadHash: entry.threadHash,
    category: entry.category,
    action: entry.action,
    risk: entry.risk,
    reasonCode: extractReasonCode(entry),
    details: safeDetails,
  };

  console.log(JSON.stringify(log));
}
