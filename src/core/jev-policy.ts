import type { Action, JevDecision, JevReasonCode, JevSignals } from './types.js';

export interface JevPolicyConfig {
  highRiskThreshold: number; // e.g. 0.85
  minConfidence: number; // e.g. 0.80
}

export const DEFAULT_JEV_POLICY_CONFIG: JevPolicyConfig = {
  highRiskThreshold: 0.85,
  minConfidence: 0.8,
};

/**
 * Creates a fail-closed decision for timeouts, network/API errors, schema failures,
 * or unhandled exceptions. Always defaults safely to HUMAN_REQUIRED.
 */
export function createFailClosedJevDecision(
  reasonCode: JevReasonCode,
  errorMessage: string,
  latencyMs = 0,
): JevDecision {
  return {
    action: 'HUMAN_REQUIRED',
    category: 'UNKNOWN',
    risk: 80,
    reasonCode,
    reason: `Fail-Closed: ${errorMessage}`,
    latencyMs,
    success: false,
  };
}

/**
 * Pure TypeScript deterministic decision policy mapping Jev's typed semantic signals
 * to an explicit triage Action.
 *
 * Security Invariant:
 * Evaluated strictly in order of security impact:
 * 1. Physical threat / harassment urgency -> HUMAN_REQUIRED
 * 2. Credential theft / OTP / phishing -> BLOCK_RECOMMENDED
 * 3. Monetary extortion / wire scam -> BLOCK_RECOMMENDED
 * 4. Adversarial prompt injection -> BLOCK_RECOMMENDED
 * 5. Suspicious external link -> TIME_WASTER (Never opened, safely engaged or stalled)
 * 6. Classification confidence below threshold -> HUMAN_REQUIRED (Fail safe)
 * 7. Categorical triage -> deterministic mapping
 */
export function evaluateJevPolicy(
  signals: JevSignals,
  config: JevPolicyConfig = DEFAULT_JEV_POLICY_CONFIG,
  latencyMs = 0,
): JevDecision {
  const { highRiskThreshold, minConfidence } = config;

  // Track all triggered high-risk signals
  const triggeredSignals: string[] = [];
  if (signals.threatOrUrgency >= highRiskThreshold || signals.category === 'HARASSMENT') {
    triggeredSignals.push('threatOrUrgency');
  }
  if (signals.credentialRequest >= highRiskThreshold) {
    triggeredSignals.push('credentialRequest');
  }
  if (signals.moneyRequest >= highRiskThreshold) {
    triggeredSignals.push('moneyRequest');
  }
  if (signals.promptInjection >= highRiskThreshold) {
    triggeredSignals.push('promptInjection');
  }
  if (signals.suspiciousExternalLink >= highRiskThreshold) {
    triggeredSignals.push('suspiciousExternalLink');
  }

  const isMultiple = triggeredSignals.length > 1;

  // 1. Threat or Urgency detection (Highest severity -> HUMAN_REQUIRED)
  if (triggeredSignals.includes('threatOrUrgency')) {
    const reasonCode: JevReasonCode = isMultiple ? 'JEV_MULTIPLE_HIGH_RISK_SIGNALS' : 'JEV_THREAT';
    const reason = isMultiple
      ? `Multiple high-risk signals detected (${triggeredSignals.join(', ')}). Acute threat urgency dominant.`
      : `Threat or acute harassment detected with probability ${(signals.threatOrUrgency * 100).toFixed(1)}%`;

    return {
      action: 'HUMAN_REQUIRED',
      category: signals.category === 'HARASSMENT' ? 'HARASSMENT' : signals.category,
      risk: Math.max(90, Math.round(signals.threatOrUrgency * 100)),
      reasonCode,
      reason,
      signals,
      latencyMs,
      success: true,
      triggeredSignals,
      primarySignal: 'threatOrUrgency',
    };
  }

  // 2. Credential / Secret Exfiltration Request (BLOCK_RECOMMENDED)
  if (triggeredSignals.includes('credentialRequest')) {
    const reasonCode: JevReasonCode = isMultiple ? 'JEV_MULTIPLE_HIGH_RISK_SIGNALS' : 'JEV_CREDENTIAL_REQUEST';
    const reason = isMultiple
      ? `Multiple high-risk signals detected (${triggeredSignals.join(', ')}). Credential theft dominant.`
      : `Credential/OTP exfiltration attempt detected with probability ${(signals.credentialRequest * 100).toFixed(1)}%`;

    return {
      action: 'BLOCK_RECOMMENDED',
      category: signals.category === 'UNKNOWN' ? 'SCAM' : signals.category,
      risk: Math.max(95, Math.round(signals.credentialRequest * 100)),
      reasonCode,
      reason,
      signals,
      latencyMs,
      success: true,
      triggeredSignals,
      primarySignal: 'credentialRequest',
    };
  }

  // 3. Unauthorized Money Transfer / Financial Request (BLOCK_RECOMMENDED)
  if (triggeredSignals.includes('moneyRequest')) {
    const reasonCode: JevReasonCode = isMultiple ? 'JEV_MULTIPLE_HIGH_RISK_SIGNALS' : 'JEV_MONEY_REQUEST';
    const reason = isMultiple
      ? `Multiple high-risk signals detected (${triggeredSignals.join(', ')}). Financial request dominant.`
      : `Financial transfer or money request detected with probability ${(signals.moneyRequest * 100).toFixed(1)}%`;

    return {
      action: 'BLOCK_RECOMMENDED',
      category: signals.category === 'UNKNOWN' ? 'SCAM' : signals.category,
      risk: Math.max(90, Math.round(signals.moneyRequest * 100)),
      reasonCode,
      reason,
      signals,
      latencyMs,
      success: true,
      triggeredSignals,
      primarySignal: 'moneyRequest',
    };
  }

  // 4. Prompt Injection / Jailbreak Attempt (BLOCK_RECOMMENDED)
  if (triggeredSignals.includes('promptInjection')) {
    const reasonCode: JevReasonCode = isMultiple ? 'JEV_MULTIPLE_HIGH_RISK_SIGNALS' : 'JEV_PROMPT_INJECTION';
    const reason = isMultiple
      ? `Multiple high-risk signals detected (${triggeredSignals.join(', ')}). Prompt injection dominant.`
      : `Adversarial prompt injection attempt detected with probability ${(signals.promptInjection * 100).toFixed(1)}%`;

    return {
      action: 'BLOCK_RECOMMENDED',
      category: signals.category === 'UNKNOWN' ? 'SCAM' : signals.category,
      risk: Math.max(85, Math.round(signals.promptInjection * 100)),
      reasonCode,
      reason,
      signals,
      latencyMs,
      success: true,
      triggeredSignals,
      primarySignal: 'promptInjection',
    };
  }

  // 5. Suspicious External Link (TIME_WASTER)
  if (triggeredSignals.includes('suspiciousExternalLink')) {
    return {
      action: 'TIME_WASTER',
      category: signals.category === 'UNKNOWN' ? 'SCAM' : signals.category,
      risk: Math.max(75, Math.round(signals.suspiciousExternalLink * 100)),
      reasonCode: 'JEV_SUSPICIOUS_LINK',
      reason: `Suspicious external link detected with probability ${(signals.suspiciousExternalLink * 100).toFixed(1)}%`,
      signals,
      latencyMs,
      success: true,
      triggeredSignals,
      primarySignal: 'suspiciousExternalLink',
    };
  }

  // 6. Minimum Confidence Gate (Fail Closed for Ambiguous Results)
  if (signals.categoryConfidence < minConfidence) {
    return {
      action: 'HUMAN_REQUIRED',
      category: signals.category,
      risk: 60,
      reasonCode: 'JEV_LOW_CONFIDENCE',
      reason: `Low classification confidence (${(signals.categoryConfidence * 100).toFixed(1)}% < ${(minConfidence * 100).toFixed(1)}%)`,
      signals,
      latencyMs,
      success: true,
    };
  }

  // 7. Deterministic Category-Based Mapping
  let action: Action;
  let reasonCode: JevReasonCode;
  let calculatedRisk = Math.min(100, Math.round((signals.overallRisk / 4) * 100));

  switch (signals.category) {
    case 'SCAM':
      action = 'TIME_WASTER';
      reasonCode = 'JEV_SCAM_HIGH_CONFIDENCE';
      calculatedRisk = Math.max(80, calculatedRisk);
      break;

    case 'SPAM':
      action = 'IGNORE';
      reasonCode = 'JEV_SPAM_HIGH_CONFIDENCE';
      calculatedRisk = Math.max(30, calculatedRisk);
      break;

    case 'SALES':
      action = 'TIME_WASTER';
      reasonCode = 'JEV_SALES_PROBING';
      calculatedRisk = Math.max(40, calculatedRisk);
      break;

    case 'NORMAL':
      action = 'POLITE_REPLY';
      reasonCode = 'JEV_NORMAL_CONVERSATION';
      calculatedRisk = Math.min(20, calculatedRisk);
      break;

    case 'UNKNOWN':
    default:
      action = 'HUMAN_REQUIRED';
      reasonCode = 'JEV_LOW_CONFIDENCE';
      calculatedRisk = Math.max(50, calculatedRisk);
      break;
  }

  return {
    action,
    category: signals.category,
    risk: calculatedRisk,
    reasonCode,
    reason: `Deterministic policy applied: ${signals.category} -> ${action} (Confidence: ${(signals.categoryConfidence * 100).toFixed(1)}%)`,
    signals,
    latencyMs,
    success: true,
  };
}
