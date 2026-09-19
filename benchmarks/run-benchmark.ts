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
  BenchmarkCaseSchema,
  BenchmarkDatasetSchema,
  type BenchmarkCase,
  type BenchmarkCaseResult,
  type BenchmarkRunOutput,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  smoke: boolean;
  runs: number;
  concurrency: number;
  datasetPath?: string;
  outputDir?: string;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let smoke = false;
  let runs = 1;
  let concurrency = 3; // Default concurrency rate limit
  let datasetPath: string | undefined;
  let outputDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--smoke') smoke = true;
    if (args[i] === '--runs' && args[i + 1]) runs = parseInt(args[++i], 10) || 1;
    if (args[i] === '--concurrency' && args[i + 1]) concurrency = parseInt(args[++i], 10) || 3;
    if (args[i] === '--dataset' && args[i + 1]) datasetPath = args[++i];
    if (args[i] === '--output' && args[i + 1]) outputDir = args[++i];
  }

  return { smoke, runs, concurrency, datasetPath, outputDir };
}

/**
 * Concurrency worker pool executing items with max concurrency limit.
 */
async function runPool<T, R>(
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

export async function runBenchmark(options?: Partial<CliArgs>): Promise<void> {
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
  console.log(`Runs        : ${runs}`);
  console.log(`Concurrency : ${concurrency}`);
  console.log(`Dataset Path: ${resolvedDatasetPath}`);
  console.log('----------------------------------------------------');

  // 1. Check API Keys
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

  // 2. Load & Validate Dataset
  if (!fs.existsSync(resolvedDatasetPath)) {
    throw new Error(`Dataset not found at: ${resolvedDatasetPath}`);
  }

  const rawJson = JSON.parse(fs.readFileSync(resolvedDatasetPath, 'utf-8'));
  let dataset: BenchmarkCase[];

  if (smoke) {
    // Pick 5 representative cases for smoke test
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

  // 3. Initialize Evaluator Clients
  const clients: EvaluatorClients = {
    gemini: new GeminiProvider(geminiKey),
    jev: new JevClassifier({ apiKey: typesafeKey }),
  };

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  console.log(`Initiating benchmark execution (${runId})...\n`);

  // 4. Run Evaluation across dataset
  const caseResults = await runPool(
    dataset,
    concurrency,
    async (item: BenchmarkCase, index: number) => {
      const start = Date.now();
      process.stdout.write(`[${index + 1}/${dataset.length}] Evaluating ${item.id} (${item.group})... `);
      const res = await evaluateBenchmarkCase(item, clients);
      const dur = Date.now() - start;
      const gMatch = res.comparison.geminiCategoryCorrect ? '✓' : '✗';
      const jMatch = res.comparison.jevCategoryCorrect ? '✓' : '✗';
      console.log(`Done (${dur}ms) | Gem: ${res.gemini.category}[${gMatch}] Jev: ${res.jev.category}[${jMatch}] Dir: ${res.comparison.securityDirection}`);
      return res;
    },
  );

  // 5. Aggregate Metrics
  console.log('\n----------------------------------------------------');
  console.log('📊 Aggregating metrics and confusion matrices...');
  const metrics = aggregateBenchmarkMetrics(caseResults);
  const geminiMatrix = buildConfusionMatrix(caseResults, 'gemini');
  const jevMatrix = buildConfusionMatrix(caseResults, 'jev');

  const meta = {
    runId,
    timestamp: new Date().toISOString(),
    datasetSize: caseResults.length,
    geminiModel: 'gemini-3.6-flash',
    jevModel: 'jev-system-one',
    runsCount: runs,
    concurrency,
  };

  const runOutput: BenchmarkRunOutput = {
    metadata: meta,
    results: caseResults,
    aggregatedMetrics: metrics,
  };

  // 6. Save Machine-Readable JSON Output
  const resultJsonPath = path.join(resultsDir, smoke ? 'benchmark-smoke.json' : 'benchmark-v1.json');
  fs.writeFileSync(resultJsonPath, JSON.stringify(runOutput, null, 2), 'utf-8');
  console.log(`💾 Raw results written to: ${resultJsonPath}`);

  // 7. Save Confusion Matrices as CSV
  const geminiCsvPath = path.join(reportsDir, 'gemini-confusion-matrix.csv');
  const jevCsvPath = path.join(reportsDir, 'jev-confusion-matrix.csv');
  fs.writeFileSync(geminiCsvPath, confusionMatrixToCsv(geminiMatrix), 'utf-8');
  fs.writeFileSync(jevCsvPath, confusionMatrixToCsv(jevMatrix), 'utf-8');
  console.log(`💾 Confusion matrices written to: ${geminiCsvPath}, ${jevCsvPath}`);

  // 8. Generate & Save Markdown Report
  const reportMd = generateMarkdownReport(caseResults, metrics, geminiMatrix, jevMatrix, meta);
  const reportPath = path.join(reportsDir, smoke ? 'JEV_VS_GEMINI_SMOKE_REPORT.md' : 'JEV_VS_GEMINI_BENCHMARK.md');
  fs.writeFileSync(reportPath, reportMd, 'utf-8');
  console.log(`📄 Markdown benchmark report written to: ${reportPath}`);

  // 9. Print Concise Summary Table to Console
  console.log('\n====================================================');
  console.log('🏁 BENCHMARK RUN COMPLETED');
  console.log('====================================================');
  console.log(`Cases Evaluated    : ${metrics.overall.totalCases}`);
  console.log(`Gemini Accuracy    : Category ${(metrics.overall.geminiCategoryAccuracy * 100).toFixed(1)}% | Action ${(metrics.overall.geminiActionAccuracy * 100).toFixed(1)}%`);
  console.log(`Jev Accuracy       : Category ${(metrics.overall.jevCategoryAccuracy * 100).toFixed(1)}% | Action ${(metrics.overall.jevActionAccuracy * 100).toFixed(1)}%`);
  console.log(`Category Agreement : ${(metrics.overall.categoryAgreement * 100).toFixed(1)}%`);
  console.log(`Action Agreement   : ${(metrics.overall.actionAgreement * 100).toFixed(1)}%`);
  console.log(`High-Risk Recall   : Gemini ${(metrics.security.geminiHighRiskRecall * 100).toFixed(1)}% vs Jev ${(metrics.security.jevHighRiskRecall * 100).toFixed(1)}%`);
  console.log(`Critical Undershoot: Gemini=${metrics.overall.criticalGeminiUndershootCount} | Jev=${metrics.overall.criticalJevUndershootCount}`);
  console.log(`Latency (P50)      : Gemini=${metrics.latency.gemini.p50}ms | Jev=${metrics.latency.jev.p50}ms`);
  console.log('====================================================\n');
}

// Auto-run when executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('run-benchmark.ts')) {
  runBenchmark().catch((err: unknown) => {
    console.error('Fatal benchmark execution error:', err);
    process.exit(1);
  });
}
