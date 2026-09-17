import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import {
  isLoginRequired,
  navigateToMessageRequests,
  scanMessageRequests,
} from './channels/messenger/watcher.js';
import {
  assertNotPaused,
  getConfig,
  isSystemPaused,
  logEvent,
  ThreadStore,
} from './core/index.js';

export async function runWatcherOnce(): Promise<void> {
  const config = getConfig();
  const paused = isSystemPaused();

  console.log('====================================================');
  console.log('🛡️  Messenger Human Firewall (Phase 2: Watcher)     🛡️');
  console.log('====================================================');
  console.log(`[Config] Dry Run Mode  : ${config.DRY_RUN} (No message will be sent)`);
  console.log(`[Config] Paused Status : ${paused}`);
  console.log(`[Config] LLM Provider  : ${config.LLM_PROVIDER}`);
  console.log(`[Config] Browser Data  : ${config.BROWSER_USER_DATA_DIR}`);
  console.log('====================================================\n');

  if (paused) {
    logEvent({
      event: 'HUMAN_REQUIRED',
      reason: 'System is currently PAUSED. Unpause via npm run resume or check PAUSE_ALL.',
    });
    return;
  }

  assertNotPaused('Watcher Initialization');

  const userDataDir = path.resolve(process.cwd(), config.BROWSER_USER_DATA_DIR);
  const store = new ThreadStore(config.DATABASE_PATH);

  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: config.HEADLESS,
      viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] || (await context.newPage());

    if (await isLoginRequired(page)) {
      logEvent({
        event: 'LOGIN_REQUIRED',
        reason: 'Login required. Run npm run login to authenticate first.',
      });
      console.log('⚠️ ログインが必要です。npm run login を実行して手動ログインしてください。');
      return;
    }

    console.log('🔍 Navigating to Message Requests...');
    await navigateToMessageRequests(page);

    console.log('👀 Scanning unread Message Requests...');
    const scanned = await scanMessageRequests(page, store);

    console.log(`\n📊 Scan completed. Detected ${scanned.length} eligible unread thread(s).`);

    for (const thread of scanned) {
      console.log('----------------------------------------------------');
      console.log(`[Dry Run Detected] Thread ID Hash: ${thread.threadHash.slice(0, 12)}...`);
      console.log(`                   Last Msg Hash : ${thread.lastMessageHash.slice(0, 12)}...`);
      console.log(`                   Eligibility   : ${thread.eligibility.eligible ? 'PASS' : 'BLOCKED'}`);
      console.log('                   Action (Dry Run): READY FOR LLM CLASSIFICATION (Phase 3)');
      console.log('----------------------------------------------------');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent({
      event: 'ERROR',
      reason: message,
    });
    console.error('Watcher encountered an error:', err);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    store.close();
  }
}

if (process.env.NODE_ENV !== 'test') {
  runWatcherOnce().catch(console.error);
}

export { logEvent };
