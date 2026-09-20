/**
 * Run through the real `tsx` runtime (esbuild keepNames) by tsx-runtime.test.ts.
 * vitest transforms code differently, so a helper such as `__name(...)` leaking into the
 * functions serialised to the browser is only visible when running under tsx.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { scanMessageRequests } from '../../src/channels/messenger/watcher.js';
import { ThreadStore } from '../../src/core/storage.js';

const fixture = pathToFileURL(path.resolve(process.cwd(), 'tests/fixtures/messenger-mock.html')).href;
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(fixture);
  const results = await scanMessageRequests(page, new ThreadStore(':memory:'));
  console.log(`SMOKE_OK ${results.map((r) => r.threadId).join(',')}`);
} finally {
  await browser.close();
}
