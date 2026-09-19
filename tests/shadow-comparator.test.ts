import { describe, expect, it } from 'vitest';
import { compareDecisions } from '../src/core/comparator.js';
import type { ClassificationResult, JevDecision } from '../src/core/types.js';

describe('Phase 5: Shadow Mode Comparison Telemetry (compareDecisions)', () => {
  it('correctly calculates agreement when both Gemini and Jev concur on SCAM / TIME_WASTER', () => {
    const threadHash = 'hash-thread-abc123';
    const geminiResult: ClassificationResult = {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 85,
      reason: 'Cryptocurrency investment scam detected',
      reply: 'どのような仕組みでしょうか？',
    };

    const jevDecision: JevDecision = {
      category: 'SCAM',
      action: 'TIME_WASTER',
      risk: 85,
      reasonCode: 'JEV_SCAM_HIGH_CONFIDENCE',
      reason: 'Deterministic policy applied: SCAM -> TIME_WASTER',
      latencyMs: 120,
      success: true,
      signals: {
        category: 'SCAM',
        categoryConfidence: 0.96,
        credentialRequest: 0.1,
        moneyRequest: 0.7,
        threatOrUrgency: 0.05,
        promptInjection: 0.0,
        suspiciousExternalLink: 0.3,
        overallRisk: 3,
      },
    };

    const comparison = compareDecisions(threadHash, geminiResult, jevDecision);

    expect(comparison.categoryAgreement).toBe(true);
    expect(comparison.actionAgreement).toBe(true);
    expect(comparison.geminiCategory).toBe('SCAM');
    expect(comparison.jevCategory).toBe('SCAM');
    expect(comparison.geminiAction).toBe('TIME_WASTER');
    expect(comparison.jevAction).toBe('TIME_WASTER');
    expect(comparison.jevConfidence).toBe(0.96);
    expect(comparison.jevLatencyMs).toBe(120);
    expect(comparison.jevSuccess).toBe(true);
    expect(comparison.jevReasonCode).toBe('JEV_SCAM_HIGH_CONFIDENCE');
  });

  it('correctly flags discrepancy when Gemini classifies NORMAL but Jev detects CREDENTIAL_REQUEST', () => {
    const threadHash = 'hash-thread-mismatch456';
    const geminiResult: ClassificationResult = {
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 20,
      reason: 'Greeting message',
      reply: 'どのようなご用件でしょうか？',
    };

    const jevDecision: JevDecision = {
      category: 'SCAM',
      action: 'BLOCK_RECOMMENDED',
      risk: 95,
      reasonCode: 'JEV_CREDENTIAL_REQUEST',
      reason: 'Credential/OTP exfiltration attempt detected',
      latencyMs: 85,
      success: true,
      signals: {
        category: 'SCAM',
        categoryConfidence: 0.94,
        credentialRequest: 0.98,
        moneyRequest: 0.05,
        threatOrUrgency: 0.1,
        promptInjection: 0.01,
        suspiciousExternalLink: 0.0,
        overallRisk: 4,
      },
    };

    const comparison = compareDecisions(threadHash, geminiResult, jevDecision);

    expect(comparison.categoryAgreement).toBe(false);
    expect(comparison.actionAgreement).toBe(false);
    expect(comparison.jevAction).toBe('BLOCK_RECOMMENDED');
    expect(comparison.geminiAction).toBe('POLITE_REPLY');
  });

  it('verifies privacy invariant: raw sensitive chat text is never present in comparison structure', () => {
    const threadHash = 'hash-thread-privacy-check';
    const rawSecretMessage = '私の秘密のパスワードは Secret123 です。';
    const rawCandidateReply = '秘密の情報を共有していただきありがとうございます。';

    const geminiResult: ClassificationResult = {
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 15,
      reason: 'Normal conversation',
      reply: rawCandidateReply,
    };

    const jevDecision: JevDecision = {
      category: 'NORMAL',
      action: 'POLITE_REPLY',
      risk: 15,
      reasonCode: 'JEV_NORMAL_CONVERSATION',
      reason: 'Normal greeting',
      latencyMs: 90,
      success: true,
    };

    const comparison = compareDecisions(threadHash, geminiResult, jevDecision);
    const serialized = JSON.stringify(comparison);

    expect(serialized).not.toContain(rawSecretMessage);
    expect(serialized).not.toContain(rawCandidateReply);
    expect(serialized).not.toContain('Secret123');
  });
});
