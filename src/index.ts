import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import {
  isLoginRequired,
  navigateToMessageRequests,
  scanMessageRequests,
} from './channels/messenger/watcher.js';
import {
  assertNotPaused,
  FirewallPipeline,
  getConfig,
  HumanFirewallCore,
  isSystemPaused,
  logEvent,
  ThreadStore,
} from './core/index.js';
import { GeminiProvider } from './llm/gemini.js';
import { JevClassifier } from './llm/jev.js';

async function runScanCycle(
  page: Awaited<ReturnType<BrowserContext['newPage']>>,
  store: ThreadStore,
  pipeline: FirewallPipeline,
): Promise<'ok' | 'login_required'> {
  if (await isLoginRequired(page)) {
    logEvent({
      event: 'LOGIN_REQUIRED',
      reason: 'Login required. Run npm run login to authenticate first.',
    });
    console.log('⚠️ ログインが必要です。npm run login を実行して手動ログインしてください。');
    return 'login_required';
  }

  console.log('🔍 Navigating to Message Requests...');
  await navigateToMessageRequests(page);

  console.log('👀 Scanning unread Message Requests...');
  const scanned = await scanMessageRequests(page, store);

  console.log(`📊 Scan completed. Detected ${scanned.length} eligible unread thread(s).`);

  for (const thread of scanned) {
    assertNotPaused('Processing Scanned Thread');

    await pipeline.handleIncomingMessage({
      threadId: thread.threadId,
      threadHash: thread.threadHash,
      senderIdHash: thread.senderIdHash,
      lastMessageHash: thread.lastMessageHash,
      incomingText: thread.lastIncomingText,
      page,
    });
  }

  return 'ok';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWatcherLoop(): Promise<void> {
  const config = getConfig();

  console.log('====================================================');
  console.log('🛡️  Messenger Human Firewall                       🛡️');
  console.log('====================================================');
  console.log(
    `[Config] Dry Run Mode  : ${config.DRY_RUN}${config.DRY_RUN ? ' (No message will be sent)' : ' (LIVE: controlled send enabled)'}`,
  );
  console.log(`[Config] LLM Provider  : ${config.LLM_PROVIDER}`);
  console.log(`[Config] Browser Data  : ${config.BROWSER_USER_DATA_DIR}`);
  console.log(`[Config] Poll Interval : ${config.WATCH_POLL_INTERVAL_SECONDS}s`);
  console.log(`[Config] Reply Scope   : ${config.AUTO_REPLY_SCOPE}`);
  console.log(`[Config] Include Read  : ${config.SCAN_INCLUDE_READ_THREADS}`);
  const jevModeDesc = !config.JEV_ENABLED
    ? 'Disabled'
    : config.JEV_SHADOW_MODE
      ? `Shadow Mode (${config.JEV_MODEL})`
      : `Production Active (${config.JEV_MODEL})`;
  console.log(`[Config] Jev Triage    : ${jevModeDesc}`);
  console.log('====================================================\n');

  const userDataDir = path.resolve(process.cwd(), config.BROWSER_USER_DATA_DIR);
  const store = new ThreadStore(config.DATABASE_PATH);
  const gemini = new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL, store);
  const jevClassifier = config.JEV_ENABLED
    ? new JevClassifier({
        apiKey: config.TYPESAFE_API_KEY,
        model: config.JEV_MODEL,
        timeoutMs: config.JEV_TIMEOUT_MS,
        store,
      })
    : undefined;
  const firewallCore = new HumanFirewallCore(gemini, gemini, jevClassifier);
  const pipeline = new FirewallPipeline(firewallCore, store);

  let context: BrowserContext | null = null;
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\n🛑 Shutting down watcher...');
    if (context) {
      await context.close().catch(() => {});
    }
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: config.HEADLESS,
      viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] || (await context.newPage());

    while (!stopping) {
      if (isSystemPaused()) {
        logEvent({
          event: 'HUMAN_REQUIRED',
          reason: 'System is currently PAUSED. Unpause via npm run resume or check PAUSE_ALL.',
        });
        console.log('⏸️  Paused. Waiting for resume...');
      } else {
        try {
          await runScanCycle(page, store, pipeline);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logEvent({ event: 'ERROR', reason: message });
          console.error('Watcher encountered an error during scan cycle:', err);
        }
      }

      console.log(`💤 Sleeping ${config.WATCH_POLL_INTERVAL_SECONDS}s until next scan...\n`);
      await sleep(config.WATCH_POLL_INTERVAL_SECONDS * 1000);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent({ event: 'ERROR', reason: message });
    console.error('Watcher failed to start:', err);
  } finally {
    if (!stopping) {
      if (context) {
        await context.close().catch(() => {});
      }
      store.close();
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  runWatcherLoop().catch(console.error);
}

export { logEvent };
