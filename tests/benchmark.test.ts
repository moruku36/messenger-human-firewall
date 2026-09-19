import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifySecurityDirection,
  getActionSeverity,
  type EvaluatorClients,
} from '../benchmarks/evaluator.js';
import {
  aggregateBenchmarkMetrics,
  buildConfusionMatrix,
  calculateBinaryConfusionMatrix,
  calculateSeverityDistance,
} from '../benchmarks/metrics.js';
import { generateMarkdownReport } from '../benchmarks/report-generator.js';
import { runBenchmark } from '../benchmarks/run-benchmark.js';
import {
  BenchmarkDatasetSchema,
  type BenchmarkCaseResult,
} from '../benchmarks/types.js';

describe('Phase 2: Jev vs Gemini Benchmark Suite (Offline & Deterministic)', () => {
  const datasetPath = path.join(__dirname, '..', 'benchmarks', 'datasets', 'security-triage-v1.json');

  it('validates that the fixed benchmark dataset exists and contains >= 100 valid cases', () => {
    expect(fs.existsSync(datasetPath)).toBe(true);
    const rawData = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
    const dataset = BenchmarkDatasetSchema.parse(rawData);

    expect(dataset.length).toBeGreaterThanOrEqual(100);

    const idSet = new Set(dataset.map((d) => d.id));
    expect(idSet.size).toBe(dataset.length);

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

  it('correctly calculates Action Security Severity levels (0-4) and -1 for failure', () => {
    expect(getActionSeverity('POLITE_REPLY')).toBe(0);
    expect(getActionSeverity('TIME_WASTER')).toBe(1);
    expect(getActionSeverity('IGNORE')).toBe(1);
    expect(getActionSeverity('HUMAN_REQUIRED')).toBe(3);
    expect(getActionSeverity('BLOCK_RECOMMENDED')).toBe(4);
    expect(getActionSeverity('UNKNOWN')).toBe(2);
    expect(getActionSeverity(undefined, false)).toBe(-1);
    expect(getActionSeverity('BLOCK_RECOMMENDED', false)).toBe(-1);
  });

  it('correctly treats API failure on High-Risk Ground Truth as CRITICAL UNDERSHOOT and NOT detected', () => {
    const direction = classifySecurityDirection(
      'BLOCK_RECOMMENDED',
      4, // Ground Truth high risk
      'BLOCK_RECOMMENDED', // Gemini success
      true,
      undefined, // Jev failed
      false,
    );

    expect(direction.securityDirection).toBe('CRITICAL_JEV_UNDERSHOOT');
    expect(direction.jevUndershoot).toBe(true);
    expect(direction.geminiUndershoot).toBe(false);
    expect(direction.jevSeverityDelta).toBe(-4); // effective 0 - 4 = -4
  });

  it('correctly detects BOTH_CRITICAL_UNDERSHOOT when both models fail or undershoot high-risk message', () => {
    const direction = classifySecurityDirection(
      'BLOCK_RECOMMENDED',
      4,
      'POLITE_REPLY', // Gemini undershoot
      true,
      'TIME_WASTER', // Jev undershoot
      true,
    );

    expect(direction.securityDirection).toBe('BOTH_CRITICAL_UNDERSHOOT');
    expect(direction.geminiUndershoot).toBe(true);
    expect(direction.jevUndershoot).toBe(true);
  });

  it('classifies false positive escalation as JEV_MORE_ESCALATED and NOT safer', () => {
    const direction = classifySecurityDirection(
      'POLITE_REPLY',
      0, // harmless
      'POLITE_REPLY', // Gemini correct
      true,
      'BLOCK_RECOMMENDED', // Jev false positive escalation
      true,
    );

    expect(direction.securityDirection).toBe('JEV_MORE_ESCALATED');
    expect(direction.jevUndershoot).toBe(false);
    expect(direction.geminiUndershoot).toBe(false);
    expect(direction.jevSeverityDelta).toBe(4); // 4 - 0 = +4
    expect(direction.geminiSeverityDelta).toBe(0); // 0 - 0 = 0
  });

  it('calculates global binary security confusion matrix and severity distance across cases', () => {
    const mockResults: BenchmarkCaseResult[] = [
      // Case 1: High risk actual (Severity 4), both correctly escalate -> TP
      {
        id: '1',
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
          securityDirection: 'EQUIVALENT_ESCALATION',
          isHighRiskGroundTruth: true,
          geminiUndershoot: false,
          jevUndershoot: false,
          geminiSeverityDelta: 0,
          jevSeverityDelta: 0,
        },
      },
      // Case 2: High risk actual (Severity 4), Jev fails (FN), Gemini succeeds (TP)
      {
        id: '2',
        group: 'MONEY_REQUEST_SCAM',
        groundTruth: {
          category: 'SCAM',
          expectedAction: 'BLOCK_RECOMMENDED',
          securitySeverity: 4,
          expectedSignals: { credentialRequest: false, moneyRequest: true, threatOrUrgency: false, promptInjection: false, suspiciousExternalLink: false },
        },
        gemini: { category: 'SCAM', action: 'BLOCK_RECOMMENDED', risk: 90, latencyMs: 60, success: true },
        jev: { latencyMs: 10, success: false, errorCode: 'API_TIMEOUT' },
        comparison: {
          geminiCategoryCorrect: true,
          jevCategoryCorrect: false,
          geminiActionCorrect: true,
          jevActionCorrect: false,
          categoryAgreement: false,
          actionAgreement: false,
          securityDirection: 'CRITICAL_JEV_UNDERSHOOT',
          isHighRiskGroundTruth: true,
          geminiUndershoot: false,
          jevUndershoot: true,
          geminiSeverityDelta: 0,
          jevSeverityDelta: -4,
        },
      },
      // Case 3: Harmless actual (Severity 0), Gemini normal (TN), Jev over-escalates to BLOCK (FP)
      {
        id: '3',
        group: 'NORMAL',
        groundTruth: {
          category: 'NORMAL',
          expectedAction: 'POLITE_REPLY',
          securitySeverity: 0,
          expectedSignals: { credentialRequest: false, moneyRequest: false, threatOrUrgency: false, promptInjection: false, suspiciousExternalLink: false },
        },
        gemini: { category: 'NORMAL', action: 'POLITE_REPLY', risk: 10, latencyMs: 50, success: true },
        jev: { category: 'SCAM', action: 'BLOCK_RECOMMENDED', risk: 90, latencyMs: 30, success: true },
        comparison: {
          geminiCategoryCorrect: true,
          jevCategoryCorrect: false,
          geminiActionCorrect: true,
          jevActionCorrect: false,
          categoryAgreement: false,
          actionAgreement: false,
          securityDirection: 'JEV_MORE_ESCALATED',
          isHighRiskGroundTruth: false,
          geminiUndershoot: false,
          jevUndershoot: false,
          geminiSeverityDelta: 0,
          jevSeverityDelta: 4,
        },
      },
      // Case 4: Harmless actual (Severity 0), both normal -> TN
      {
        id: '4',
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
          securityDirection: 'EQUIVALENT_ESCALATION',
          isHighRiskGroundTruth: false,
          geminiUndershoot: false,
          jevUndershoot: false,
          geminiSeverityDelta: 0,
          jevSeverityDelta: 0,
        },
      },
    ];

    const geminiBinary = calculateBinaryConfusionMatrix(mockResults, 'gemini');
    expect(geminiBinary.tp).toBe(2);
    expect(geminiBinary.fn).toBe(0);
    expect(geminiBinary.fp).toBe(0);
    expect(geminiBinary.tn).toBe(2);
    expect(geminiBinary.recall).toBe(1.0);
    expect(geminiBinary.precision).toBe(1.0);

    const jevBinary = calculateBinaryConfusionMatrix(mockResults, 'jev');
    expect(jevBinary.tp).toBe(1);
    expect(jevBinary.fn).toBe(1); // The failed high risk case counts as FN!
    expect(jevBinary.fp).toBe(1); // The false escalation on harmless case counts as FP!
    expect(jevBinary.tn).toBe(1);
    expect(jevBinary.recall).toBe(0.5); // 1 / 2
    expect(jevBinary.precision).toBe(0.5); // 1 / 2

    const jevDistance = calculateSeverityDistance(mockResults, 'jev');
    expect(jevDistance.exactActionMatches).toBe(2);
    expect(jevDistance.overEscalationCount).toBe(1);
    expect(jevDistance.underEscalationCount).toBe(1);
    expect(jevDistance.meanAbsoluteSeverityError).toBe(2); // (|0| + |-4| + |4| + |0|) / 4 = 2.0
  });

  it('accurately separates End-to-End Accuracy from Conditional Successful-Call Accuracy', () => {
    const mockResults: BenchmarkCaseResult[] = [
      // 8 successful, 2 failed
      ...Array.from({ length: 8 }).map((_, i) => ({
        id: `succ-${i}`,
        group: 'NORMAL',
        groundTruth: {
          category: 'NORMAL' as const,
          expectedAction: 'POLITE_REPLY' as const,
          securitySeverity: 0 as const,
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
          securityDirection: 'EQUIVALENT_ESCALATION' as const,
          isHighRiskGroundTruth: false,
          geminiUndershoot: false,
          jevUndershoot: false,
          geminiSeverityDelta: 0,
          jevSeverityDelta: 0,
        },
      })),
      ...Array.from({ length: 2 }).map((_, i) => ({
        id: `fail-${i}`,
        group: 'NORMAL',
        groundTruth: {
          category: 'NORMAL' as const,
          expectedAction: 'POLITE_REPLY' as const,
          securitySeverity: 0 as const,
          expectedSignals: { credentialRequest: false, moneyRequest: false, threatOrUrgency: false, promptInjection: false, suspiciousExternalLink: false },
        },
        gemini: { category: 'NORMAL', action: 'POLITE_REPLY', risk: 10, latencyMs: 50, success: true },
        jev: { latencyMs: 10, success: false, errorCode: 'API_ERROR' },
        comparison: {
          geminiCategoryCorrect: true,
          jevCategoryCorrect: false,
          geminiActionCorrect: true,
          jevActionCorrect: false,
          categoryAgreement: false,
          actionAgreement: false,
          securityDirection: 'GEMINI_MORE_ESCALATED' as const,
          isHighRiskGroundTruth: false,
          geminiUndershoot: false,
          jevUndershoot: false,
          geminiSeverityDelta: 0,
          jevSeverityDelta: 0,
        },
      })),
    ];

    const metrics = aggregateBenchmarkMetrics(mockResults);

    // Total = 10
    expect(metrics.overall.totalCases).toBe(10);
    expect(metrics.overall.jevSuccessCount).toBe(8);
    expect(metrics.overall.jevFailureCount).toBe(2);

    // Jev End-to-End Action Accuracy: 8 / 10 = 80%
    expect(metrics.overall.jevEndToEndActionAccuracy).toBe(0.8);
    // Jev Conditional Action Accuracy: 8 / 8 = 100%
    expect(metrics.overall.jevConditionalActionAccuracy).toBe(1.0);
  });

  it('actually executes N repeated runs when --runs N is provided without overwriting single run files', async () => {
    let geminiEvalCount = 0;
    let jevEvalCount = 0;

    const mockClients: EvaluatorClients = {
      gemini: {
        classify: vi.fn().mockImplementation(async () => {
          geminiEvalCount++;
          return {
            category: 'NORMAL',
            action: 'POLITE_REPLY',
            risk: 10,
            reason: 'mock',
          };
        }),
      } as any,
      jev: {
        evaluate: vi.fn().mockImplementation(async () => {
          jevEvalCount++;
          return {
            category: 'NORMAL',
            action: 'POLITE_REPLY',
            risk: 10,
            reasonCode: 'JEV_NORMAL_CONVERSATION',
            reason: 'mock',
            success: true,
            signals: { categoryConfidence: 0.95 },
          };
        }),
      } as any,
    };

    const tempOutputDir = path.join(__dirname, 'temp-benchmark-output');
    if (!fs.existsSync(tempOutputDir)) fs.mkdirSync(tempOutputDir, { recursive: true });

    try {
      const output = await runBenchmark(
        {
          smoke: true, // 5 cases
          runs: 3,     // 3 repeated runs
          outputDir: tempOutputDir,
        },
        mockClients,
      );

      // 5 cases × 3 runs = 15 calls per model
      expect(geminiEvalCount).toBe(15);
      expect(jevEvalCount).toBe(15);

      expect(output.runs.length).toBe(3);
      expect(output.metadata.runsExecuted).toBe(3);
      expect(output.stability).toBeDefined();
      expect(output.stability?.geminiActionStability).toBe(1.0);
      expect(output.stability?.jevActionStability).toBe(1.0);

      // Verify separate run files exist
      const resultsDir = path.join(tempOutputDir, 'results');
      const files = fs.readdirSync(resultsDir);
      const individualRunFiles = files.filter((f) => f.startsWith('run-') && f.endsWith('.json'));
      expect(individualRunFiles.length).toBe(3);
      expect(files).toContain('benchmark-smoke-aggregate.json');
    } finally {
      fs.rmSync(tempOutputDir, { recursive: true, force: true });
    }
  });

  it('generates markdown report with global binary confusion matrix and neutral escalation headers', () => {
    const mockCaseResult: BenchmarkCaseResult = {
      id: 'DIS-01',
      group: 'CREDENTIAL_PHISHING',
      groundTruth: {
        category: 'SCAM',
        expectedAction: 'BLOCK_RECOMMENDED',
        securitySeverity: 4,
        expectedSignals: { credentialRequest: true, moneyRequest: false, threatOrUrgency: false, promptInjection: false, suspiciousExternalLink: false },
      },
      gemini: { category: 'SCAM', action: 'BLOCK_RECOMMENDED', risk: 90, latencyMs: 60, success: true },
      jev: { category: 'SCAM', action: 'POLITE_REPLY', risk: 10, latencyMs: 40, success: true },
      comparison: {
        geminiCategoryCorrect: true,
        jevCategoryCorrect: true,
        geminiActionCorrect: true,
        jevActionCorrect: false,
        categoryAgreement: true,
        actionAgreement: false,
        securityDirection: 'CRITICAL_JEV_UNDERSHOOT',
        isHighRiskGroundTruth: true,
        geminiUndershoot: false,
        jevUndershoot: true,
        geminiSeverityDelta: 0,
        jevSeverityDelta: -4,
      },
    };

    const metrics = aggregateBenchmarkMetrics([mockCaseResult]);
    const matrix = buildConfusionMatrix([mockCaseResult], 'gemini');
    const report = generateMarkdownReport([mockCaseResult], metrics, matrix, matrix, {
      runId: 'report-test-suite',
      timestamp: new Date().toISOString(),
      geminiModel: 'gemini-3.6-flash',
      jevModel: 'jev-system-one',
      datasetSize: 1,
      runsCount: 1,
    });

    expect(report).toContain('Global Binary Security Confusion Matrix');
    expect(report).toContain('Relative Escalation');
    expect(report).toContain('Mean Absolute Severity Error');
    expect(report).toContain('CRITICAL_JEV_UNDERSHOOT');
    expect(report).not.toContain('JEV_SAFER');
    expect(report).not.toContain('GEMINI_SAFER');
  });
});
