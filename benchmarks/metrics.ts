import {
  type AggregatedBenchmarkMetrics,
  type BenchmarkCaseResult,
  type ConfusionMatrix,
  type LatencyStats,
  type SecurityGroupMetrics,
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
    const pred = res[target].category || 'UNKNOWN';
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

export function aggregateBenchmarkMetrics(results: BenchmarkCaseResult[]): AggregatedBenchmarkMetrics {
  const totalCases = results.length;
  let geminiSuccessCount = 0;
  let jevSuccessCount = 0;
  let geminiFailureCount = 0;
  let jevFailureCount = 0;

  let geminiCategoryCorrectCount = 0;
  let jevCategoryCorrectCount = 0;
  let geminiActionCorrectCount = 0;
  let jevActionCorrectCount = 0;

  let categoryAgreementCount = 0;
  let actionAgreementCount = 0;

  let geminiSaferCount = 0;
  let jevSaferCount = 0;
  let equivalentSeverityCount = 0;
  let criticalJevUndershootCount = 0;
  let criticalGeminiUndershootCount = 0;

  const geminiLatencies: number[] = [];
  const jevLatencies: number[] = [];

  const criticalJevUndershoots: string[] = [];
  const criticalGeminiUndershoots: string[] = [];
  const actionMismatches: string[] = [];
  const categoryMismatches: string[] = [];

  // Group-level aggregation
  const groupStats: Record<
    string,
    {
      total: number;
      geminiDetected: number;
      jevDetected: number;
      groundTruthPositive: number;
      geminiTP: number;
      jevTP: number;
      geminiFP: number;
      jevFP: number;
      geminiFN: number;
      jevFN: number;
      confidences: number[];
      signalSums: Record<string, number>;
      signalCounts: Record<string, number>;
    }
  > = {};

  const criticalGroups = new Set([
    'CREDENTIAL_PHISHING',
    'MONEY_REQUEST_SCAM',
    'PROMPT_INJECTION',
    'HARASSMENT_THREAT',
    'SCAM',
  ]);

  let highRiskCasesTotal = 0;
  let geminiHighRiskDetected = 0;
  let jevHighRiskDetected = 0;

  for (const r of results) {
    if (r.gemini.success) {
      geminiSuccessCount++;
      geminiLatencies.push(r.gemini.latencyMs);
    } else {
      geminiFailureCount++;
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

    if (r.comparison.securityDirection === 'JEV_SAFER') jevSaferCount++;
    else if (r.comparison.securityDirection === 'GEMINI_SAFER') geminiSaferCount++;
    else if (r.comparison.securityDirection === 'CRITICAL_JEV_UNDERSHOOT') {
      criticalJevUndershootCount++;
      criticalJevUndershoots.push(r.id);
    } else if (r.comparison.securityDirection === 'CRITICAL_GEMINI_UNDERSHOOT') {
      criticalGeminiUndershootCount++;
      criticalGeminiUndershoots.push(r.id);
    } else {
      equivalentSeverityCount++;
    }

    // High risk evaluation (Severity >= 3)
    if (r.comparison.isHighRiskGroundTruth) {
      highRiskCasesTotal++;
      if (!r.comparison.geminiUndershoot) geminiHighRiskDetected++;
      if (!r.comparison.jevUndershoot) jevHighRiskDetected++;
    }

    // Group stats
    if (!groupStats[r.group]) {
      groupStats[r.group] = {
        total: 0,
        geminiDetected: 0,
        jevDetected: 0,
        groundTruthPositive: 0,
        geminiTP: 0,
        jevTP: 0,
        geminiFP: 0,
        jevFP: 0,
        geminiFN: 0,
        jevFN: 0,
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
    if (criticalGroups.has(r.group)) {
      gs.groundTruthPositive++;
      // Detected as threat (action is not POLITE_REPLY)
      const geminiThreat = r.gemini.action && r.gemini.action !== 'POLITE_REPLY';
      const jevThreat = r.jev.action && r.jev.action !== 'POLITE_REPLY';

      if (geminiThreat) {
        gs.geminiDetected++;
        gs.geminiTP++;
      } else {
        gs.geminiFN++;
      }

      if (jevThreat) {
        gs.jevDetected++;
        gs.jevTP++;
      } else {
        gs.jevFN++;
      }
    } else {
      // Normal / non-threat groups: Check if incorrectly escalated (False Positive)
      const geminiFalseEscalation = r.gemini.action === 'BLOCK_RECOMMENDED' || r.gemini.action === 'HUMAN_REQUIRED';
      const jevFalseEscalation = r.jev.action === 'BLOCK_RECOMMENDED' || r.jev.action === 'HUMAN_REQUIRED';
      if (geminiFalseEscalation) gs.geminiFP++;
      if (jevFalseEscalation) gs.jevFP++;
    }

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

  // Compile SecurityGroupMetrics
  const groupMetrics: Record<string, SecurityGroupMetrics> = {};
  const averageConfidenceByGroup: Record<string, number> = {};
  const averageProbabilitiesByGroup: Record<string, Record<string, number>> = {};

  for (const [groupName, s] of Object.entries(groupStats)) {
    const geminiRecall = s.groundTruthPositive > 0 ? Math.round((s.geminiTP / s.groundTruthPositive) * 100) / 100 : 1;
    const jevRecall = s.groundTruthPositive > 0 ? Math.round((s.jevTP / s.groundTruthPositive) * 100) / 100 : 1;
    const geminiPrecision = s.geminiDetected > 0 ? Math.round((s.geminiTP / s.geminiDetected) * 100) / 100 : 1;
    const jevPrecision = s.jevDetected > 0 ? Math.round((s.jevTP / s.jevDetected) * 100) / 100 : 1;
    const geminiFalseNegativeRate = Math.round((1 - geminiRecall) * 100) / 100;
    const jevFalseNegativeRate = Math.round((1 - jevRecall) * 100) / 100;
    const geminiFalsePositiveRate = s.total > 0 ? Math.round((s.geminiFP / s.total) * 100) / 100 : 0;
    const jevFalsePositiveRate = s.total > 0 ? Math.round((s.jevFP / s.total) * 100) / 100 : 0;

    groupMetrics[groupName] = {
      group: groupName,
      total: s.total,
      groundTruthCount: s.groundTruthPositive,
      geminiDetectedCount: s.geminiDetected,
      jevDetectedCount: s.jevDetected,
      geminiRecall,
      jevRecall,
      geminiPrecision,
      jevPrecision,
      geminiFalseNegativeRate,
      jevFalseNegativeRate,
      geminiFalsePositiveRate,
      jevFalsePositiveRate,
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

  return {
    overall: {
      totalCases,
      geminiSuccessCount,
      jevSuccessCount,
      geminiFailureCount,
      jevFailureCount,
      geminiCategoryAccuracy: Math.round((geminiCategoryCorrectCount / totalCases) * 100) / 100,
      jevCategoryAccuracy: Math.round((jevCategoryCorrectCount / totalCases) * 100) / 100,
      geminiActionAccuracy: Math.round((geminiActionCorrectCount / totalCases) * 100) / 100,
      jevActionAccuracy: Math.round((jevActionCorrectCount / totalCases) * 100) / 100,
      categoryAgreement: Math.round((categoryAgreementCount / totalCases) * 100) / 100,
      actionAgreement: Math.round((actionAgreementCount / totalCases) * 100) / 100,
      geminiSaferCount,
      jevSaferCount,
      equivalentSeverityCount,
      criticalJevUndershootCount,
      criticalGeminiUndershootCount,
    },
    security: {
      highRiskCasesTotal,
      geminiHighRiskRecall: highRiskCasesTotal > 0 ? Math.round((geminiHighRiskDetected / highRiskCasesTotal) * 100) / 100 : 1,
      jevHighRiskRecall: highRiskCasesTotal > 0 ? Math.round((jevHighRiskDetected / highRiskCasesTotal) * 100) / 100 : 1,
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
      actionMismatches,
      categoryMismatches,
    },
  };
}
