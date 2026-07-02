import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { SessionSearchHit } from "./sessionSearch.js";
import { messageText, parseJsonlSession as parseActiveBranchJsonl } from "../session/activeBranch.js";

export interface SqliteDatabase {
  pragma(sql: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

type SqliteConstructor = new (path: string) => SqliteDatabase;

/**
 * Lazy-loaded better-sqlite3 via createRequire (ESM-compatible).
 * Returns null if the package is not installed (graceful degradation).
 */
function loadSqlite(): SqliteConstructor | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("better-sqlite3") as SqliteConstructor;
    return mod;
  } catch {
    return null;
  }
}

interface PiSessionMessage {
  role?: string;
  content?: unknown;
}

interface PiSessionFile {
  id?: string;
  title?: string;
  created_at?: string;
  messages?: PiSessionMessage[];
}

export interface SessionIndex {
  /** Full rebuild — drop and re-populate from all session files. */
  rebuildIndex(sessionsDir: string): Promise<{ indexed: number }>;
  /** Incremental — only index sessions modified after lastIndexedTs. */
  incrementalIndex(sessionsDir: string, lastIndexedTs?: Date | null): Promise<{ indexed: number }>;
  /** FTS5 search returning the same shape as sessionKeywordSearch. */
  search(query: string, limit: number): SessionSearchHit[];
  /** Retrieve the last-indexed timestamp from DB metadata. */
  getLastIndexedTs(): Date | null;
  /** Close the database connection. */
  close(): void;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
  session_id,
  turn_idx,
  role,
  content,
  session_title,
  created_at,
  tokenize='unicode61'
);
`;

/**
 * Open (or create) the SQLite FTS5 index.
 * Pass ":memory:" as dbPath for tests.
 * Optionally pass a pre-built SqliteDatabase for testing without native deps.
 */
export function openSessionIndex(dbPath: string, injectedDb?: SqliteDatabase): SessionIndex | null {
  let db: SqliteDatabase;
  if (injectedDb) {
    db = injectedDb;
  } else {
    const Sqlite = loadSqlite();
    if (!Sqlite) return null;
    db = new Sqlite(dbPath);
  }
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  function setMeta(key: string, value: string): void {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  function getMeta(key: string): string | null {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  function insertTurns(sessions: Array<{
    id: string;
    title: string;
    createdAt: string;
    messages: Array<{ role: string; content: string; index: number }>;
  }>): number {
    const insert = db.prepare(
      "INSERT INTO session_fts (session_id, turn_idx, role, content, session_title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    let count = 0;
    const seenContent = new Set<string>();
    const tx = db.transaction(() => {
      for (const s of sessions) {
        for (const m of s.messages) {
          if (!m.content.trim()) continue;
          const fingerprint = createHash("sha256")
            .update(m.content)
            .digest("hex")
            .slice(0, 16);
          if (seenContent.has(fingerprint)) continue;
          seenContent.add(fingerprint);
          insert.run(s.id, String(m.index), m.role, m.content, s.title, s.createdAt);
          count++;
        }
      }
    });
    tx();
    return count;
  }

  async function collectFiles(dir: string): Promise<string[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const name of names) {
      const full = path.join(dir, name);
      let st;
      try { st = await fs.stat(full); } catch { continue; }
      if (st.isDirectory()) {
        files.push(...await collectFiles(full));
      } else if (st.isFile() && (name.endsWith(".json") || name.endsWith(".jsonl"))) {
        files.push(full);
      }
    }
    return files;
  }

  async function loadSessionFiles(sessionsDir: string, modifiedAfter?: Date | null): Promise<Array<{
    id: string;
    title: string;
    createdAt: string;
    messages: Array<{ role: string; content: string; index: number }>;
  }>> {
    const filePaths = await collectFiles(sessionsDir);
    const results: Array<{
      id: string; title: string; createdAt: string;
      messages: Array<{ role: string; content: string; index: number }>;
    }> = [];

    for (const filePath of filePaths) {
      let st;
      try { st = await fs.stat(filePath); } catch { continue; }
      if (!st.isFile()) continue;
      if (modifiedAfter && st.mtime <= modifiedAfter) continue;

      let raw: string;
      try { raw = await fs.readFile(filePath, "utf8"); } catch { continue; }

      if (filePath.endsWith(".jsonl")) {
        const parsed = parseActiveBranchJsonl(raw, filePath);
        if (!parsed) continue;
        const messages = parsed.turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
          index: turn.turnIndex,
        }));
        results.push({
          id: parsed.id,
          title: parsed.title,
          createdAt: parsed.createdAt,
          messages,
        });
      } else {
        let session: PiSessionFile;
        try { session = JSON.parse(raw) as PiSessionFile; } catch { continue; }
        const sessionId = session.id ?? path.basename(filePath, ".json");
        const messages: Array<{ role: string; content: string; index: number }> = [];
        for (let i = 0; i < (session.messages?.length ?? 0); i++) {
          const msg = session.messages![i]!;
          const text = messageText(msg.content);
          if (text.trim()) {
            messages.push({ role: msg.role ?? "unknown", content: text, index: i });
          }
        }
        if (messages.length > 0) {
          results.push({ id: sessionId, title: session.title ?? "", createdAt: session.created_at ?? "", messages });
        }
      }
    }
    return results;
  }

  return {
    async rebuildIndex(sessionsDir: string): Promise<{ indexed: number }> {
      db.exec("DELETE FROM session_fts");
      const sessions = await loadSessionFiles(sessionsDir);
      const indexed = insertTurns(sessions);
      setMeta("last_indexed_ts", new Date().toISOString());
      return { indexed };
    },

    async incrementalIndex(sessionsDir: string, lastIndexedTs?: Date | null): Promise<{ indexed: number }> {
      const effectiveTs = lastIndexedTs ??
        (() => {
          const raw = getMeta("last_indexed_ts");
          return raw ? new Date(raw) : null;
        })();
      const sessions = await loadSessionFiles(sessionsDir, effectiveTs);
      if (sessions.length === 0) return { indexed: 0 };

      const sessionIds = sessions.map((s) => s.id);
      const deletePlaceholders = sessionIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM session_fts WHERE session_id IN (${deletePlaceholders})`).run(...sessionIds);

      const indexed = insertTurns(sessions);
      setMeta("last_indexed_ts", new Date().toISOString());
      return { indexed };
    },

    search(query: string, limit: number): SessionSearchHit[] {
      const q = query.trim();
      if (!q || limit <= 0) return [];

      const ftsQuery = q
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => `"${term.replace(/"/g, '""')}"`)
        .join(" AND ");

      if (!ftsQuery) return [];

      try {
        const rows = db.prepare(
          `SELECT session_id, turn_idx, role, snippet(session_fts, 3, '>>>', '<<<', '...', 40) as snip, session_title, created_at
           FROM session_fts
           WHERE session_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        ).all(ftsQuery, limit) as Array<{
          session_id: string;
          turn_idx: string;
          role: string;
          snip: string;
          session_title: string;
          created_at: string;
        }>;

        return rows.map((r) => ({
          session_id: r.session_id,
          session_title: r.session_title,
          role: r.role,
          snippet: r.snip.replace(/>>>/g, "").replace(/<<</g, ""),
          msg_index: parseInt(r.turn_idx, 10),
          created_at: r.created_at,
        }));
      } catch {
        return [];
      }
    },

    getLastIndexedTs(): Date | null {
      const raw = getMeta("last_indexed_ts");
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    },

    close(): void {
      db.close();
    },
  };
}
