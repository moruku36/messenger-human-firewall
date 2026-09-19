import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifySecurityDirection,
  evaluateBenchmarkCase,
  getActionSeverity,
  type EvaluatorClients,
} from '../benchmarks/evaluator.js';
import {
  aggregateBenchmarkMetrics,
  buildConfusionMatrix,
  calculateLatencyStats,
  confusionMatrixToCsv,
} from '../benchmarks/metrics.js';
import { formatConfusionMatrixMarkdown, generateMarkdownReport } from '../benchmarks/report-generator.js';
import {
  BenchmarkDatasetSchema,
  type BenchmarkCase,
  type BenchmarkCaseResult,
} from '../benchmarks/types.js';

describe('Phase 2: Jev vs Gemini Benchmark Suite (Offline & Deterministic)', () => {
  const datasetPath = path.join(__dirname, '..', 'benchmarks', 'datasets', 'security-triage-v1.json');

  it('validates that the fixed benchmark dataset exists and contains >= 100 valid cases', () => {
    expect(fs.existsSync(datasetPath)).toBe(true);
    const rawData = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
    const dataset = BenchmarkDatasetSchema.parse(rawData);

    expect(dataset.length).toBeGreaterThanOrEqual(100);

    // Verify all IDs are unique
    const idSet = new Set(dataset.map((d) => d.id));
    expect(idSet.size).toBe(dataset.length);

    // Verify distribution across groups
    const groups: Record<string, number> = {};
    for (const item of dataset) {
      groups[item.group] = (groups[item.group] || 0) + 1;
    }

    expect(groups['NORMAL']).toBeGreaterThanOrEqual(15);
    expect(groups['SALES']).toBeGreaterThanOrEqual(10);
    expect(groups['SPAM']).toBeGreaterThanOrEqual(10);
    expect(groups['SCAM']).toBeGreaterThanOrEqual(15);
    expect(groups['CREDENTIAL_PHISHING']).toBeGreaterThanOrEqual(10);
    expect(groups['MONEY_REQUEST_SCAM']).toBeGreaterThanOrEqual(10);
    expect(groups['PROMPT_INJECTION']).toBeGreaterThanOrEqual(10);
    expect(groups['HARASSMENT_THREAT']).toBeGreaterThanOrEqual(10);
    expect(groups['SUSPICIOUS_EXTERNAL_LINK']).toBeGreaterThanOrEqual(5);
    expect(groups['AMBIGUOUS_MULTILINGUAL']).toBeGreaterThanOrEqual(5);
  });

  it('correctly calculates Action Security Severity levels (0-4)', () => {
    expect(getActionSeverity('POLITE_REPLY')).toBe(0);
    expect(getActionSeverity('TIME_WASTER')).toBe(1);
    expect(getActionSeverity('IGNORE')).toBe(1);
    expect(getActionSeverity('HUMAN_REQUIRED')).toBe(3);
    expect(getActionSeverity('BLOCK_RECOMMENDED')).toBe(4);
    expect(getActionSeverity('UNKNOWN')).toBe(2);
  });

  it('correctly flags CRITICAL_JEV_UNDERSHOOT when Ground Truth is BLOCK_RECOMMENDED but Jev predicts POLITE_REPLY', () => {
    const direction = classifySecurityDirection(
      'BLOCK_RECOMMENDED',
      4, // High risk severity
      'BLOCK_RECOMMENDED', // Gemini correct
      'POLITE_REPLY', // Jev dangerous undershoot
    );

    expect(direction.securityDirection).toBe('CRITICAL_JEV_UNDERSHOOT');
    expect(direction.jevUndershoot).toBe(true);
    expect(direction.geminiUndershoot).toBe(false);
  });

  it('correctly flags CRITICAL_GEMINI_UNDERSHOOT when Ground Truth is BLOCK_RECOMMENDED but Gemini predicts TIME_WASTER', () => {
    const direction = classifySecurityDirection(
      'BLOCK_RECOMMENDED',
      4,
      'TIME_WASTER', // Gemini undershoot
      'BLOCK_RECOMMENDED', // Jev correct
    );

    expect(direction.securityDirection).toBe('CRITICAL_GEMINI_UNDERSHOOT');
    expect(direction.geminiUndershoot).toBe(true);
    expect(direction.jevUndershoot).toBe(false);
  });

  it('correctly flags JEV_SAFER when Jev escalates higher than Gemini without undershoot', () => {
    const direction = classifySecurityDirection(
      'SCAM',
      2,
      'TIME_WASTER', // Severity 1
      'BLOCK_RECOMMENDED', // Severity 4
    );

    expect(direction.securityDirection).toBe('JEV_SAFER');
    expect(direction.jevUndershoot).toBe(false);
    expect(direction.geminiUndershoot).toBe(false);
  });

  it('evaluates benchmark case against mock clients safely without pre-send network side effects', async () => {
    const mockCase: BenchmarkCase = {
      id: 'CRED-TEST-01',
      group: 'CREDENTIAL_PHISHING',
      message: '認証コードを今すぐ教えてください',
      language: 'ja',
      groundTruth: {
        category: 'SCAM',
        expectedAction: 'BLOCK_RECOMMENDED',
        securitySeverity: 4,
        expectedSignals: {
          credentialRequest: true,
          moneyRequest: false,
          threatOrUrgency: true,
          promptInjection: false,
          suspiciousExternalLink: false,
        },
      },
      notes: 'Test credential case',
    };

    const mockClients: EvaluatorClients = {
      gemini: {
        classify: vi.fn().mockResolvedValue({
          category: 'SCAM',
          action: 'BLOCK_RECOMMENDED',
          risk: 95,
          reason: 'Detected OTP request',
        }),
      } as any,
      jev: {
        evaluate: vi.fn().mockResolvedValue({
          category: 'SCAM',
          action: 'BLOCK_RECOMMENDED',
          risk: 95,
          reasonCode: 'JEV_CREDENTIAL_REQUEST',
          reason: 'OTP exfiltration detected',
          success: true,
          latencyMs: 110,
          signals: {
            category: 'SCAM',
            categoryConfidence: 0.95,
            credentialRequest: 0.95,
            moneyRequest: 0.1,
            threatOrUrgency: 0.8,
            promptInjection: 0.0,
            suspiciousExternalLink: 0.0,
            overallRisk: 4,
          },
          triggeredSignals: ['credentialRequest'],
          primarySignal: 'credentialRequest',
        }),
      } as any,
    };

    const res = await evaluateBenchmarkCase(mockCase, mockClients);

    expect(res.id).toBe('CRED-TEST-01');
    expect(res.gemini.success).toBe(true);
    expect(res.jev.success).toBe(true);
    expect(res.comparison.geminiCategoryCorrect).toBe(true);
    expect(res.comparison.jevCategoryCorrect).toBe(true);
    expect(res.comparison.geminiActionCorrect).toBe(true);
    expect(res.comparison.jevActionCorrect).toBe(true);
    expect(res.comparison.categoryAgreement).toBe(true);
    expect(res.comparison.actionAgreement).toBe(true);
    expect(res.comparison.securityDirection).toBe('EQUIVALENT_SEVERITY');
  });

  it('safely captures API errors from either client without terminating execution', async () => {
    const mockCase: BenchmarkCase = {
      id: 'ERR-TEST-01',
      group: 'NORMAL',
      message: 'Hello',
      language: 'en',
      groundTruth: {
        category: 'NORMAL',
        expectedAction: 'POLITE_REPLY',
        securitySeverity: 0,
        expectedSignals: {
          credentialRequest: false,
          moneyRequest: false,
          threatOrUrgency: false,
          promptInjection: false,
          suspiciousExternalLink: false,
        },
      },
      notes: 'Error handling test',
    };

    const mockClients: EvaluatorClients = {
      gemini: {
        classify: vi.fn().mockRejectedValue(new Error('Gemini API 503 Unavailable')),
      } as any,
      jev: {
        evaluate: vi.fn().mockRejectedValue(new Error('TypeSafe Jev Timeout')),
      } as any,
    };

    const res = await evaluateBenchmarkCase(mockCase, mockClients);

    expect(res.gemini.success).toBe(false);
    expect(res.gemini.errorCode).toBe('GEMINI_API_ERROR');
    expect(res.gemini.errorMessage).toContain('Gemini API 503');

    expect(res.jev.success).toBe(false);
    expect(res.jev.errorCode).toBe('JEV_CLIENT_ERROR');
    expect(res.jev.errorMessage).toContain('TypeSafe Jev Timeout');
  });

  it('computes accurate statistical latency percentiles (P50, P95, mean, min, max)', () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = calculateLatencyStats(latencies);

    expect(stats.min).toBe(10);
    expect(stats.max).toBe(100);
    expect(stats.mean).toBe(55);
    expect(stats.p50).toBe(55);
    expect(stats.p95).toBe(96);
  });

  it('generates well-formed confusion matrices, CSV, and markdown tables', () => {
    const mockResults: BenchmarkCaseResult[] = [
      {
        id: '1',
        group: 'NORMAL',
        groundTruth: {
          category: 'NORMAL',
          expectedAction: 'POLITE_REPLY',
          securitySeverity: 0,
          expectedSignals: { credentialRequest: false, moneyRequest: false, threatOrUrgency: false, promptInjection: false, suspiciousExternalLink: false },
        },
        gemini: { category: 'NORMAL', action: 'POLITE_REPLY', risk: 10, latencyMs: 50, success: true },
        jev: { category: 'NORMAL', action: 'POLITE_REPLY', risk: 10, latencyMs: 30, success: true },
        comparison: {
          geminiCategoryCorrect: true,
          jevCategoryCorrect: true,
          geminiActionCorrect: true,
          jevActionCorrect: true,
          categoryAgreement: true,
          actionAgreement: true,
          securityDirection: 'EQUIVALENT_SEVERITY',
          isHighRiskGroundTruth: false,
          geminiUndershoot: false,
          jevUndershoot: false,
        },
      },
      {
        id: '2',
        group: 'CREDENTIAL_PHISHING',
        groundTruth: {
          category: 'SCAM',
          expectedAction: 'BLOCK_RECOMMENDED',
          securitySeverity: 4,
          expectedSignals: { credentialRequest: true, moneyRequest: false, threatOrUrgency: false, promptInjection: false, suspiciousExternalLink: false },
        },
        gemini: { category: 'SCAM', action: 'BLOCK_RECOMMENDED', risk: 90, latencyMs: 60, success: true },
        jev: { category: 'SCAM', action: 'BLOCK_RECOMMENDED', risk: 95, latencyMs: 40, success: true },
        comparison: {
          geminiCategoryCorrect: true,
          jevCategoryCorrect: true,
          geminiActionCorrect: true,
          jevActionCorrect: true,
          categoryAgreement: true,
          actionAgreement: true,
          securityDirection: 'EQUIVALENT_SEVERITY',
          isHighRiskGroundTruth: true,
          geminiUndershoot: false,
          jevUndershoot: false,
        },
      },
    ];

    const matrix = buildConfusionMatrix(mockResults, 'gemini');
    expect(matrix.matrix['NORMAL']['NORMAL']).toBe(1);
    expect(matrix.matrix['SCAM']['SCAM']).toBe(1);

    const csv = confusionMatrixToCsv(matrix);
    expect(csv).toContain('Actual \\ Predicted');
    expect(csv).toContain('NORMAL');

    const md = formatConfusionMatrixMarkdown('Test Matrix', matrix);
    expect(md).toContain('| Actual \\ Predicted |');

    const metrics = aggregateBenchmarkMetrics(mockResults);
    const report = generateMarkdownReport(mockResults, metrics, matrix, matrix, {
      runId: 'test-run',
      timestamp: new Date().toISOString(),
      geminiModel: 'gemini-3.6-flash',
      jevModel: 'jev-system-one',
      datasetSize: 2,
      runsCount: 1,
    });

    expect(report).toContain('# Jev vs Gemini Security Triage Benchmark Report');
    expect(report).toContain('Gemini Category Confusion Matrix');
    expect(report).toContain('Category Accuracy');
  });
});
