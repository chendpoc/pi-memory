import { createRequire } from "node:module";

import type {
  PendingSession,
  Stage1Output,
  ConsolidationStatus,
} from "../types.js";

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

function loadSqlite(): SqliteConstructor | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("better-sqlite3") as SqliteConstructor;
    return mod;
  } catch {
    return null;
  }
}

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pending_sessions (
  session_id TEXT PRIMARY KEY,
  session_file TEXT NOT NULL,
  cwd TEXT NOT NULL,
  git_root TEXT,
  project_hash TEXT,
  parent_session_id TEXT,
  parent_session_file TEXT,
  user_turn_count INTEGER NOT NULL,
  ended_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'skipped', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_sessions_status ON pending_sessions(status);
CREATE TABLE IF NOT EXISTS stage1_outputs (
  session_id TEXT PRIMARY KEY,
  session_file TEXT NOT NULL,
  source_mtime_ms INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  raw_memory TEXT NOT NULL,
  rollout_summary TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'skipped', 'failed')),
  selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_usage TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage1_outputs_status ON stage1_outputs(status);
`;

const UPSERT_PENDING_SQL = `
INSERT INTO pending_sessions (
  session_id,
  session_file,
  cwd,
  git_root,
  project_hash,
  parent_session_id,
  parent_session_file,
  user_turn_count,
  ended_at,
  status,
  error_message,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  session_file = excluded.session_file,
  cwd = excluded.cwd,
  git_root = excluded.git_root,
  project_hash = excluded.project_hash,
  parent_session_id = excluded.parent_session_id,
  parent_session_file = excluded.parent_session_file,
  user_turn_count = excluded.user_turn_count,
  ended_at = excluded.ended_at,
  status = excluded.status,
  error_message = excluded.error_message,
  updated_at = excluded.updated_at;
`;

const UPSERT_STAGE1_SQL = `
INSERT INTO stage1_outputs (
  session_id,
  session_file,
  source_mtime_ms,
  generated_at,
  raw_memory,
  rollout_summary,
  scope,
  status,
  selected_for_phase2,
  usage_count,
  last_usage,
  error_message
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  session_file = excluded.session_file,
  source_mtime_ms = excluded.source_mtime_ms,
  generated_at = excluded.generated_at,
  raw_memory = excluded.raw_memory,
  rollout_summary = excluded.rollout_summary,
  scope = excluded.scope,
  status = excluded.status,
  selected_for_phase2 = excluded.selected_for_phase2,
  usage_count = excluded.usage_count,
  last_usage = excluded.last_usage,
  error_message = excluded.error_message;
`;

export interface ConsolidationStore {
  upsertPendingSession(session: Omit<PendingSession, "created_at" | "updated_at"> & {
    created_at: string;
    updated_at: string;
  }): PendingSession;
  upsertStage1Output(output: Stage1Output): void;
  getPendingSession(sessionId: string): PendingSession | null;
  listPendingSessions(limit?: number): PendingSession[];
  setPendingSessionStatus(
    sessionId: string,
    status: ConsolidationStatus,
    errorMessage?: string | null,
    updatedAt?: string,
  ): void;
  getStage1Output(sessionId: string): Stage1Output | null;
  listUnselectedStage1(limit: number): Stage1Output[];
  listStage1OlderThan(cutoffIso: string, limit?: number): Stage1Output[];
  markStage1Selected(sessionIds: string[]): void;
  incrementStage1Usage(sessionId: string, usedAt?: string): void;
  countPendingSessions(): number;
  getConsolidationStatusCounts(): {
    pending: number;
    processing: number;
    done: number;
    skipped: number;
    failed: number;
  };
  getStage1Count(): number;
  getLastGeneratedAt(): string | null;
  getLastUpdatedAt(): string | null;
  close(): void;
}

function toIsoTimestamp(value: Date | string | undefined = new Date()): string {
  const dt = typeof value === "string" ? new Date(value) : value;
  return dt.toISOString();
}

function getUserVersion(db: SqliteDatabase): number {
  const raw = db.pragma("user_version");
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === "object" && "user_version" in raw[0]) {
    return Number((raw[0] as { user_version: number }).user_version);
  }
  if (typeof raw === "number") return raw;
  return 0;
}

function setUserVersion(db: SqliteDatabase, version: number): void {
  db.pragma(`user_version = ${version}`);
}

function normalizeSessionRow(row: Record<string, unknown> | undefined | null): PendingSession | null {
  if (!row) return null;
  return {
    session_id: String(row.session_id ?? ""),
    session_file: String(row.session_file ?? ""),
    cwd: String(row.cwd ?? ""),
    git_root: row.git_root == null ? null : String(row.git_root),
    project_hash: row.project_hash == null ? null : String(row.project_hash),
    parent_session_id: row.parent_session_id == null ? null : String(row.parent_session_id),
    parent_session_file: row.parent_session_file == null ? null : String(row.parent_session_file),
    user_turn_count: Number(row.user_turn_count ?? 0),
    ended_at: String(row.ended_at ?? ""),
    status: String(row.status ?? "pending") as ConsolidationStatus,
    error_message: row.error_message == null ? null : String(row.error_message),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function normalizeStage1Row(row: Record<string, unknown> | undefined | null): Stage1Output | null {
  if (!row) return null;
  return {
    session_id: String(row.session_id ?? ""),
    session_file: String(row.session_file ?? ""),
    source_mtime_ms: toNumber(row.source_mtime_ms, 0),
    generated_at: String(row.generated_at ?? ""),
    raw_memory: String(row.raw_memory ?? ""),
    rollout_summary: String(row.rollout_summary ?? ""),
    scope: String(row.scope ?? "global"),
    status: String(row.status ?? "pending") as ConsolidationStatus,
    selected_for_phase2: Number(row.selected_for_phase2 ?? 0) === 1,
    usage_count: toNumber(row.usage_count, 0),
    last_usage: row.last_usage == null ? null : String(row.last_usage),
    error_message: row.error_message == null ? null : String(row.error_message),
  };
}

function toBoolInt(value: boolean): number {
  return value ? 1 : 0;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Lazy-open a sqlite database and ensure the consolidation schema exists.
 * Returns null when better-sqlite3 is unavailable and no injected DB is provided.
 */
export function openConsolidationStore(
  dbPath: string,
  injectedDb?: SqliteDatabase,
): ConsolidationStore | null {
  let db: SqliteDatabase;
  if (injectedDb) {
    db = injectedDb;
  } else {
    const Sqlite = loadSqlite();
    if (!Sqlite) return null;
    db = new Sqlite(dbPath);
  }

  db.pragma("journal_mode = WAL");
  const current = getUserVersion(db);
  if (current !== SCHEMA_VERSION) {
    db.exec(SCHEMA_SQL);
    setUserVersion(db, SCHEMA_VERSION);
  }

  const upsertPendingStmt = db.prepare(UPSERT_PENDING_SQL);
  const upsertStage1Stmt = db.prepare(UPSERT_STAGE1_SQL);
  const selectPendingByIdStmt = db.prepare("SELECT * FROM pending_sessions WHERE session_id = ?");
  const listPendingStmt = db.prepare(
    "SELECT * FROM pending_sessions WHERE status IN ('pending', 'failed') ORDER BY ended_at ASC LIMIT ?",
  );
  const updatePendingStatusStmt = db.prepare(
    "UPDATE pending_sessions SET status = ?, error_message = ?, updated_at = ? WHERE session_id = ?",
  );
  const selectStage1ByIdStmt = db.prepare("SELECT * FROM stage1_outputs WHERE session_id = ?");
  const listUnselectedStage1Stmt = db.prepare(
    "SELECT * FROM stage1_outputs WHERE selected_for_phase2 = 0 AND status = 'done' ORDER BY generated_at DESC LIMIT ?",
  );
  const listStage1OlderThanStmt = db.prepare(
    "SELECT * FROM stage1_outputs WHERE last_usage IS NOT NULL AND last_usage < ? ORDER BY last_usage ASC LIMIT ?",
  );
  const markStage1SelectedStmt = db.prepare(
    "UPDATE stage1_outputs SET selected_for_phase2 = 1 WHERE session_id = ?",
  );
  const incrementStage1UsageStmt = db.prepare(
    "UPDATE stage1_outputs SET usage_count = usage_count + 1, last_usage = ? WHERE session_id = ?",
  );
  const countPendingAllStmt = db.prepare("SELECT COUNT(*) AS count FROM pending_sessions");
  const countPendingByStatusStmt = db.prepare(
    "SELECT status, COUNT(*) AS count FROM pending_sessions GROUP BY status",
  );
  const countStage1Stmt = db.prepare("SELECT COUNT(*) AS count FROM stage1_outputs");
  const lastGeneratedStmt = db.prepare("SELECT MAX(generated_at) AS generated_at FROM stage1_outputs");
  const lastUpdatedStmt = db.prepare("SELECT MAX(updated_at) AS updated_at FROM pending_sessions");

  return {
    upsertPendingSession(session): PendingSession {
      const now = toIsoTimestamp(session.updated_at);
      const payload = {
        ...session,
        created_at: session.created_at ?? now,
        updated_at: now,
      };
      upsertPendingStmt.run(
        payload.session_id,
        payload.session_file,
        payload.cwd,
        payload.git_root,
        payload.project_hash,
        payload.parent_session_id,
        payload.parent_session_file,
        payload.user_turn_count,
        payload.ended_at,
        payload.status,
        payload.error_message,
        payload.created_at,
        payload.updated_at,
      );
      return payload;
    },
    upsertStage1Output(output): void {
      upsertStage1Stmt.run(
        output.session_id,
        output.session_file,
        output.source_mtime_ms,
        output.generated_at,
        output.raw_memory,
        output.rollout_summary,
        output.scope,
        output.status,
        toBoolInt(output.selected_for_phase2),
        output.usage_count,
        output.last_usage,
        output.error_message,
      );
    },
    getPendingSession(sessionId: string): PendingSession | null {
      return normalizeSessionRow(
        selectPendingByIdStmt.get(sessionId) as Record<string, unknown> | undefined,
      );
    },
    listPendingSessions(limit = 100): PendingSession[] {
      const rows = listPendingStmt.all(limit) as Array<Record<string, unknown>>;
      return rows
        .map((row) => normalizeSessionRow(row))
        .filter((row): row is PendingSession => row != null);
    },
    setPendingSessionStatus(
      sessionId: string,
      status: ConsolidationStatus,
      errorMessage: string | null = null,
      updatedAt = new Date().toISOString(),
    ): void {
      updatePendingStatusStmt.run(status, errorMessage, updatedAt, sessionId);
    },
    getStage1Output(sessionId: string): Stage1Output | null {
      return normalizeStage1Row(
        selectStage1ByIdStmt.get(sessionId) as Record<string, unknown> | undefined,
      );
    },
    listUnselectedStage1(limit: number): Stage1Output[] {
      const rows = listUnselectedStage1Stmt.all(limit) as Array<Record<string, unknown>>;
      return rows
        .map((row) => normalizeStage1Row(row))
        .filter((row): row is Stage1Output => row != null);
    },
    listStage1OlderThan(cutoffIso: string, limit = 100): Stage1Output[] {
      const rows = listStage1OlderThanStmt.all(cutoffIso, limit) as Array<Record<string, unknown>>;
      return rows
        .map((row) => normalizeStage1Row(row))
        .filter((row): row is Stage1Output => row != null);
    },
    markStage1Selected(sessionIds: string[]): void {
      const tx = db.transaction(() => {
        for (const sessionId of sessionIds) markStage1SelectedStmt.run(sessionId);
      });
      tx();
    },
    incrementStage1Usage(sessionId: string, usedAt = new Date().toISOString()): void {
      incrementStage1UsageStmt.run(usedAt, sessionId);
    },
    countPendingSessions(): number {
      const row = countPendingAllStmt.get() as { count?: number | string } | undefined;
      return toNumber(row?.count, 0);
    },
    getConsolidationStatusCounts() {
      const rows = countPendingByStatusStmt.all() as Array<{
        status: ConsolidationStatus;
        count: number | string;
      }>;
      const counts = {
        pending: 0,
        processing: 0,
        done: 0,
        skipped: 0,
        failed: 0,
      };
      for (const row of rows) {
        const status = row.status;
        if (status in counts) {
          counts[status] = toNumber(row.count, 0);
        }
      }
      return counts;
    },
    getStage1Count(): number {
      const row = countStage1Stmt.get() as { count?: number | string } | undefined;
      return toNumber(row?.count, 0);
    },
    getLastGeneratedAt(): string | null {
      const row = lastGeneratedStmt.get() as { generated_at?: string } | undefined;
      if (!row?.generated_at) return null;
      return String(row.generated_at);
    },
    getLastUpdatedAt(): string | null {
      const row = lastUpdatedStmt.get() as { updated_at?: string } | undefined;
      if (!row?.updated_at) return null;
      return String(row.updated_at);
    },
    close(): void {
      db.close();
    },
  };
}
