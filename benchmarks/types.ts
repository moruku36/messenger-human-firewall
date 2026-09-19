import { z } from 'zod';
import { ActionSchema, CategorySchema } from '../src/core/types.js';

export const SecuritySeveritySchema = z.union([
  z.literal(0), // harmless
  z.literal(1), // low concern / nuisance
  z.literal(2), // suspicious engagement
  z.literal(3), // high risk (human attention required)
  z.literal(4), // critical security risk (immediate block)
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

export const SecurityDirectionSchema = z.enum([
  'JEV_SAFER',
  'GEMINI_SAFER',
  'EQUIVALENT_SEVERITY',
  'CRITICAL_JEV_UNDERSHOOT',
  'CRITICAL_GEMINI_UNDERSHOOT',
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
}

export interface BenchmarkCaseResult {
  id: string;
  group: string;
  groundTruth: GroundTruth;
  gemini: SingleEvaluationResult;
  jev: SingleEvaluationResult;
  comparison: CaseComparison;
}

export interface BenchmarkRunOutput {
  metadata: {
    runId: string;
    timestamp: string;
    datasetSize: number;
    geminiModel: string;
    jevModel: string;
    runsCount: number;
    concurrency: number;
  };
  results: BenchmarkCaseResult[];
  aggregatedMetrics: AggregatedBenchmarkMetrics;
}

export interface CategoryMetrics {
  category: string;
  total: number;
  geminiTruePositives: number;
  jevTruePositives: number;
  geminiAccuracy: number;
  jevAccuracy: number;
}

export interface SecurityGroupMetrics {
  group: string;
  total: number;
  groundTruthCount: number;
  geminiDetectedCount: number;
  jevDetectedCount: number;
  geminiRecall: number;
  jevRecall: number;
  geminiPrecision: number;
  jevPrecision: number;
  geminiFalseNegativeRate: number;
  jevFalseNegativeRate: number;
  geminiFalsePositiveRate: number;
  jevFalsePositiveRate: number;
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
    geminiCategoryAccuracy: number;
    jevCategoryAccuracy: number;
    geminiActionAccuracy: number;
    jevActionAccuracy: number;
    categoryAgreement: number;
    actionAgreement: number;
    geminiSaferCount: number;
    jevSaferCount: number;
    equivalentSeverityCount: number;
    criticalJevUndershootCount: number;
    criticalGeminiUndershootCount: number;
  };
  security: {
    highRiskCasesTotal: number;
    geminiHighRiskRecall: number;
    jevHighRiskRecall: number;
    groupMetrics: Record<string, SecurityGroupMetrics>;
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
    actionMismatches: string[];
    categoryMismatches: string[];
  };
}
