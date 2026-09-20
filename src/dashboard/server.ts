import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, isSystemPaused, setSystemPause } from '../core/index.js';
import { ThreadStore } from '../core/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DashboardServerOptions {
  port?: number;
  store?: ThreadStore;
}

export function createDashboardServer(options: DashboardServerOptions = {}) {
  const port = options.port ?? 3000;
  const store = options.store ?? new ThreadStore(getConfig().DATABASE_PATH);

  const allowedHosts = new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    'localhost',
    '127.0.0.1',
  ]);

  // Exact match only: a prefix check would also accept e.g. http://localhost:30000
  const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

  const server = http.createServer(async (req, res) => {
    const hostHeader = req.headers.host || '';
    if (!allowedHosts.has(hostHeader)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: Invalid Host header' }));
      return;
    }

    // Protect POST APIs from CSRF by verifying Origin header if present
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Invalid Origin' }));
        return;
      }
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    // API: System Status
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const config = getConfig();
      const paused = isSystemPaused();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        paused,
        dryRun: config.DRY_RUN,
        autoReplyScope: config.AUTO_REPLY_SCOPE,
        allowedTestThreadId: config.ALLOWED_TEST_THREAD_ID || null,
        maxReplies: config.CONTROLLED_MAX_REPLIES,
        llmProvider: config.LLM_PROVIDER,
      }));
      return;
    }

    // API: Toggle Global Pause (Kill Switch)
    if (req.method === 'POST' && url.pathname === '/api/killswitch') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const targetState = Boolean(parsed.paused);
          setSystemPause(targetState);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, paused: targetState }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }

    // API: List Threads
    if (req.method === 'GET' && url.pathname === '/api/threads') {
      const threads = store.listThreads();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(threads));
      return;
    }

    // API: Toggle Thread Pause
    if (req.method === 'POST' && url.pathname === '/api/threads/pause') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.threadId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'threadId is required' }));
            return;
          }
          const updated = store.setThreadPause(parsed.threadId, Boolean(parsed.paused));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: updated }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // UI: Dashboard HTML
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const htmlPath = path.resolve(__dirname, 'index.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load dashboard HTML');
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return {
    server,
    start: () => new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    port,
  };
}
