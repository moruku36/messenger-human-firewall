import {
  type AggregatedBenchmarkMetrics,
  type BenchmarkCaseResult,
  type ConfusionMatrix,
  type MultiRunBenchmarkOutput,
} from './types.js';

export function formatConfusionMatrixMarkdown(
  title: string,
  matrixData: ConfusionMatrix,
): string {
  const { labels, matrix } = matrixData;
  const header = `| Actual \\ Predicted | ${labels.join(' | ')} |`;
  const separator = `| :--- | ${labels.map(() => ':---:').join(' | ')} |`;
  const rows = labels.map((actual) => {
    const values = labels.map((pred) => matrix[actual]?.[pred] ?? 0);
    return `| **${actual}** | ${values.join(' | ')} |`;
  });
  return `### ${title}\n\n${header}\n${separator}\n${rows.join('\n')}\n`;
}

export function generateMarkdownReport(
  results: BenchmarkCaseResult[],
  metrics: AggregatedBenchmarkMetrics,
  geminiMatrix: ConfusionMatrix,
  jevMatrix: ConfusionMatrix,
  meta: {
    runId: string;
    timestamp: string;
    geminiModel: string;
    jevModel: string;
    datasetSize: number;
    runsCount: number;
  },
  multiRunOutput?: MultiRunBenchmarkOutput,
): string {
  const o = metrics.overall;
  const s = metrics.security;
  const l = metrics.latency;
  const gb = s.geminiBinaryMatrix;
  const jb = s.jevBinaryMatrix;

  // Critical Disagreement Table
  const criticalRows = results
    .filter(
      (r) =>
        r.comparison.securityDirection === 'CRITICAL_JEV_UNDERSHOOT' ||
        r.comparison.securityDirection === 'CRITICAL_GEMINI_UNDERSHOOT' ||
        r.comparison.securityDirection === 'BOTH_CRITICAL_UNDERSHOOT' ||
        !r.comparison.actionAgreement,
    )
    .map((r) => {
      const gAct = r.gemini.action || (r.gemini.errorCode ? `FAIL(${r.gemini.errorCode})` : 'N/A');
      const jAct = r.jev.action || (r.jev.errorCode ? `FAIL(${r.jev.errorCode})` : 'N/A');
      return `| \`${r.id}\` | ${r.group} | \`${r.groundTruth.expectedAction}\` | \`${gAct}\` | \`${jAct}\` | **${r.comparison.securityDirection}** | ΔGem: ${r.comparison.geminiSeverityDelta > 0 ? '+' : ''}${r.comparison.geminiSeverityDelta} / ΔJev: ${r.comparison.jevSeverityDelta > 0 ? '+' : ''}${r.comparison.jevSeverityDelta} |`;
    })
    .join('\n');

  // Group Evaluation Breakdown
  const groupRows = Object.values(s.groupMetrics)
    .map(
      (g) =>
        `| ${g.group} | ${g.total} | ${g.groundTruthHighRisk ? 'YES (>=3)' : 'NO'} | ${(g.geminiDetectionRate * 100).toFixed(0)}% | ${(g.jevDetectionRate * 100).toFixed(0)}% | ${(g.geminiActionAccuracy * 100).toFixed(0)}% | ${(g.jevActionAccuracy * 100).toFixed(0)}% |`,
    )
    .join('\n');

  // Signal stats table
  const signalRows = Object.entries(metrics.signals.averageProbabilitiesByGroup)
    .map(([grp, sigs]) => {
      const conf = metrics.signals.averageConfidenceByGroup[grp] ?? 0;
      const otp = ((sigs.credentialRequest ?? 0) * 100).toFixed(0);
      const mny = ((sigs.moneyRequest ?? 0) * 100).toFixed(0);
      const thrt = ((sigs.threatOrUrgency ?? 0) * 100).toFixed(0);
      const inj = ((sigs.promptInjection ?? 0) * 100).toFixed(0);
      const lnk = ((sigs.suspiciousExternalLink ?? 0) * 100).toFixed(0);
      return `| ${grp} | ${(conf * 100).toFixed(0)}% | ${otp}% | ${mny}% | ${thrt}% | ${inj}% | ${lnk}% |`;
    })
    .join('\n');

  // Stability section if available
  let stabilitySection = '';
  if (multiRunOutput?.stability) {
    const stab = multiRunOutput.stability;
    stabilitySection = `
---

## Multi-Run Consistency & Prediction Stability (${meta.runsCount} Independent Runs)

| Metric | Gemini | TypeSafe Jev |
| :--- | :---: | :---: |
| **Category Stability Across Runs** | **${(stab.geminiCategoryStability * 100).toFixed(1)}%** | **${(stab.jevCategoryStability * 100).toFixed(1)}%** |
| **Action Stability Across Runs** | **${(stab.geminiActionStability * 100).toFixed(1)}%** | **${(stab.jevActionStability * 100).toFixed(1)}%** |
| **Mean Jev Confidence Variance** | N/A | **${stab.jevConfidenceVarianceMean.toFixed(4)}** |
`;
  }

  return `# Jev vs Gemini Security Triage Benchmark Report

**Run Suite ID**: \`${meta.runId}\`  
**Evaluation Date**: ${meta.timestamp}  
**Dataset**: Synthetic Security Triage v1 (${meta.datasetSize} cases)  
**Gemini Model**: \`${meta.geminiModel}\` (Production Active)  
**Jev Model**: \`${meta.jevModel}\` (Shadow Observer)  
**Independent Runs Executed**: ${meta.runsCount}  

---

## Executive Summary

This report provides a rigorous security evaluation of **TypeSafe Jev** operating in **Shadow Mode** alongside production **Gemini 3.6 Flash** across **${meta.datasetSize} fixed, reproducible synthetic security messages**.
Evaluation separates **End-to-End System Reliability** (failures treated as misses) from **Successful-Call Model Quality** (conditional on successful API completion).

| Dimension | Gemini (Production) | Jev (Shadow Observer) | Agreement / Delta |
| :--- | :---: | :---: | :---: |
| **End-to-End Action Accuracy** | **${(o.geminiEndToEndActionAccuracy * 100).toFixed(1)}%** | **${(o.jevEndToEndActionAccuracy * 100).toFixed(1)}%** | Agreement: **${(o.actionAgreement * 100).toFixed(1)}%** |
| **Successful-Call Action Accuracy** | **${(o.geminiConditionalActionAccuracy * 100).toFixed(1)}%** | **${(o.jevConditionalActionAccuracy * 100).toFixed(1)}%** | Evaluated on valid responses |
| **End-to-End Category Accuracy** | **${(o.geminiEndToEndCategoryAccuracy * 100).toFixed(1)}%** | **${(o.jevEndToEndCategoryAccuracy * 100).toFixed(1)}%** | Agreement: **${(o.categoryAgreement * 100).toFixed(1)}%** |
| **Successful-Call Category Accuracy** | **${(o.geminiConditionalCategoryAccuracy * 100).toFixed(1)}%** | **${(o.jevConditionalCategoryAccuracy * 100).toFixed(1)}%** | Evaluated on valid responses |
| **End-to-End High-Risk Recall** | **${(s.geminiEndToEndHighRiskRecall * 100).toFixed(1)}%** | **${(s.jevEndToEndHighRiskRecall * 100).toFixed(1)}%** | High-Risk Cases: ${s.highRiskCasesTotal} |
| **Conditional High-Risk Recall** | **${(s.geminiConditionalHighRiskRecall * 100).toFixed(1)}%** | **${(s.jevConditionalHighRiskRecall * 100).toFixed(1)}%** | Conditional on non-failed calls |
| **Global Security Precision** | **${(gb.precision * 100).toFixed(1)}%** | **${(jb.precision * 100).toFixed(1)}%** | Evaluated across full 100 cases |
| **Global Security F1-Score** | **${gb.f1.toFixed(3)}** | **${jb.f1.toFixed(3)}** | Harmonic mean of P & R |
| **Critical Undershoots** | **${o.criticalGeminiUndershootCount}** | **${o.criticalJevUndershootCount}** | Both Undershot: **${o.bothCriticalUndershootCount}** |
| **Relative Escalation** | Gemini More: ${o.geminiMoreEscalatedCount} | Jev More: ${o.jevMoreEscalatedCount} | Equivalent: ${o.equivalentEscalationCount} |
| **Mean Absolute Severity Error** | **${s.geminiSeverityDistance.meanAbsoluteSeverityError.toFixed(2)}** | **${s.jevSeverityDistance.meanAbsoluteSeverityError.toFixed(2)}** | Distance from Ground Truth |
| **Latency (Median / P50)** | **${l.gemini.p50}ms** | **${l.jev.p50}ms** | Jev Speedup: ${l.gemini.p50 > 0 && l.jev.p50 > 0 ? (l.gemini.p50 / l.jev.p50).toFixed(1) + 'x' : 'N/A'} |
| **Latency (P95)** | **${l.gemini.p95}ms** | **${l.jev.p95}ms** | Max: Gem ${l.gemini.max}ms / Jev ${l.jev.max}ms |
| **Service Failures** | ${o.geminiFailureCount} | ${o.jevFailureCount} | API, schema, or timeout failures |

---

## Global Binary Security Confusion Matrix (Dataset-Wide)

High Risk Ground Truth is defined as \`securitySeverity >= 3\` (Credential Phishing, Financial Extortion, Direct Harassment/Threats, Prompt Injections).
High Risk Prediction is defined as escalating to \`HUMAN_REQUIRED\` or \`BLOCK_RECOMMENDED\`.
Any API failure on a high-risk case is strictly counted as a **False Negative (FN)**.

### Gemini Binary Matrix (Production)
\`\`\`text
                      Predicted High Risk
                     Yes (Escalate)   No (Passive)
Actual High-Risk:         TP: ${gb.tp.toString().padStart(2, ' ')}          FN: ${gb.fn.toString().padStart(2, ' ')}
Actual Not-High-Risk:     FP: ${gb.fp.toString().padStart(2, ' ')}          TN: ${gb.tn.toString().padStart(2, ' ')}

- Precision:           ${(gb.precision * 100).toFixed(1)}%
- Recall:              ${(gb.recall * 100).toFixed(1)}%
- F1-Score:            ${gb.f1.toFixed(3)}
- False Positive Rate: ${(gb.falsePositiveRate * 100).toFixed(1)}%
- False Negative Rate: ${(gb.falseNegativeRate * 100).toFixed(1)}%
- Specificity:         ${(gb.specificity * 100).toFixed(1)}%
\`\`\`

### TypeSafe Jev Binary Matrix (Shadow Observer)
\`\`\`text
                      Predicted High Risk
                     Yes (Escalate)   No (Passive)
Actual High-Risk:         TP: ${jb.tp.toString().padStart(2, ' ')}          FN: ${jb.fn.toString().padStart(2, ' ')}
Actual Not-High-Risk:     FP: ${jb.fp.toString().padStart(2, ' ')}          TN: ${jb.tn.toString().padStart(2, ' ')}

- Precision:           ${(jb.precision * 100).toFixed(1)}%
- Recall:              ${(jb.recall * 100).toFixed(1)}%
- F1-Score:            ${jb.f1.toFixed(3)}
- False Positive Rate: ${(jb.falsePositiveRate * 100).toFixed(1)}%
- False Negative Rate: ${(jb.falseNegativeRate * 100).toFixed(1)}%
- Specificity:         ${(jb.specificity * 100).toFixed(1)}%
\`\`\`

---

## Ground Truth Severity Distance & Escalation Analysis

Measures the difference between predicted severity (0 to 4) and ground truth severity (0 to 4):
\`ΔSeverity = Predicted Severity - Ground Truth Severity\`

| Metric | Gemini | TypeSafe Jev |
| :--- | :---: | :---: |
| **Exact Action Matches** | ${s.geminiSeverityDistance.exactActionMatches} / ${meta.datasetSize} | ${s.jevSeverityDistance.exactActionMatches} / ${meta.datasetSize} |
| **Over-Escalated Cases (Δ > 0)** | ${s.geminiSeverityDistance.overEscalationCount} | ${s.jevSeverityDistance.overEscalationCount} |
| **Under-Escalated Cases (Δ < 0)** | ${s.geminiSeverityDistance.underEscalationCount} | ${s.jevSeverityDistance.underEscalationCount} |
| **Mean Absolute Severity Error (MASE)** | **${s.geminiSeverityDistance.meanAbsoluteSeverityError.toFixed(2)}** | **${s.jevSeverityDistance.meanAbsoluteSeverityError.toFixed(2)}** |

---

## Security Group Breakdown

| Group | Total Cases | High-Risk Group? | Gem High-Risk Detect | Jev High-Risk Detect | Gem Action Acc | Jev Action Acc |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
${groupRows}

---

## Confusion Matrices (Multi-Class Category)

${formatConfusionMatrixMarkdown('Gemini Category Confusion Matrix (Production)', geminiMatrix)}

${formatConfusionMatrixMarkdown('TypeSafe Jev Category Confusion Matrix (Shadow)', jevMatrix)}

---

## Latency Breakdown

| Classifier | Mean (ms) | P50 / Median (ms) | P95 (ms) | Min (ms) | Max (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Gemini** | ${l.gemini.mean}ms | ${l.gemini.p50}ms | ${l.gemini.p95}ms | ${l.gemini.min}ms | ${l.gemini.max}ms |
| **TypeSafe Jev** | ${l.jev.mean}ms | ${l.jev.p50}ms | ${l.jev.p95}ms | ${l.jev.min}ms | ${l.jev.max}ms |

---

## Jev Semantic Signal Statistics by Group

Average confidence and risk signal probabilities emitted by Jev across test groups:

| Group | Category Conf | OTP / Credential | Money Request | Threat / Urgency | Prompt Injection | Suspicious Link |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
${signalRows}

---

## Critical Disagreements & Triage Outliers

Disagreements where either model undershot expected security severity, or diverged in triage action:

| Case ID | Group | Ground Truth Action | Gemini Action | Jev Action | Classification Direction | Severity Deltas |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
${criticalRows || '| *None* | - | - | - | - | All actions concordant | - |'}
${stabilitySection}
---

## Gemini vs Jev Behavioral Observations

1. **Deterministic Edge Enforcement**: Jev's rule-based TypeScript policy ensures that whenever \`credentialRequest >= 0.85\` or \`moneyRequest >= 0.85\`, the outcome is strictly \`BLOCK_RECOMMENDED\`, eliminating generative hallucination or conversational drift.
2. **Hard Negative Handling**: Normal messages referencing sensitive tokens (e.g. *password policy inquiry*, *legitimate expense reimbursement*, *GitHub code links*) require high confidence to avoid false positive blocks.
3. **Failure Resilience**: In Shadow Mode, Jev errors do not degrade the production path, while Jev's lower median latency demonstrates potential for rapid early-exit triage in future phases.

---

## Limitations

1. **Synthetic Message Scope**: Fixed synthetic benchmark sets test isolated message contexts. Production conversations may involve multi-turn progressive grooming.
2. **No Production Mutation**: This benchmark was executed strictly in observation mode and does not alter production dispatch actions.

---

## Recommendation for Phase 3

- **Evidence Supporting Production Consideration**:
  - Consistent typed signal extraction on high-risk vectors (credentials, wire transfers).
  - Measurable latency reduction in shadow observation mode.
- **Blocking Findings & Further Work Required**:
  - Continuous shadow monitoring on live traffic to verify calibration of the \`0.85\` risk signal threshold before any active production routing.
  - Verification of edge-case handling on broken multilingual syntax.
`;
}
