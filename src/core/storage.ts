import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Action, ThreadState } from './types.js';

export function computeHash(text: string): string {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

export class ThreadStore {
  private db: Database.Database;

  constructor(dbPath = 'data/firewall.db') {
    const isMemory = dbPath === ':memory:';
    const fullPath = isMemory ? ':memory:' : path.resolve(process.cwd(), dbPath);

    if (!isMemory) {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(fullPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        sender_id_hash TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        last_message_hash TEXT NOT NULL,
        mode TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        reply_count INTEGER NOT NULL DEFAULT 0,
        risk_score INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        human_required INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_replies_thread_time ON replies(thread_id, timestamp);
    `);

    // Ensure reply_count column exists if table existed previously
    const columns = this.db.prepare("PRAGMA table_info('threads')").all() as { name: string }[];
    const hasReplyCount = columns.some((col) => col.name === 'reply_count');
    if (!hasReplyCount) {
      this.db.exec('ALTER TABLE threads ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0;');
    }
  }

  public getThread(threadId: string): ThreadState | null {
    const stmt = this.db.prepare<[string], {
      thread_id: string;
      sender_id_hash: string;
      first_seen: number;
      last_seen: number;
      last_message_hash: string;
      mode: string;
      message_count: number;
      reply_count: number;
      risk_score: number;
      paused: number;
      human_required: number;
    }>('SELECT * FROM threads WHERE thread_id = ?');

    const row = stmt.get(threadId);
    if (!row) return null;

    return {
      threadId: row.thread_id,
      senderIdHash: row.sender_id_hash,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      lastMessageHash: row.last_message_hash,
      mode: row.mode as Action,
      messageCount: row.message_count,
      replyCount: row.reply_count ?? 0,
      riskScore: row.risk_score,
      paused: Boolean(row.paused),
      humanRequired: Boolean(row.human_required),
    };
  }

  public upsertThread(state: ThreadState): void {
    const stmt = this.db.prepare(`
      INSERT INTO threads (
        thread_id, sender_id_hash, first_seen, last_seen,
        last_message_hash, mode, message_count, reply_count, risk_score,
        paused, human_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        last_message_hash = excluded.last_message_hash,
        mode = excluded.mode,
        message_count = excluded.message_count,
        reply_count = excluded.reply_count,
        risk_score = excluded.risk_score,
        paused = excluded.paused,
        human_required = excluded.human_required
    `);

    stmt.run(
      state.threadId,
      state.senderIdHash,
      state.firstSeen,
      state.lastSeen,
      state.lastMessageHash,
      state.mode,
      state.messageCount,
      state.replyCount ?? 0,
      state.riskScore,
      state.paused ? 1 : 0,
      state.humanRequired ? 1 : 0,
    );
  }

  public isDuplicateMessage(threadId: string, messageHash: string): boolean {
    const thread = this.getThread(threadId);
    if (!thread) return false;
    return thread.lastMessageHash === messageHash;
  }

  public listThreads(): ThreadState[] {
    const stmt = this.db.prepare(`
      SELECT * FROM threads ORDER BY last_seen DESC LIMIT 100
    `);

    const rows = stmt.all() as {
      thread_id: string;
      sender_id_hash: string;
      first_seen: number;
      last_seen: number;
      last_message_hash: string;
      mode: string;
      message_count: number;
      reply_count: number;
      risk_score: number;
      paused: number;
      human_required: number;
    }[];

    return rows.map((row) => ({
      threadId: row.thread_id,
      senderIdHash: row.sender_id_hash,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      lastMessageHash: row.last_message_hash,
      mode: row.mode as Action,
      messageCount: row.message_count,
      replyCount: row.reply_count ?? 0,
      riskScore: row.risk_score,
      paused: Boolean(row.paused),
      humanRequired: Boolean(row.human_required),
    }));
  }

  public setThreadPause(threadId: string, paused: boolean): boolean {
    const stmt = this.db.prepare('UPDATE threads SET paused = ? WHERE thread_id = ?');
    const res = stmt.run(paused ? 1 : 0, threadId);
    return res.changes > 0;
  }

  public recordReply(threadId: string, timestamp = Date.now()): void {
    const stmt = this.db.prepare('INSERT INTO replies (thread_id, timestamp) VALUES (?, ?)');
    stmt.run(threadId, timestamp);
  }

  public getRecentReplyCount(threadId: string, windowMs = 24 * 60 * 60 * 1000): number {
    const threshold = Date.now() - windowMs;
    const stmt = this.db.prepare<[string, number], { count: number }>(
      'SELECT COUNT(*) as count FROM replies WHERE thread_id = ? AND timestamp > ?'
    );
    const row = stmt.get(threadId, threshold);
    return row ? row.count : 0;
  }

  public close(): void {
    this.db.close();
  }
}
