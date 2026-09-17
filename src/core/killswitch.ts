import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.js';

const KILL_SWITCH_FILE = path.resolve(process.cwd(), 'data', '.killswitch');

export class FirewallPausedError extends Error {
  constructor(stage = 'Operation') {
    super(`[KILL_SWITCH] ${stage} aborted: Messenger Human Firewall is PAUSED.`);
    this.name = 'FirewallPausedError';
  }
}

/**
 * Checks whether the system is paused via .env (PAUSE_ALL) or local killswitch file.
 */
export function isSystemPaused(): boolean {
  const config = getConfig();
  if (config.PAUSE_ALL) {
    return true;
  }
  return fs.existsSync(KILL_SWITCH_FILE);
}

/**
 * Mandatory guard before ANY action (especially before sending a reply or reading messages).
 * Throws FirewallPausedError if paused.
 */
export function assertNotPaused(stage = 'Pre-action check'): void {
  if (isSystemPaused()) {
    throw new FirewallPausedError(stage);
  }
}

export function setSystemPause(paused: boolean): void {
  const dataDir = path.dirname(KILL_SWITCH_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (paused) {
    fs.writeFileSync(KILL_SWITCH_FILE, JSON.stringify({ pausedAt: new Date().toISOString() }));
  } else if (fs.existsSync(KILL_SWITCH_FILE)) {
    fs.unlinkSync(KILL_SWITCH_FILE);
  }
}
