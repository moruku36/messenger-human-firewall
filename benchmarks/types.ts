import { z } from 'zod';
import { ActionSchema, CategorySchema } from '../src/core/types.js';

export const SecuritySeveritySchema = z.union([
  z.literal(0), // harmless (POLITE_REPLY / NORMAL)
  z.literal(1), // low concern / nuisance (TIME_WASTER / IGNORE)
  z.literal(2), // suspicious engagement (unverified link / probing)
  z.literal(3), // high risk (HUMAN_REQUIRED / acute threat / harassment)
  z.literal(4), // critical security risk (BLOCK_RECOMMENDED / credential theft / money extortion / prompt injection)
]);
export type SecuritySeverity = z.infer<typeof SecuritySeveritySchema>;

export const ExpectedSignalsSchema = z.object({
  credentialRequest: z.boolean(),
  moneyRequest: z.boolean(),
  threatOrUrgency: z.boolean(),
  promptInjection: z.boolean(),
  suspiciousExternalLink: z.boolean(),
});
export type ExpectedSignals = z.infer<typeof ExpectedSignalsSchema>;

export const GroundTruthSchema = z.object({
  category: CategorySchema,
  expectedAction: ActionSchema,
  securitySeverity: SecuritySeveritySchema,
  expectedSignals: ExpectedSignalsSchema,
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

export const BenchmarkCaseSchema = z.object({
  id: z.string().min(1),
  group: z.enum([
    'NORMAL',
    'SALES',
    'SPAM',
    'SCAM',
    'CREDENTIAL_PHISHING',
    'MONEY_REQUEST_SCAM',
    'PROMPT_INJECTION',
    'HARASSMENT_THREAT',
    'SUSPICIOUS_EXTERNAL_LINK',
    'AMBIGUOUS_MULTILINGUAL',
  ]),
  message: z.string().min(1),
  language: z.enum(['ja', 'en', 'mixed']),
  groundTruth: GroundTruthSchema,
  notes: z.string().min(1),
});
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export const BenchmarkDatasetSchema = z.array(BenchmarkCaseSchema).min(100);
export type BenchmarkDataset = z.infer<typeof BenchmarkDatasetSchema>;

/**
 * Objective direction of escalation relative to each other and ground truth
 */
export const SecurityDirectionSchema = z.enum([
  'JEV_MORE_ESCALATED',
  'GEMINI_MORE_ESCALATED',
  'EQUIVALENT_ESCALATION',
  'CRITICAL_JEV_UNDERSHOOT',
  'CRITICAL_GEMINI_UNDERSHOOT',
  'BOTH_CRITICAL_UNDERSHOOT',
]);
export type SecurityDirection = z.infer<typeof SecurityDirectionSchema>;

export interface SingleEvaluationResult {
  category?: string;
  action?: string;
  risk?: number;
  confidence?: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  signals?: Record<string, number>;
  triggeredSignals?: string[];
  primarySignal?: string;
}

export interface CaseComparison {
  geminiCategoryCorrect: boolean;
  jevCategoryCorrect: boolean;
  geminiActionCorrect: boolean;
  jevActionCorrect: boolean;
  categoryAgreement: boolean;
  actionAgreement: boolean;
  securityDirection: SecurityDirection;
  isHighRiskGroundTruth: boolean;
  geminiUndershoot: boolean;
  jevUndershoot: boolean;
  geminiSeverityDelta: number; // predicted severity - ground truth severity
  jevSeverityDelta: number;    // predicted severity - ground truth severity
}

export interface BenchmarkCaseResult {
  id: string;
  group: string;
  groundTruth: GroundTruth;
  gemini: SingleEvaluationResult;
  jev: SingleEvaluationResult;
  comparison: CaseComparison;
}

export interface BinaryConfusionMatrix {
  tp: number; // Actual High Risk & Predicted High Risk
  fp: number; // Actual Not High Risk & Predicted High Risk
  fn: number; // Actual High Risk & Predicted Not High Risk (or Failed)
  tn: number; // Actual Not High Risk & Predicted Not High Risk
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  specificity: number;
}

export interface SeverityDistanceMetrics {
  exactActionMatches: number;
  overEscalationCount: number;
  underEscalationCount: number;
  meanAbsoluteSeverityError: number;
}

export interface GroupEvaluationMetrics {
  group: string;
  total: number;
  groundTruthHighRisk: boolean;
  geminiDetectedCount: number;
  jevDetectedCount: number;
  geminiDetectionRate: number;
  jevDetectionRate: number;
  geminiActionAccuracy: number;
  jevActionAccuracy: number;
  geminiCategoryAccuracy: number;
  jevCategoryAccuracy: number;
}

export interface LatencyStats {
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

export interface ConfusionMatrix {
  labels: string[];
  matrix: Record<string, Record<string, number>>;
}

export interface AggregatedBenchmarkMetrics {
  overall: {
    totalCases: number;
    geminiSuccessCount: number;
    jevSuccessCount: number;
    geminiFailureCount: number;
    jevFailureCount: number;

    // End-to-End Accuracy (denominator = totalCases)
    geminiEndToEndCategoryAccuracy: number;
    jevEndToEndCategoryAccuracy: number;
    geminiEndToEndActionAccuracy: number;
    jevEndToEndActionAccuracy: number;

    // Successful-Call-Only Accuracy (denominator = successCount)
    geminiConditionalCategoryAccuracy: number;
    jevConditionalCategoryAccuracy: number;
    geminiConditionalActionAccuracy: number;
    jevConditionalActionAccuracy: number;

    categoryAgreement: number;
    actionAgreement: number;

    geminiMoreEscalatedCount: number;
    jevMoreEscalatedCount: number;
    equivalentEscalationCount: number;
    criticalJevUndershootCount: number;
    criticalGeminiUndershootCount: number;
    bothCriticalUndershootCount: number;
  };
  security: {
    highRiskCasesTotal: number;
    // End-to-End High Risk Recall (failures count as missed/FN)
    geminiEndToEndHighRiskRecall: number;
    jevEndToEndHighRiskRecall: number;
    // Conditional High Risk Recall (only on successful responses)
    geminiConditionalHighRiskRecall: number;
    jevConditionalHighRiskRecall: number;

    // Global Binary Confusion Matrix across all 100 cases
    geminiBinaryMatrix: BinaryConfusionMatrix;
    jevBinaryMatrix: BinaryConfusionMatrix;

    // Severity Distance metrics
    geminiSeverityDistance: SeverityDistanceMetrics;
    jevSeverityDistance: SeverityDistanceMetrics;

    // Group evaluation metrics
    groupMetrics: Record<string, GroupEvaluationMetrics>;
  };
  latency: {
    gemini: LatencyStats;
    jev: LatencyStats;
  };
  signals: {
    averageConfidenceByGroup: Record<string, number>;
    averageProbabilitiesByGroup: Record<string, Record<string, number>>;
  };
  disagreements: {
    criticalJevUndershoots: string[];
    criticalGeminiUndershoots: string[];
    bothCriticalUndershoots: string[];
    actionMismatches: string[];
    categoryMismatches: string[];
  };
}

export interface SingleRunRecord {
  runIndex: number;
  runId: string;
  timestamp: string;
  results: BenchmarkCaseResult[];
  aggregatedMetrics: AggregatedBenchmarkMetrics;
}

export interface MultiRunBenchmarkOutput {
  metadata: {
    benchmarkSuiteId: string;
    timestamp: string;
    datasetSize: number;
    geminiModel: string;
    jevModel: string;
    runsRequested: number;
    runsExecuted: number;
    concurrency: number;
  };
  runs: SingleRunRecord[];
  stability?: {
    geminiCategoryStability: number;
    geminiActionStability: number;
    jevCategoryStability: number;
    jevActionStability: number;
    jevConfidenceVarianceMean: number;
  };
  primaryMetrics: AggregatedBenchmarkMetrics;
}
