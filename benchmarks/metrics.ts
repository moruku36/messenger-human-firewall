import {
  type AggregatedBenchmarkMetrics,
  type BenchmarkCaseResult,
  type BinaryConfusionMatrix,
  type ConfusionMatrix,
  type GroupEvaluationMetrics,
  type LatencyStats,
  type SeverityDistanceMetrics,
} from './types.js';

export function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (lower === upper) return sorted[index];
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

export function calculateLatencyStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { mean: 0, p50: 0, p95: 0, min: 0, max: 0 };
  }
  const sum = latencies.reduce((a, b) => a + b, 0);
  const mean = Math.round(sum / latencies.length);
  const p50 = calculatePercentile(latencies, 50);
  const p95 = calculatePercentile(latencies, 95);
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  return { mean, p50, p95, min, max };
}

export function buildConfusionMatrix(
  results: BenchmarkCaseResult[],
  target: 'gemini' | 'jev',
  labels = ['NORMAL', 'SALES', 'SPAM', 'SCAM', 'HARASSMENT', 'UNKNOWN'],
): ConfusionMatrix {
  const matrix: Record<string, Record<string, number>> = {};
  for (const actual of labels) {
    matrix[actual] = {};
    for (const pred of labels) {
      matrix[actual][pred] = 0;
    }
  }

  for (const res of results) {
    const actual = res.groundTruth.category;
    const pred = res[target].success ? (res[target].category || 'UNKNOWN') : 'UNKNOWN';
    if (matrix[actual] && matrix[actual][pred] !== undefined) {
      matrix[actual][pred] += 1;
    } else {
      if (!matrix[actual]) matrix[actual] = {};
      matrix[actual][pred] = (matrix[actual][pred] || 0) + 1;
    }
  }

  return { labels, matrix };
}

export function confusionMatrixToCsv(matrixData: ConfusionMatrix): string {
  const { labels, matrix } = matrixData;
  const header = ['Actual \\ Predicted', ...labels].join(',');
  const rows = labels.map((actual) => {
    const rowValues = labels.map((pred) => matrix[actual]?.[pred] ?? 0);
    return [actual, ...rowValues].join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * Calculates Global Binary Security Confusion Matrix across the full dataset.
 * Actual Positive: groundTruth.securitySeverity >= 3 (High Risk)
 * Predicted Positive: predicted action is HUMAN_REQUIRED or BLOCK_RECOMMENDED (and success = true)
 */
export function calculateBinaryConfusionMatrix(
  results: BenchmarkCaseResult[],
  target: 'gemini' | 'jev',
): BinaryConfusionMatrix {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const r of results) {
    const actualHighRisk = r.groundTruth.securitySeverity >= 3;
    const evalResult = r[target];
    const predictedHighRisk = Boolean(
      evalResult.success &&
        (evalResult.action === 'HUMAN_REQUIRED' || evalResult.action === 'BLOCK_RECOMMENDED'),
    );

    if (actualHighRisk && predictedHighRisk) {
      tp++;
    } else if (!actualHighRisk && predictedHighRisk) {
      fp++;
    } else if (actualHighRisk && !predictedHighRisk) {
      fn++; // Note: API failure on high-risk is strictly captured here as False Negative
    } else {
      tn++;
    }
  }

  const precision = tp + fp > 0 ? Math.round((tp / (tp + fp)) * 1000) / 1000 : 0;
  const recall = tp + fn > 0 ? Math.round((tp / (tp + fn)) * 1000) / 1000 : 0;
  const f1 = precision + recall > 0 ? Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000 : 0;
  const falsePositiveRate = fp + tn > 0 ? Math.round((fp / (fp + tn)) * 1000) / 1000 : 0;
  const falseNegativeRate = tp + fn > 0 ? Math.round((fn / (tp + fn)) * 1000) / 1000 : 0;
  const specificity = fp + tn > 0 ? Math.round((tn / (fp + tn)) * 1000) / 1000 : 0;

  return {
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1,
    falsePositiveRate,
    falseNegativeRate,
    specificity,
  };
}

export function calculateSeverityDistance(
  results: BenchmarkCaseResult[],
  target: 'gemini' | 'jev',
): SeverityDistanceMetrics {
  let exactActionMatches = 0;
  let overEscalationCount = 0;
  let underEscalationCount = 0;
  let totalAbsDelta = 0;

  for (const r of results) {
    const delta = target === 'gemini' ? r.comparison.geminiSeverityDelta : r.comparison.jevSeverityDelta;
    totalAbsDelta += Math.abs(delta);

    if (r.comparison[target === 'gemini' ? 'geminiActionCorrect' : 'jevActionCorrect']) {
      exactActionMatches++;
    }

    if (delta > 0) {
      overEscalationCount++;
    } else if (delta < 0) {
      underEscalationCount++;
    }
  }

  const meanAbsoluteSeverityError =
    results.length > 0 ? Math.round((totalAbsDelta / results.length) * 100) / 100 : 0;

  return {
    exactActionMatches,
    overEscalationCount,
    underEscalationCount,
    meanAbsoluteSeverityError,
  };
}

export function aggregateBenchmarkMetrics(results: BenchmarkCaseResult[]): AggregatedBenchmarkMetrics {
  const totalCases = results.length;
  let geminiSuccessCount = 0;
  let jevSuccessCount = 0;
  let geminiFailureCount = 0;
  let jevFailureCount = 0;

  let geminiApiErrors = 0;
  let geminiJsonParseErrors = 0;
  let geminiSchemaErrors = 0;
  let geminiEmptyResponses = 0;
  let geminiOtherErrors = 0;
  let geminiGenuineUnknownCount = 0;

  const geminiLatencies: number[] = [];
  const jevLatencies: number[] = [];

  let geminiCategoryCorrectCount = 0;
  let jevCategoryCorrectCount = 0;
  let geminiActionCorrectCount = 0;
  let jevActionCorrectCount = 0;
  let categoryAgreementCount = 0;
  let actionAgreementCount = 0;

  let geminiMoreEscalatedCount = 0;
  let jevMoreEscalatedCount = 0;
  let equivalentEscalationCount = 0;
  let criticalJevUndershootCount = 0;
  let criticalGeminiUndershootCount = 0;
  let bothCriticalUndershootCount = 0;

  const criticalJevUndershoots: string[] = [];
  const criticalGeminiUndershoots: string[] = [];
  const bothCriticalUndershoots: string[] = [];
  const actionMismatches: string[] = [];
  const categoryMismatches: string[] = [];

  // Group stats
  const groupStats: Record<
    string,
    {
      total: number;
      groundTruthHighRisk: boolean;
      geminiDetected: number;
      jevDetected: number;
      geminiActionCorrect: number;
      jevActionCorrect: number;
      geminiCategoryCorrect: number;
      jevCategoryCorrect: number;
      confidences: number[];
      signalSums: Record<string, number>;
      signalCounts: Record<string, number>;
    }
  > = {};

  let highRiskCasesTotal = 0;
  let geminiHighRiskDetectedEndToEnd = 0;
  let jevHighRiskDetectedEndToEnd = 0;
  let geminiHighRiskDetectedConditional = 0;
  let jevHighRiskDetectedConditional = 0;
  let geminiHighRiskEvaluatedCount = 0;
  let jevHighRiskEvaluatedCount = 0;

  for (const r of results) {
    if (r.gemini.success) {
      geminiSuccessCount++;
      geminiLatencies.push(r.gemini.latencyMs);
      if (r.gemini.category === 'UNKNOWN') {
        geminiGenuineUnknownCount++;
      }
    } else {
      geminiFailureCount++;
      switch (r.gemini.errorCode) {
        case 'API_ERROR':
        case 'GEMINI_API_ERROR':
          geminiApiErrors++;
          break;
        case 'JSON_PARSE_ERROR':
          geminiJsonParseErrors++;
          break;
        case 'SCHEMA_ERROR':
          geminiSchemaErrors++;
          break;
        case 'EMPTY_RESPONSE':
          geminiEmptyResponses++;
          break;
        default:
          geminiOtherErrors++;
          break;
      }
    }

    if (r.jev.success) {
      jevSuccessCount++;
      jevLatencies.push(r.jev.latencyMs);
    } else {
      jevFailureCount++;
    }

    if (r.comparison.geminiCategoryCorrect) geminiCategoryCorrectCount++;
    if (r.comparison.jevCategoryCorrect) jevCategoryCorrectCount++;
    if (r.comparison.geminiActionCorrect) geminiActionCorrectCount++;
    if (r.comparison.jevActionCorrect) jevActionCorrectCount++;

    if (r.comparison.categoryAgreement) categoryAgreementCount++;
    else categoryMismatches.push(r.id);

    if (r.comparison.actionAgreement) actionAgreementCount++;
    else actionMismatches.push(r.id);

    // Escalation direction counts
    switch (r.comparison.securityDirection) {
      case 'JEV_MORE_ESCALATED':
        jevMoreEscalatedCount++;
        break;
      case 'GEMINI_MORE_ESCALATED':
        geminiMoreEscalatedCount++;
        break;
      case 'CRITICAL_JEV_UNDERSHOOT':
        criticalJevUndershootCount++;
        criticalJevUndershoots.push(r.id);
        break;
      case 'CRITICAL_GEMINI_UNDERSHOOT':
        criticalGeminiUndershootCount++;
        criticalGeminiUndershoots.push(r.id);
        break;
      case 'BOTH_CRITICAL_UNDERSHOOT':
        bothCriticalUndershootCount++;
        bothCriticalUndershoots.push(r.id);
        break;
      case 'EQUIVALENT_ESCALATION':
      default:
        equivalentEscalationCount++;
        break;
    }

    // High risk ground truth analysis (severity >= 3)
    if (r.comparison.isHighRiskGroundTruth) {
      highRiskCasesTotal++;

      // End-to-End High-Risk Recall: must be successful AND not undershot
      if (r.gemini.success && !r.comparison.geminiUndershoot) {
        geminiHighRiskDetectedEndToEnd++;
      }
      if (r.jev.success && !r.comparison.jevUndershoot) {
        jevHighRiskDetectedEndToEnd++;
      }

      // Conditional High-Risk Recall (denominator = successfully evaluated high risk calls)
      if (r.gemini.success) {
        geminiHighRiskEvaluatedCount++;
        if (!r.comparison.geminiUndershoot) geminiHighRiskDetectedConditional++;
      }
      if (r.jev.success) {
        jevHighRiskEvaluatedCount++;
        if (!r.comparison.jevUndershoot) jevHighRiskDetectedConditional++;
      }
    }

    // Group breakdown
    if (!groupStats[r.group]) {
      groupStats[r.group] = {
        total: 0,
        groundTruthHighRisk: r.groundTruth.securitySeverity >= 3,
        geminiDetected: 0,
        jevDetected: 0,
        geminiActionCorrect: 0,
        jevActionCorrect: 0,
        geminiCategoryCorrect: 0,
        jevCategoryCorrect: 0,
        confidences: [],
        signalSums: {
          credentialRequest: 0,
          moneyRequest: 0,
          threatOrUrgency: 0,
          promptInjection: 0,
          suspiciousExternalLink: 0,
          overallRisk: 0,
        },
        signalCounts: {
          credentialRequest: 0,
          moneyRequest: 0,
          threatOrUrgency: 0,
          promptInjection: 0,
          suspiciousExternalLink: 0,
          overallRisk: 0,
        },
      };
    }

    const gs = groupStats[r.group];
    gs.total++;

    const isHighRiskAction = (act?: string, succ = true) =>
      Boolean(succ && (act === 'HUMAN_REQUIRED' || act === 'BLOCK_RECOMMENDED'));

    if (isHighRiskAction(r.gemini.action, r.gemini.success)) gs.geminiDetected++;
    if (isHighRiskAction(r.jev.action, r.jev.success)) gs.jevDetected++;

    if (r.comparison.geminiActionCorrect) gs.geminiActionCorrect++;
    if (r.comparison.jevActionCorrect) gs.jevActionCorrect++;
    if (r.comparison.geminiCategoryCorrect) gs.geminiCategoryCorrect++;
    if (r.comparison.jevCategoryCorrect) gs.jevCategoryCorrect++;

    if (r.jev.confidence !== undefined) {
      gs.confidences.push(r.jev.confidence);
    }
    if (r.jev.signals) {
      for (const [k, v] of Object.entries(r.jev.signals)) {
        if (typeof v === 'number') {
          gs.signalSums[k] = (gs.signalSums[k] || 0) + v;
          gs.signalCounts[k] = (gs.signalCounts[k] || 0) + 1;
        }
      }
    }
  }

  // Compile Group Evaluation Metrics
  const groupMetrics: Record<string, GroupEvaluationMetrics> = {};
  const averageConfidenceByGroup: Record<string, number> = {};
  const averageProbabilitiesByGroup: Record<string, Record<string, number>> = {};

  for (const [groupName, s] of Object.entries(groupStats)) {
    groupMetrics[groupName] = {
      group: groupName,
      total: s.total,
      groundTruthHighRisk: s.groundTruthHighRisk,
      geminiDetectedCount: s.geminiDetected,
      jevDetectedCount: s.jevDetected,
      geminiDetectionRate: s.total > 0 ? Math.round((s.geminiDetected / s.total) * 100) / 100 : 0,
      jevDetectionRate: s.total > 0 ? Math.round((s.jevDetected / s.total) * 100) / 100 : 0,
      geminiActionAccuracy: s.total > 0 ? Math.round((s.geminiActionCorrect / s.total) * 100) / 100 : 0,
      jevActionAccuracy: s.total > 0 ? Math.round((s.jevActionCorrect / s.total) * 100) / 100 : 0,
      geminiCategoryAccuracy: s.total > 0 ? Math.round((s.geminiCategoryCorrect / s.total) * 100) / 100 : 0,
      jevCategoryAccuracy: s.total > 0 ? Math.round((s.jevCategoryCorrect / s.total) * 100) / 100 : 0,
    };

    if (s.confidences.length > 0) {
      const avgConf = s.confidences.reduce((a, b) => a + b, 0) / s.confidences.length;
      averageConfidenceByGroup[groupName] = Math.round(avgConf * 100) / 100;
    } else {
      averageConfidenceByGroup[groupName] = 0;
    }

    averageProbabilitiesByGroup[groupName] = {};
    for (const [sigKey, sumVal] of Object.entries(s.signalSums)) {
      const countVal = s.signalCounts[sigKey] || 1;
      averageProbabilitiesByGroup[groupName][sigKey] = Math.round((sumVal / countVal) * 100) / 100;
    }
  }

  // Global binary confusion matrix
  const geminiBinaryMatrix = calculateBinaryConfusionMatrix(results, 'gemini');
  const jevBinaryMatrix = calculateBinaryConfusionMatrix(results, 'jev');

  // Severity distance
  const geminiSeverityDistance = calculateSeverityDistance(results, 'gemini');
  const jevSeverityDistance = calculateSeverityDistance(results, 'jev');

  return {
    overall: {
      totalCases,
      geminiSuccessCount,
      jevSuccessCount,
      geminiFailureCount,
      jevFailureCount,

      geminiApiErrors,
      geminiJsonParseErrors,
      geminiSchemaErrors,
      geminiEmptyResponses,
      geminiOtherErrors,
      geminiGenuineUnknownCount,

      // End-to-End
      geminiEndToEndCategoryAccuracy: totalCases > 0 ? Math.round((geminiCategoryCorrectCount / totalCases) * 1000) / 1000 : 0,
      jevEndToEndCategoryAccuracy: totalCases > 0 ? Math.round((jevCategoryCorrectCount / totalCases) * 1000) / 1000 : 0,
      geminiEndToEndActionAccuracy: totalCases > 0 ? Math.round((geminiActionCorrectCount / totalCases) * 1000) / 1000 : 0,
      jevEndToEndActionAccuracy: totalCases > 0 ? Math.round((jevActionCorrectCount / totalCases) * 1000) / 1000 : 0,

      // Conditional on successful calls
      geminiConditionalCategoryAccuracy:
        geminiSuccessCount > 0 ? Math.round((geminiCategoryCorrectCount / geminiSuccessCount) * 1000) / 1000 : 0,
      jevConditionalCategoryAccuracy:
        jevSuccessCount > 0 ? Math.round((jevCategoryCorrectCount / jevSuccessCount) * 1000) / 1000 : 0,
      geminiConditionalActionAccuracy:
        geminiSuccessCount > 0 ? Math.round((geminiActionCorrectCount / geminiSuccessCount) * 1000) / 1000 : 0,
      jevConditionalActionAccuracy:
        jevSuccessCount > 0 ? Math.round((jevActionCorrectCount / jevSuccessCount) * 1000) / 1000 : 0,

      categoryAgreement: totalCases > 0 ? Math.round((categoryAgreementCount / totalCases) * 1000) / 1000 : 0,
      actionAgreement: totalCases > 0 ? Math.round((actionAgreementCount / totalCases) * 1000) / 1000 : 0,

      geminiMoreEscalatedCount,
      jevMoreEscalatedCount,
      equivalentEscalationCount,
      criticalJevUndershootCount,
      criticalGeminiUndershootCount,
      bothCriticalUndershootCount,
    },
    security: {
      highRiskCasesTotal,
      geminiEndToEndHighRiskRecall:
        highRiskCasesTotal > 0 ? Math.round((geminiHighRiskDetectedEndToEnd / highRiskCasesTotal) * 1000) / 1000 : 1,
      jevEndToEndHighRiskRecall:
        highRiskCasesTotal > 0 ? Math.round((jevHighRiskDetectedEndToEnd / highRiskCasesTotal) * 1000) / 1000 : 1,
      geminiConditionalHighRiskRecall:
        geminiHighRiskEvaluatedCount > 0
          ? Math.round((geminiHighRiskDetectedConditional / geminiHighRiskEvaluatedCount) * 1000) / 1000
          : 1,
      jevConditionalHighRiskRecall:
        jevHighRiskEvaluatedCount > 0
          ? Math.round((jevHighRiskDetectedConditional / jevHighRiskEvaluatedCount) * 1000) / 1000
          : 1,
      geminiBinaryMatrix,
      jevBinaryMatrix,
      geminiSeverityDistance,
      jevSeverityDistance,
      groupMetrics,
    },
    latency: {
      gemini: calculateLatencyStats(geminiLatencies),
      jev: calculateLatencyStats(jevLatencies),
    },
    signals: {
      averageConfidenceByGroup,
      averageProbabilitiesByGroup,
    },
    disagreements: {
      criticalJevUndershoots,
      criticalGeminiUndershoots,
      bothCriticalUndershoots,
      actionMismatches,
      categoryMismatches,
    },
  };
}
