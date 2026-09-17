import path from 'node:path';
import { chromium } from 'playwright';
import { getConfig } from '../core/config.js';

async function launchLoginBrowser() {
  const config = getConfig();
  const userDataDir = path.resolve(process.cwd(), config.BROWSER_USER_DATA_DIR);

  console.log('====================================================');
  console.log('🌐 Facebook Messenger 手動ログイン用ブラウザ起動');
  console.log('====================================================');
  console.log(`[Storage] プロファイル保存先: ${userDataDir}`);
  console.log('Google Chrome を起動して https://www.messenger.com/ を開きます。');
  console.log('手動でログインを完了させてください（MFA/2FA含む）。');
  console.log('ログインが完了したら、このコンソールで Ctrl+C を押すかブラウザを閉じてください。');
  console.log('====================================================\n');

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.messenger.com/');

  // Keep open until user closes the browser
  await new Promise<void>((resolve) => {
    context.on('close', () => {
      console.log('✅ ブラウザが閉じられました。セッションが保存されました。');
      resolve();
    });
  });
}

launchLoginBrowser().catch((err) => {
  console.error('ブラウザ起動エラー:', err);
  process.exit(1);
});
