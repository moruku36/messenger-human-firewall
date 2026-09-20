import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('watcher under the tsx runtime', () => {
  it('runs page.evaluate callbacks without esbuild helper leakage (__name)', () => {
    const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
    const script = path.resolve(process.cwd(), 'tests/helpers/tsx-scan-smoke.ts');
    const out = execFileSync(process.execPath, [tsxCli, script], {
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test' },
      timeout: 60000,
    });
    expect(out).toContain('SMOKE_OK thread-1');
  }, 90000);
});
