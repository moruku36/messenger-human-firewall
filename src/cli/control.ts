import { getConfig, isSystemPaused, setSystemPause } from '../config/index.js';

const command = process.argv[2];

function main() {
  const config = getConfig();

  switch (command) {
    case 'pause':
      setSystemPause(true);
      console.log('🛑 [PAUSE] Messenger Human Firewall has been PAUSED.');
      break;

    case 'resume':
      if (config.PAUSE_ALL) {
        console.warn(
          '⚠️ [WARN] PAUSE_ALL=true is set in environment (.env). Resetting local killswitch file only.',
        );
      }
      setSystemPause(false);
      console.log('▶️ [RESUME] Messenger Human Firewall killswitch removed. System is active.');
      break;

    case 'status': {
      const paused = isSystemPaused();
      console.log('--- Messenger Human Firewall Status ---');
      console.log(`Active Status: ${paused ? '🛑 PAUSED' : '🟢 RUNNING'}`);
      console.log(`Dry Run Mode : ${config.DRY_RUN ? 'Enabled (No actual replies)' : 'Disabled'}`);
      console.log(`LLM Provider : ${config.LLM_PROVIDER}`);
      console.log(`Max Replies  : ${config.MAX_REPLIES_PER_THREAD_PER_DAY} / day / thread`);
      console.log(`Min Interval : ${config.MIN_REPLY_INTERVAL_SECONDS} seconds`);
      break;
    }

    default:
      console.log('Usage: npm run [pause | resume | status]');
      process.exit(1);
  }
}

main();
