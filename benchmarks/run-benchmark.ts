import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GeminiProvider } from '../src/llm/gemini.js';
import { JevClassifier } from '../src/llm/jev.js';
import {
  evaluateBenchmarkCase,
  type EvaluatorClients,
} from './evaluator.js';
import {
  aggregateBenchmarkMetrics,
  buildConfusionMatrix,
  confusionMatrixToCsv,
} from './metrics.js';
import { generateMarkdownReport } from './report-generator.js';
import {
  BenchmarkDatasetSchema,
  type BenchmarkCase,
  type BenchmarkCaseResult,
  type MultiRunBenchmarkOutput,
  type SingleRunRecord,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CliArgs {
  smoke: boolean;
  runs: number;
  concurrency: number;
  datasetPath?: string;
  outputDir?: string;
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  let smoke = false;
  let runs = 1;
  let concurrency = 3;
  let datasetPath: string | undefined;
  let outputDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--smoke') smoke = true;
    if (argv[i] === '--runs' && argv[i + 1]) runs = Math.max(1, parseInt(argv[++i], 10) || 1);
    if (argv[i] === '--concurrency' && argv[i + 1]) concurrency = Math.max(1, parseInt(argv[++i], 10) || 3);
    if (argv[i] === '--dataset' && argv[i + 1]) datasetPath = argv[++i];
    if (argv[i] === '--output' && argv[i + 1]) outputDir = argv[++i];
  }

  return { smoke, runs, concurrency, datasetPath, outputDir };
}

/**
 * Concurrency worker pool executing items with max concurrency limit.
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const executing: Promise<void>[] = [];
  async function next(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      const item = items[idx];
      results[idx] = await worker(item, idx);
    }
  }

  for (let i = 0; i < Math.min(limit, items.length); i++) {
    executing.push(next());
  }

  await Promise.all(executing);
  return results;
}

/**
 * Computes stability metrics across multiple repeated runs of the same dataset.
 */
export function calculateMultiRunStability(
  runs: SingleRunRecord[],
): {
  geminiCategoryStability: number;
  geminiActionStability: number;
  jevCategoryStability: number;
  jevActionStability: number;
  jevConfidenceVarianceMean: number;
} {
  if (runs.length <= 1) {
    return {
      geminiCategoryStability: 1.0,
      geminiActionStability: 1.0,
      jevCategoryStability: 1.0,
      jevActionStability: 1.0,
      jevConfidenceVarianceMean: 0.0,
    };
  }

  const caseCount = runs[0].results.length;
  let geminiCatStableCases = 0;
  let geminiActStableCases = 0;
  let jevCatStableCases = 0;
  let jevActStableCases = 0;
  let totalConfidenceVariance = 0;

  for (let c = 0; c < caseCount; c++) {
    const geminiCats = new Set(runs.map((r) => r.results[c]?.gemini.category));
    const geminiActs = new Set(runs.map((r) => r.results[c]?.gemini.action));
    const jevCats = new Set(runs.map((r) => r.results[c]?.jev.category));
    const jevActs = new Set(runs.map((r) => r.results[c]?.jev.action));

    if (geminiCats.size === 1) geminiCatStableCases++;
    if (geminiActs.size === 1) geminiActStableCases++;
    if (jevCats.size === 1) jevCatStableCases++;
    if (jevActs.size === 1) jevActStableCases++;

    // Calculate variance of Jev confidence across runs for this case
    const confidences = runs
      .map((r) => r.results[c]?.jev.confidence)
      .filter((v): v is number => typeof v === 'number');

    if (confidences.length > 1) {
      const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      const variance = confidences.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / confidences.length;
      totalConfidenceVariance += variance;
    }
  }

  return {
    geminiCategoryStability: Math.round((geminiCatStableCases / caseCount) * 1000) / 1000,
    geminiActionStability: Math.round((geminiActStableCases / caseCount) * 1000) / 1000,
    jevCategoryStability: Math.round((jevCatStableCases / caseCount) * 1000) / 1000,
    jevActionStability: Math.round((jevActStableCases / caseCount) * 1000) / 1000,
    jevConfidenceVarianceMean: Math.round((totalConfidenceVariance / caseCount) * 10000) / 10000,
  };
}

export async function runBenchmark(
  options?: Partial<CliArgs>,
  mockClients?: EvaluatorClients,
): Promise<MultiRunBenchmarkOutput> {
  const cli = parseCliArgs();
  const smoke = options?.smoke ?? cli.smoke;
  const runs = options?.runs ?? cli.runs;
  const concurrency = options?.concurrency ?? cli.concurrency;

  const resolvedDatasetPath =
    options?.datasetPath ??
    cli.datasetPath ??
    path.join(__dirname, 'datasets', 'security-triage-v1.json');

  const baseOutputDir = options?.outputDir ?? cli.outputDir ?? path.join(__dirname);
  const resultsDir = path.join(baseOutputDir, 'results');
  const reportsDir = path.join(baseOutputDir, 'reports');

  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  console.log('====================================================');
  console.log('🧪 JEV VS GEMINI SECURITY TRIAGE BENCHMARK RUNNER');
  console.log('====================================================');
  console.log(`Mode        : ${smoke ? 'SMOKE TEST (5 cases)' : 'FULL BENCHMARK'}`);
  console.log(`Runs Target : ${runs} iteration(s)`);
  console.log(`Concurrency : ${concurrency}`);
  console.log(`Dataset Path: ${resolvedDatasetPath}`);
  console.log('----------------------------------------------------');

  // 1. Setup Clients (live or mock)
  let clients: EvaluatorClients;
  if (mockClients) {
    clients = mockClients;
  } else {
    const geminiKey = process.env.GEMINI_API_KEY;
    const typesafeKey = process.env.TYPESAFE_API_KEY;

    if (!geminiKey || !typesafeKey) {
      console.error('\n❌ Missing required environment variables.');
      console.error('Benchmark implementation complete. Live benchmark requires:');
      if (!geminiKey) console.error('  - GEMINI_API_KEY');
      if (!typesafeKey) console.error('  - TYPESAFE_API_KEY');
      console.error('\nPlease configure them in your local shell or .env file before running live.');
      console.error('Do NOT paste API keys into chat, source code, or Git.\n');
      process.exit(1);
    }

    clients = {
      gemini: new GeminiProvider(geminiKey),
      jev: new JevClassifier({ apiKey: typesafeKey }),
    };
  }

  // 2. Load & Validate Dataset
  if (!fs.existsSync(resolvedDatasetPath)) {
    throw new Error(`Dataset not found at: ${resolvedDatasetPath}`);
  }

  const rawJson = JSON.parse(fs.readFileSync(resolvedDatasetPath, 'utf-8'));
  let dataset: BenchmarkCase[];

  if (smoke) {
    const parsedAll = BenchmarkDatasetSchema.parse(rawJson);
    dataset = [
      parsedAll.find((c) => c.group === 'NORMAL')!,
      parsedAll.find((c) => c.group === 'SALES')!,
      parsedAll.find((c) => c.group === 'SCAM')!,
      parsedAll.find((c) => c.group === 'CREDENTIAL_PHISHING')!,
      parsedAll.find((c) => c.group === 'PROMPT_INJECTION')!,
    ].filter(Boolean);
  } else {
    dataset = BenchmarkDatasetSchema.parse(rawJson);
  }

  console.log(`Loaded and validated ${dataset.length} cases.`);

  const suiteTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suiteId = `suite-${suiteTimestamp}`;
  const runRecords: SingleRunRecord[] = [];

  // 3. Execute N actual independent runs
  for (let runIdx = 1; runIdx <= runs; runIdx++) {
    const runId = `run-${String(runIdx).padStart(3, '0')}-${suiteTimestamp}`;
    console.log(`\n▶ Starting Iteration [${runIdx}/${runs}] (${runId})...`);

    const caseResults: BenchmarkCaseResult[] = await runPool(
      dataset,
      concurrency,
      async (item: BenchmarkCase, index: number) => {
        const start = Date.now();
        if (!mockClients) {
          process.stdout.write(`[Run ${runIdx} | ${index + 1}/${dataset.length}] Evaluating ${item.id}... `);
        }
        const res = await evaluateBenchmarkCase(item, clients);
        const dur = Date.now() - start;
        if (!mockClients) {
          const gMatch = res.comparison.geminiCategoryCorrect ? '✓' : '✗';
          const jMatch = res.comparison.jevCategoryCorrect ? '✓' : '✗';
          console.log(`Done (${dur}ms) | Gem: ${res.gemini.category}[${gMatch}] Jev: ${res.jev.category}[${jMatch}] Dir: ${res.comparison.securityDirection}`);
        }
        return res;
      },
    );

    const metrics = aggregateBenchmarkMetrics(caseResults);
    const runRecord: SingleRunRecord = {
      runIndex: runIdx,
      runId,
      timestamp: new Date().toISOString(),
      results: caseResults,
      aggregatedMetrics: metrics,
    };
    runRecords.push(runRecord);

    // Save individual run results
    const singleRunPath = path.join(resultsDir, `${runId}.json`);
    fs.writeFileSync(singleRunPath, JSON.stringify(runRecord, null, 2), 'utf-8');
    console.log(`💾 Iteration [${runIdx}/${runs}] saved to: ${singleRunPath}`);
  }

  // 4. Multi-run Stability
  const stability = runs > 1 ? calculateMultiRunStability(runRecords) : undefined;
  const primaryMetrics = runRecords[0].aggregatedMetrics;

  const multiRunOutput: MultiRunBenchmarkOutput = {
    metadata: {
      benchmarkSuiteId: suiteId,
      timestamp: new Date().toISOString(),
      datasetSize: dataset.length,
      geminiModel: 'gemini-3.6-flash',
      jevModel: 'jev-system-one',
      runsRequested: runs,
      runsExecuted: runRecords.length,
      concurrency,
    },
    runs: runRecords,
    stability,
    primaryMetrics,
  };

  // 5. Save Aggregate Machine-Readable Output
  const aggregateResultPath = path.join(
    resultsDir,
    smoke ? 'benchmark-smoke-aggregate.json' : 'benchmark-aggregate.json',
  );
  fs.writeFileSync(aggregateResultPath, JSON.stringify(multiRunOutput, null, 2), 'utf-8');
  console.log(`💾 Aggregated benchmark suite results saved to: ${aggregateResultPath}`);

  // 6. Save Confusion Matrices as CSV
  const primaryResults = runRecords[0].results;
  const geminiMatrix = buildConfusionMatrix(primaryResults, 'gemini');
  const jevMatrix = buildConfusionMatrix(primaryResults, 'jev');

  const geminiCsvPath = path.join(reportsDir, 'gemini-confusion-matrix.csv');
  const jevCsvPath = path.join(reportsDir, 'jev-confusion-matrix.csv');
  fs.writeFileSync(geminiCsvPath, confusionMatrixToCsv(geminiMatrix), 'utf-8');
  fs.writeFileSync(jevCsvPath, confusionMatrixToCsv(jevMatrix), 'utf-8');
  console.log(`💾 Confusion matrices written to: ${geminiCsvPath}, ${jevCsvPath}`);

  // 7. Generate & Save Markdown Report
  const reportMeta = {
    runId: suiteId,
    timestamp: new Date().toISOString(),
    geminiModel: 'gemini-3.6-flash',
    jevModel: 'jev-system-one',
    datasetSize: dataset.length,
    runsCount: runRecords.length,
  };

  const reportMd = generateMarkdownReport(
    primaryResults,
    primaryMetrics,
    geminiMatrix,
    jevMatrix,
    reportMeta,
    multiRunOutput,
  );
  const reportPath = path.join(
    reportsDir,
    smoke ? 'JEV_VS_GEMINI_SMOKE_REPORT.md' : 'JEV_VS_GEMINI_BENCHMARK.md',
  );
  fs.writeFileSync(reportPath, reportMd, 'utf-8');
  console.log(`📄 Markdown benchmark report written to: ${reportPath}`);

  // 8. Print Console Summary
  const o = primaryMetrics.overall;
  const s = primaryMetrics.security;
  const l = primaryMetrics.latency;
  const gb = s.geminiBinaryMatrix;
  const jb = s.jevBinaryMatrix;

  console.log('\n====================================================');
  console.log('🏁 BENCHMARK SUITE EXECUTION COMPLETED');
  console.log('====================================================');
  console.log(`Independent Runs   : ${runRecords.length}`);
  console.log(`Dataset Size       : ${dataset.length} cases`);
  console.log(`End-to-End Action  : Gemini ${(o.geminiEndToEndActionAccuracy * 100).toFixed(1)}% | Jev ${(o.jevEndToEndActionAccuracy * 100).toFixed(1)}%`);
  console.log(`Successful Action  : Gemini ${(o.geminiConditionalActionAccuracy * 100).toFixed(1)}% | Jev ${(o.jevConditionalActionAccuracy * 100).toFixed(1)}%`);
  console.log(`High-Risk Recall   : End-to-End: Gem ${(s.geminiEndToEndHighRiskRecall * 100).toFixed(1)}% / Jev ${(s.jevEndToEndHighRiskRecall * 100).toFixed(1)}%`);
  console.log(`Security Precision : Gemini ${(gb.precision * 100).toFixed(1)}% | Jev ${(jb.precision * 100).toFixed(1)}%`);
  console.log(`Security F1-Score  : Gemini ${gb.f1.toFixed(3)} | Jev ${jb.f1.toFixed(3)}`);
  console.log(`Critical Undershoot: Gemini=${o.criticalGeminiUndershootCount} | Jev=${o.criticalJevUndershootCount} | Both=${o.bothCriticalUndershootCount}`);
  console.log(`Relative Escalation: Gemini More=${o.geminiMoreEscalatedCount} | Jev More=${o.jevMoreEscalatedCount} | Equiv=${o.equivalentEscalationCount}`);
  console.log(`Latency (P50)      : Gemini=${l.gemini.p50}ms | Jev=${l.jev.p50}ms`);
  console.log(`Gemini Failures    : Total=${o.geminiFailureCount} (API=${o.geminiApiErrors}, Parse=${o.geminiJsonParseErrors}, Schema=${o.geminiSchemaErrors}, Empty=${o.geminiEmptyResponses})`);
  console.log(`Gemini Genuine UNK : ${o.geminiGenuineUnknownCount}`);
  if (stability) {
    console.log(`Stability Across Runs: Action: Gem ${(stability.geminiActionStability * 100).toFixed(1)}% / Jev ${(stability.jevActionStability * 100).toFixed(1)}%`);
  }
  console.log('====================================================\n');

  return multiRunOutput;
}

// Auto-run when executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('run-benchmark.ts')) {
  runBenchmark().catch((err: unknown) => {
    console.error('Fatal benchmark execution error:', err);
    process.exit(1);
  });
}
