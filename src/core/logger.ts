import {
  type ObservabilityLog,
  SafeLogDetailsSchema,
} from './types.js';

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
    reason: entry.reason,
    details: safeDetails,
  };

  console.log(JSON.stringify(log));
}
