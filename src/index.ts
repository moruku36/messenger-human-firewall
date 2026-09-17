import {
  assertNotPaused,
  getConfig,
  isSystemPaused,
  logEvent,
} from './core/index.js';

export function initializeSystem(): void {
  const config = getConfig();
  const paused = isSystemPaused();

  console.log('====================================================');
  console.log('🛡️  Messenger Human Firewall (Phase 1: Skeleton)  🛡️');
  console.log('====================================================');
  console.log(`[Config] Dry Run Mode  : ${config.DRY_RUN}`);
  console.log(`[Config] Paused Status : ${paused}`);
  console.log(`[Config] LLM Provider  : ${config.LLM_PROVIDER}`);
  console.log(`[Config] Browser Data  : ${config.BROWSER_USER_DATA_DIR}`);
  console.log(`[Status] Phase 1 Active: Core rules, guards, types initialized.`);
  console.log(`         Browser watcher & live polling will connect in Phase 2.`);
  console.log('====================================================\n');

  if (paused) {
    logEvent({
      event: 'HUMAN_REQUIRED',
      reason: 'System is currently PAUSED. Unpause via npm run resume or check PAUSE_ALL.',
    });
    return;
  }

  // Pre-action check verification
  assertNotPaused('System Initialization');

  logEvent({
    event: 'THREAD_DETECTED',
    details: {
      statusMessage: 'Phase 1 skeleton verified and ready for Phase 2 watcher integration',
    },
  });
}

if (process.env.NODE_ENV !== 'test') {
  initializeSystem();
}

export { logEvent };
