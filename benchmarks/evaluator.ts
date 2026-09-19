import { GeminiProvider } from '../src/llm/gemini.js';
import { JevClassifier } from '../src/llm/jev.js';
import {
  type BenchmarkCase,
  type BenchmarkCaseResult,
  type CaseComparison,
  type SecurityDirection,
  type SingleEvaluationResult,
} from './types.js';

export interface EvaluatorClients {
  gemini: GeminiProvider;
  jev: JevClassifier;
}

/**
 * Maps an Action to an integer Security Severity level (0 to 4).
 * If evaluation failed or action is undefined, returns -1 (Not Evaluated / Inactive).
 */
export function getActionSeverity(action?: string, success = true): number {
  if (!success || !action) {
    return -1; // Explicitly failed or not evaluated
  }

  switch (action) {
    case 'POLITE_REPLY':
      return 0;
    case 'TIME_WASTER':
    case 'IGNORE':
      return 1;
    case 'HUMAN_REQUIRED':
      return 3;
    case 'BLOCK_RECOMMENDED':
      return 4;
    default:
      return 2; // UNKNOWN or intermediate
  }
}

/**
 * Evaluates the disagreement direction between Gemini, Jev, and Ground Truth.
 * Treats API/client failures on high risk cases strictly as undershoots/misses.
 */
export function classifySecurityDirection(
  groundTruthAction: string,
  groundTruthSeverity: number,
  geminiAction?: string,
  geminiSuccess = true,
  jevAction?: string,
  jevSuccess = true,
): {
  securityDirection: SecurityDirection;
  geminiUndershoot: boolean;
  jevUndershoot: boolean;
  geminiSeverityDelta: number;
  jevSeverityDelta: number;
} {
  const geminiSev = getActionSeverity(geminiAction, geminiSuccess);
  const jevSev = getActionSeverity(jevAction, jevSuccess);

  // High-Risk Ground Truth (Severity >= 3: HUMAN_REQUIRED or BLOCK_RECOMMENDED)
  const isHighRiskGT = groundTruthSeverity >= 3;

  // Undershoot detection:
  // Ground truth is high risk, but model either failed (!success) or predicted passive action (severity <= 1: POLITE_REPLY / TIME_WASTER / IGNORE)
  const geminiUndershoot = isHighRiskGT && (!geminiSuccess || geminiSev <= 1);
  const jevUndershoot = isHighRiskGT && (!jevSuccess || jevSev <= 1);

  // Compute severity delta (predicted - groundTruth).
  // If failed, effective severity is 0 for safety deficit comparison.
  const effectiveGeminiSev = geminiSuccess ? Math.max(0, geminiSev) : 0;
  const effectiveJevSev = jevSuccess ? Math.max(0, jevSev) : 0;

  const geminiSeverityDelta = effectiveGeminiSev - groundTruthSeverity;
  const jevSeverityDelta = effectiveJevSev - groundTruthSeverity;

  // 1. Both critical undershoot
  if (geminiUndershoot && jevUndershoot) {
    return {
      securityDirection: 'BOTH_CRITICAL_UNDERSHOOT',
      geminiUndershoot,
      jevUndershoot,
      geminiSeverityDelta,
      jevSeverityDelta,
    };
  }

  // 2. Jev single critical undershoot
  if (jevUndershoot && !geminiUndershoot) {
    return {
      securityDirection: 'CRITICAL_JEV_UNDERSHOOT',
      geminiUndershoot,
      jevUndershoot,
      geminiSeverityDelta,
      jevSeverityDelta,
    };
  }

  // 3. Gemini single critical undershoot
  if (geminiUndershoot && !jevUndershoot) {
    return {
      securityDirection: 'CRITICAL_GEMINI_UNDERSHOOT',
      geminiUndershoot,
      jevUndershoot,
      geminiSeverityDelta,
      jevSeverityDelta,
    };
  }

  // 4. Comparison when neither critically undershot
  if (effectiveJevSev > effectiveGeminiSev) {
    return {
      securityDirection: 'JEV_MORE_ESCALATED',
      geminiUndershoot,
      jevUndershoot,
      geminiSeverityDelta,
      jevSeverityDelta,
    };
  }

  if (effectiveGeminiSev > effectiveJevSev) {
    return {
      securityDirection: 'GEMINI_MORE_ESCALATED',
      geminiUndershoot,
      jevUndershoot,
      geminiSeverityDelta,
      jevSeverityDelta,
    };
  }

  return {
    securityDirection: 'EQUIVALENT_ESCALATION',
    geminiUndershoot,
    jevUndershoot,
    geminiSeverityDelta,
    jevSeverityDelta,
  };
}

/**
 * Runs evaluation for a single benchmark case against both Gemini and Jev.
 * Guarantees that neither Messenger sending nor pre-send Reply Guard are executed.
 */
export async function evaluateBenchmarkCase(
  item: BenchmarkCase,
  clients: EvaluatorClients,
): Promise<BenchmarkCaseResult> {
  // 1. Evaluate Gemini (Production source of truth classifier)
  const geminiStart = Date.now();
  let geminiResult: SingleEvaluationResult;
  try {
    const classification = await clients.gemini.classify(item.message);
    geminiResult = {
      category: classification.category,
      action: classification.action,
      risk: classification.risk,
      latencyMs: Date.now() - geminiStart,
      success: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    geminiResult = {
      latencyMs: Date.now() - geminiStart,
      success: false,
      errorCode: 'GEMINI_API_ERROR',
      errorMessage: msg,
    };
  }

  // 2. Evaluate Jev (Shadow observer with deterministic policy)
  const jevStart = Date.now();
  let jevResult: SingleEvaluationResult;
  try {
    const jevDecision = await clients.jev.evaluate(item.message);
    jevResult = {
      category: jevDecision.category,
      action: jevDecision.action,
      risk: jevDecision.risk,
      confidence: jevDecision.signals?.categoryConfidence,
      latencyMs: jevDecision.latencyMs ?? (Date.now() - jevStart),
      success: jevDecision.success,
      errorCode: jevDecision.success ? undefined : jevDecision.reasonCode,
      errorMessage: jevDecision.success ? undefined : jevDecision.reason,
      signals: jevDecision.signals
        ? {
            credentialRequest: jevDecision.signals.credentialRequest,
            moneyRequest: jevDecision.signals.moneyRequest,
            threatOrUrgency: jevDecision.signals.threatOrUrgency,
            promptInjection: jevDecision.signals.promptInjection,
            suspiciousExternalLink: jevDecision.signals.suspiciousExternalLink,
            overallRisk: jevDecision.signals.overallRisk,
          }
        : undefined,
      triggeredSignals: jevDecision.triggeredSignals,
      primarySignal: jevDecision.primarySignal,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    jevResult = {
      latencyMs: Date.now() - jevStart,
      success: false,
      errorCode: 'JEV_CLIENT_ERROR',
      errorMessage: msg,
    };
  }

  // 3. Compute Comparison and Direction
  const geminiCategoryCorrect = Boolean(geminiResult.success && geminiResult.category === item.groundTruth.category);
  const jevCategoryCorrect = Boolean(jevResult.success && jevResult.category === item.groundTruth.category);
  const geminiActionCorrect = Boolean(geminiResult.success && geminiResult.action === item.groundTruth.expectedAction);
  const jevActionCorrect = Boolean(jevResult.success && jevResult.action === item.groundTruth.expectedAction);
  const categoryAgreement = Boolean(geminiResult.success && jevResult.success && geminiResult.category === jevResult.category);
  const actionAgreement = Boolean(geminiResult.success && jevResult.success && geminiResult.action === jevResult.action);

  const {
    securityDirection,
    geminiUndershoot,
    jevUndershoot,
    geminiSeverityDelta,
    jevSeverityDelta,
  } = classifySecurityDirection(
    item.groundTruth.expectedAction,
    item.groundTruth.securitySeverity,
    geminiResult.action,
    geminiResult.success,
    jevResult.action,
    jevResult.success,
  );

  const comparison: CaseComparison = {
    geminiCategoryCorrect,
    jevCategoryCorrect,
    geminiActionCorrect,
    jevActionCorrect,
    categoryAgreement,
    actionAgreement,
    securityDirection,
    isHighRiskGroundTruth: item.groundTruth.securitySeverity >= 3,
    geminiUndershoot,
    jevUndershoot,
    geminiSeverityDelta,
    jevSeverityDelta,
  };

  return {
    id: item.id,
    group: item.group,
    groundTruth: item.groundTruth,
    gemini: geminiResult,
    jev: jevResult,
    comparison,
  };
}
