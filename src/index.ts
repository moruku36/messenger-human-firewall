import { getConfig, isSystemPaused } from './config/index.js';
import type { ObservabilityLog } from './types/index.js';

export function logEvent(entry: Omit<ObservabilityLog, 'timestamp'>): void {
  const log: ObservabilityLog = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  // Log strictly structured event metadata without dumping full raw user message text
  console.log(JSON.stringify(log));
}

export function initializeSystem(): void {
  const config = getConfig();
  const paused = isSystemPaused();

  console.log('====================================================');
  console.log('🛡️  Messenger Human Firewall (v0 Skeleton Active)  🛡️');
  console.log('====================================================');
  console.log(`[Config] Dry Run Mode  : ${config.DRY_RUN}`);
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

  logEvent({
    event: 'THREAD_DETECTED',
    details: { message: 'Skeleton initialized successfully' },
  });
}

if (process.env.NODE_ENV !== 'test') {
  initializeSystem();
}
