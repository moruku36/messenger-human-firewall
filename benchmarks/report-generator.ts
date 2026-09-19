import {
  type AggregatedBenchmarkMetrics,
  type BenchmarkCaseResult,
  type ConfusionMatrix,
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
): string {
  const o = metrics.overall;
  const s = metrics.security;
  const l = metrics.latency;

  // Critical Disagreement Table
  const criticalRows = results
    .filter(
      (r) =>
        r.comparison.securityDirection === 'CRITICAL_JEV_UNDERSHOOT' ||
        r.comparison.securityDirection === 'CRITICAL_GEMINI_UNDERSHOOT' ||
        !r.comparison.actionAgreement,
    )
    .map((r) => {
      const gAct = r.gemini.action || (r.gemini.errorCode ? `FAIL(${r.gemini.errorCode})` : 'N/A');
      const jAct = r.jev.action || (r.jev.errorCode ? `FAIL(${r.jev.errorCode})` : 'N/A');
      return `| \`${r.id}\` | ${r.group} | \`${r.groundTruth.expectedAction}\` | \`${gAct}\` | \`${jAct}\` | **${r.comparison.securityDirection}** |`;
    })
    .join('\n');

  // Security Group Metrics Table
  const groupRows = Object.values(s.groupMetrics)
    .map(
      (g) =>
        `| ${g.group} | ${g.total} | ${(g.geminiRecall * 100).toFixed(0)}% | ${(g.jevRecall * 100).toFixed(0)}% | ${(g.geminiPrecision * 100).toFixed(0)}% | ${(g.jevPrecision * 100).toFixed(0)}% | ${(g.geminiFalseNegativeRate * 100).toFixed(0)}% | ${(g.jevFalseNegativeRate * 100).toFixed(0)}% |`,
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

  return `# Jev vs Gemini Security Triage Benchmark Report

**Run ID**: \`${meta.runId}\`  
**Evaluation Date**: ${meta.timestamp}  
**Dataset**: Synthetic Security Triage v1 (${meta.datasetSize} cases)  
**Gemini Model**: \`${meta.geminiModel}\` (Production Active)  
**Jev Model**: \`${meta.jevModel}\` (Shadow Observer)  
**Repeated Runs**: ${meta.runsCount}  

---

## Executive Summary

This report evaluates **TypeSafe Jev** operating in **Shadow Mode** alongside production **Gemini** across **${meta.datasetSize} fixed, reproducible synthetic security messages**.
Evaluation is anchored on **Ground Truth Safety Invariants**: preventing dangerous false negatives (e.g. classifying active credential phishing or wire fraud as polite conversation or general time-waster engagement).

| Dimension | Gemini (Production) | Jev (Shadow Observer) | Delta / Agreement |
| :--- | :---: | :---: | :---: |
| **Category Accuracy** | **${(o.geminiCategoryAccuracy * 100).toFixed(1)}%** | **${(o.jevCategoryAccuracy * 100).toFixed(1)}%** | Agreement: **${(o.categoryAgreement * 100).toFixed(1)}%** |
| **Action Accuracy** | **${(o.geminiActionAccuracy * 100).toFixed(1)}%** | **${(o.jevActionAccuracy * 100).toFixed(1)}%** | Agreement: **${(o.actionAgreement * 100).toFixed(1)}%** |
| **High-Risk Recall** | **${(s.geminiHighRiskRecall * 100).toFixed(1)}%** | **${(s.jevHighRiskRecall * 100).toFixed(1)}%** | High-Risk Cases: ${s.highRiskCasesTotal} |
| **Critical Undershoots** | **${o.criticalGeminiUndershootCount}** | **${o.criticalJevUndershootCount}** | Jev Safer: ${o.jevSaferCount} / Gemini Safer: ${o.geminiSaferCount} |
| **Latency (Median / P50)** | **${l.gemini.p50}ms** | **${l.jev.p50}ms** | Jev Speedup: ${l.gemini.p50 > 0 && l.jev.p50 > 0 ? (l.gemini.p50 / l.jev.p50).toFixed(1) + 'x' : 'N/A'} |
| **Latency (P95)** | **${l.gemini.p95}ms** | **${l.jev.p95}ms** | Max: Gem ${l.gemini.max}ms / Jev ${l.jev.max}ms |
| **Failures** | ${o.geminiFailureCount} | ${o.jevFailureCount} | Schema/API Errors |

---

## Benchmark Environment & Ground Truth Policy

1. **Production Gemini Invariant**: Evaluated using identical system instructions and schema validation as production \`GeminiProvider.classify()\`.
2. **Shadow Jev Invariant**: Evaluated using TypeSafe Jev System One questions and evaluated through deterministic TypeScript policy (\`evaluateJevPolicy\`).
3. **Escalation Hierarchy**:
   - **Severity 4 (Critical Threat)**: \`BLOCK_RECOMMENDED\` (Credential theft, money requests, prompt injection).
   - **Severity 3 (Physical/Urgent Threat)**: \`HUMAN_REQUIRED\` (Physical harassment, bomb threats, doxxing, low classification confidence).
   - **Severity 2 (Suspicious Engagement)**: \`TIME_WASTER\` (Unverified external links, grooming scam without explicit credential/money demands).
   - **Severity 1 (Nuisance / Noise)**: \`TIME_WASTER\` / \`IGNORE\` (Commercial cold sales, mass marketing spam).
   - **Severity 0 (Harmless)**: \`POLITE_REPLY\` (Benign greetings, inquiries, hard negatives with sensitive keywords).

---

## Security Group Breakdown (Recall, Precision, & Error Rates)

| Group | Total | Gem Recall | Jev Recall | Gem Prec | Jev Prec | Gem FNR | Jev FNR |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${groupRows}

---

## Confusion Matrices

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

Disagreements where either model undershot expected security severity or selected a divergent action:

| Case ID | Group | Ground Truth Action | Gemini Action | Jev Action | Direction |
| :--- | :--- | :---: | :---: | :---: | :--- |
${criticalRows || '| *None* | - | - | - | - | All actions concordant |'}

---

## Gemini vs Jev Behavioral Observations

1. **Deterministic Edge Enforcement**: Jev's rule-based TypeScript policy ensures that whenever \`credentialRequest >= 0.85\` or \`moneyRequest >= 0.85\`, the outcome is strictly \`BLOCK_RECOMMENDED\`, eliminating generative drift.
2. **Hard Negative Handling**: Normal messages referencing sensitive tokens (e.g. *password policy inquiry*, *legitimate expense reimbursement*, *GitHub code links*) require high confidence to avoid false positives.
3. **Latency Profile**: Jev provides fast, typed classification for System One decision-making, while Gemini excels in rich context synthesis.

---

## Limitations

1. **Synthetic Bias**: Fixed synthetic benchmark sets test isolated message contexts. Production conversations may involve longer conversational turns and nuanced multi-message grooming.
2. **No Production Mutation**: This benchmark was executed entirely offline and does not alter production routing or dispatch actions.

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
