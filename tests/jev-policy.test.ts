import { describe, expect, it } from 'vitest';
import {
  createFailClosedJevDecision,
  evaluateJevPolicy,
} from '../src/core/jev-policy.js';
import type { JevSignals } from '../src/core/types.js';

function createMockSignals(overrides: Partial<JevSignals> = {}): JevSignals {
  return {
    category: 'NORMAL',
    categoryConfidence: 0.95,
    credentialRequest: 0.05,
    moneyRequest: 0.02,
    threatOrUrgency: 0.01,
    promptInjection: 0.01,
    suspiciousExternalLink: 0.02,
    overallRisk: 0,
    ...overrides,
  };
}

describe('Phase 3: Deterministic Decision Policy (evaluateJevPolicy)', () => {
  it('maps NORMAL message with high confidence to POLITE_REPLY', () => {
    const signals = createMockSignals({
      category: 'NORMAL',
      categoryConfidence: 0.98,
      overallRisk: 0,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('POLITE_REPLY');
    expect(decision.category).toBe('NORMAL');
    expect(decision.reasonCode).toBe('JEV_NORMAL_CONVERSATION');
    expect(decision.risk).toBeLessThanOrEqual(20);
    expect(decision.success).toBe(true);
  });

  it('maps SALES message to TIME_WASTER', () => {
    const signals = createMockSignals({
      category: 'SALES',
      categoryConfidence: 0.9,
      overallRisk: 1,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('TIME_WASTER');
    expect(decision.category).toBe('SALES');
    expect(decision.reasonCode).toBe('JEV_SALES_PROBING');
    expect(decision.risk).toBeGreaterThanOrEqual(25);
  });

  it('maps SPAM message to IGNORE', () => {
    const signals = createMockSignals({
      category: 'SPAM',
      categoryConfidence: 0.92,
      overallRisk: 1,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('IGNORE');
    expect(decision.category).toBe('SPAM');
    expect(decision.reasonCode).toBe('JEV_SPAM_HIGH_CONFIDENCE');
  });

  it('maps high-confidence SCAM to TIME_WASTER', () => {
    const signals = createMockSignals({
      category: 'SCAM',
      categoryConfidence: 0.95,
      overallRisk: 3,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('TIME_WASTER');
    expect(decision.category).toBe('SCAM');
    expect(decision.reasonCode).toBe('JEV_SCAM_HIGH_CONFIDENCE');
    expect(decision.risk).toBeGreaterThanOrEqual(75);
  });

  it('maps HARASSMENT category to HUMAN_REQUIRED', () => {
    const signals = createMockSignals({
      category: 'HARASSMENT',
      categoryConfidence: 0.9,
      threatOrUrgency: 0.4,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('HUMAN_REQUIRED');
    expect(decision.category).toBe('HARASSMENT');
    expect(decision.reasonCode).toBe('JEV_THREAT');
    expect(decision.risk).toBeGreaterThanOrEqual(90);
  });

  it('escalates to HUMAN_REQUIRED when threatOrUrgency >= 0.85', () => {
    const signals = createMockSignals({
      category: 'UNKNOWN',
      threatOrUrgency: 0.92,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('HUMAN_REQUIRED');
    expect(decision.reasonCode).toBe('JEV_THREAT');
    expect(decision.risk).toBeGreaterThanOrEqual(90);
  });

  it('recommends BLOCK when credentialRequest >= 0.85 (Password/OTP theft)', () => {
    const signals = createMockSignals({
      category: 'SCAM',
      credentialRequest: 0.96,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('BLOCK_RECOMMENDED');
    expect(decision.reasonCode).toBe('JEV_CREDENTIAL_REQUEST');
    expect(decision.risk).toBeGreaterThanOrEqual(95);
  });

  it('recommends BLOCK when moneyRequest >= 0.85 (Wire/crypto scam)', () => {
    const signals = createMockSignals({
      category: 'NORMAL', // Even if category was somehow confused, signal dominates
      moneyRequest: 0.89,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('BLOCK_RECOMMENDED');
    expect(decision.reasonCode).toBe('JEV_MONEY_REQUEST');
    expect(decision.risk).toBeGreaterThanOrEqual(89);
  });

  it('recommends BLOCK when promptInjection >= 0.85 (Jailbreak / System prompt leak)', () => {
    const signals = createMockSignals({
      category: 'NORMAL',
      promptInjection: 0.94,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('BLOCK_RECOMMENDED');
    expect(decision.reasonCode).toBe('JEV_PROMPT_INJECTION');
    expect(decision.risk).toBeGreaterThanOrEqual(85);
  });

  it('routes to TIME_WASTER when suspiciousExternalLink >= 0.85', () => {
    const signals = createMockSignals({
      category: 'NORMAL',
      suspiciousExternalLink: 0.88,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('TIME_WASTER');
    expect(decision.reasonCode).toBe('JEV_SUSPICIOUS_LINK');
  });

  it('fails closed to HUMAN_REQUIRED when categoryConfidence < 0.80 (Ambiguous input)', () => {
    const signals = createMockSignals({
      category: 'NORMAL',
      categoryConfidence: 0.65, // Below default minConfidence 0.80
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('HUMAN_REQUIRED');
    expect(decision.reasonCode).toBe('JEV_LOW_CONFIDENCE');
    expect(decision.risk).toBe(60);
  });

  it('escalates to HUMAN_REQUIRED with JEV_MULTIPLE_HIGH_RISK_SIGNALS when Prompt Injection + Threat are both high', () => {
    const signals = createMockSignals({
      category: 'HARASSMENT',
      threatOrUrgency: 0.93,
      promptInjection: 0.96,
      overallRisk: 4,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('HUMAN_REQUIRED');
    expect(decision.reasonCode).toBe('JEV_MULTIPLE_HIGH_RISK_SIGNALS');
    expect(decision.primarySignal).toBe('threatOrUrgency');
    expect(decision.triggeredSignals).toContain('threatOrUrgency');
    expect(decision.triggeredSignals).toContain('promptInjection');
    expect(decision.reason).toContain('Multiple high-risk signals detected');
  });

  it('assigns JEV_MULTIPLE_HIGH_RISK_SIGNALS with BLOCK_RECOMMENDED when Credential + Money requests coincide', () => {
    const signals = createMockSignals({
      category: 'SCAM',
      credentialRequest: 0.95,
      moneyRequest: 0.91,
      overallRisk: 4,
    });
    const decision = evaluateJevPolicy(signals);

    expect(decision.action).toBe('BLOCK_RECOMMENDED');
    expect(decision.reasonCode).toBe('JEV_MULTIPLE_HIGH_RISK_SIGNALS');
    expect(decision.primarySignal).toBe('credentialRequest');
    expect(decision.triggeredSignals).toEqual(['credentialRequest', 'moneyRequest']);
  });

  it('creates fail-closed decision properly on timeouts or API errors', () => {
    const timeoutDecision = createFailClosedJevDecision('JEV_TIMEOUT', 'Request aborted after 5000ms', 5002);
    expect(timeoutDecision.action).toBe('HUMAN_REQUIRED');
    expect(timeoutDecision.category).toBe('UNKNOWN');
    expect(timeoutDecision.reasonCode).toBe('JEV_TIMEOUT');
    expect(timeoutDecision.success).toBe(false);

    const apiErrorDecision = createFailClosedJevDecision('JEV_API_ERROR', 'Network connection refused', 150);
    expect(apiErrorDecision.action).toBe('HUMAN_REQUIRED');
    expect(apiErrorDecision.reasonCode).toBe('JEV_API_ERROR');
    expect(apiErrorDecision.success).toBe(false);
  });
});
