import { logEvent } from './logger.js';
import type {
  ClassificationResult,
  JevComparisonResult,
  JevDecision,
} from './types.js';

/**
 * Compares Gemini's production decision with Jev's shadow decision.
 *
 * Privacy Invariant:
 * Strictly forbidden from receiving or storing raw message body, reply text,
 * owner PII, or API keys. Uses only hashes, categories, actions, numeric metrics,
 * and pre-approved reasonCodes.
 */
export function compareDecisions(
  threadHash: string,
  geminiResult: ClassificationResult,
  jevDecision: JevDecision,
): JevComparisonResult {
  const categoryAgreement = geminiResult.category === jevDecision.category;
  const actionAgreement = geminiResult.action === jevDecision.action;

  const comparison: JevComparisonResult = {
    threadHash,
    timestamp: new Date().toISOString(),
    geminiCategory: geminiResult.category,
    jevCategory: jevDecision.category,
    geminiAction: geminiResult.action,
    jevAction: jevDecision.action,
    categoryAgreement,
    actionAgreement,
    jevConfidence: jevDecision.signals?.categoryConfidence ?? 0,
    jevRiskProbabilities: jevDecision.signals
      ? {
          credentialRequest: jevDecision.signals.credentialRequest,
          moneyRequest: jevDecision.signals.moneyRequest,
          threatOrUrgency: jevDecision.signals.threatOrUrgency,
          promptInjection: jevDecision.signals.promptInjection,
          suspiciousExternalLink: jevDecision.signals.suspiciousExternalLink,
        }
      : undefined,
    jevLatencyMs: jevDecision.latencyMs ?? 0,
    jevSuccess: jevDecision.success,
    jevReasonCode: jevDecision.reasonCode,
  };

  // Structured Safe Log Event
  logEvent({
    event: jevDecision.success ? 'JEV_SHADOW_EVALUATED' : 'JEV_ERROR',
    threadHash,
    category: jevDecision.category,
    action: jevDecision.action,
    risk: jevDecision.risk,
    reasonCode: jevDecision.reasonCode,
    details: {
      geminiCategory: geminiResult.category,
      geminiAction: geminiResult.action,
      jevCategory: jevDecision.category,
      jevAction: jevDecision.action,
      categoryAgreement,
      actionAgreement,
      jevLatencyMs: jevDecision.latencyMs ?? 0,
      jevConfidence: jevDecision.signals?.categoryConfidence ?? 0,
      jevSuccess: jevDecision.success,
      jevReasonCode: jevDecision.reasonCode,
    },
  });

  return comparison;
}

/**
 * Formats and renders a telemetry summary for console logs without leaking
 * any raw sensitive text.
 */
export function renderComparisonSummary(comparison: JevComparisonResult): void {
  const catMatch = comparison.categoryAgreement ? '✅ MATCH' : '⚠️ MISMATCH';
  const actMatch = comparison.actionAgreement ? '✅ MATCH' : '⚠️ MISMATCH';

  console.log('----------------------------------------------------');
  console.log('🔬 [Shadow Mode Telemetry: Gemini vs TypeSafe Jev]');
  console.log(`   Category : Gemini [${comparison.geminiCategory}] vs Jev [${comparison.jevCategory}] (${catMatch})`);
  console.log(`   Action   : Gemini [${comparison.geminiAction}] vs Jev [${comparison.jevAction}] (${actMatch})`);
  console.log(`   Jev Reason: ${comparison.jevReasonCode} | Success: ${comparison.jevSuccess} | Latency: ${comparison.jevLatencyMs}ms`);
  if (comparison.jevRiskProbabilities) {
    const p = comparison.jevRiskProbabilities;
    console.log(`   Jev Risk Signals: OTP=${(p.credentialRequest * 100).toFixed(0)}%, Money=${(p.moneyRequest * 100).toFixed(0)}%, Threat=${(p.threatOrUrgency * 100).toFixed(0)}%, Injection=${(p.promptInjection * 100).toFixed(0)}%`);
  }
  console.log('----------------------------------------------------');
}
