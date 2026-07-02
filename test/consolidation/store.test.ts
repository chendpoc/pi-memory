import { describe, expect, it } from "vitest";

import {
  type ConsolidationStatus,
  type PendingSession,
  type Stage1Output,
} from "../../src/consolidation/types.js";
import { type SqliteDatabase, openConsolidationStore } from "../../src/consolidation/stage1/store.js";
import {
  enqueueSession,
  type EnqueueSessionInput,
  getConsolidationStatus,
} from "../../src/consolidation/enqueue.js";

function createMockDb(): {
  db: SqliteDatabase;
  execStatements: string[];
  userVersion: number;
  getPendingRows: () => Array<PendingSession>;
  getStage1Rows: () => Array<Stage1Output>;
} {
  let userVersion = 0;
  const pendingRows = new Map<string, PendingSession>();
  const stage1Rows = new Map<string, Stage1Output>();
  const execStatements: string[] = [];

  function upsertPending(args: unknown[]): void {
    const [
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
      updated_at,
    ] = args;
    const existing = pendingRows.get(String(session_id));

    pendingRows.set(String(session_id), {
      session_id: String(session_id),
      session_file: String(session_file),
      cwd: String(cwd),
      git_root: git_root == null ? null : String(git_root),
      project_hash: project_hash == null ? null : String(project_hash),
      parent_session_id: parent_session_id == null ? null : String(parent_session_id),
      parent_session_file: parent_session_file == null ? null : String(parent_session_file),
      user_turn_count: Number(user_turn_count),
      ended_at: String(ended_at),
      status: String(status) as ConsolidationStatus,
      error_message: error_message == null ? null : String(error_message),
      created_at: existing?.created_at ?? String(created_at),
      updated_at: String(updated_at),
    });
  }

  function upsertStage1(args: unknown[]): void {
    const [
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
      error_message,
    ] = args;
    stage1Rows.set(String(session_id), {
      session_id: String(session_id),
      session_file: String(session_file),
      source_mtime_ms: Number(source_mtime_ms),
      generated_at: String(generated_at),
      raw_memory: String(raw_memory),
      rollout_summary: String(rollout_summary),
      scope: String(scope),
      status: String(status) as ConsolidationStatus,
      selected_for_phase2: Number(selected_for_phase2) === 1,
      usage_count: Number(usage_count),
      last_usage: last_usage == null ? null : String(last_usage),
      error_message: error_message == null ? null : String(error_message),
    });
  }

  return {
    db: {
      pragma(sql: string) {
        if (sql.startsWith("user_version =")) {
          const value = Number(sql.split("=").at(-1));
          userVersion = Number.isFinite(value) ? value : 0;
          return [];
        }
        if (sql === "user_version") {
          return [{ user_version: userVersion }];
        }
        return [];
      },
      exec(sql: string) {
        execStatements.push(sql);
      },
      prepare(sql: string) {
        if (sql.includes("INSERT INTO pending_sessions")) {
          return {
            run: (...args: unknown[]) => {
              upsertPending(args);
              return {};
            },
            get: () => undefined,
            all: () => [],
          };
        }

        if (sql.includes("INSERT INTO stage1_outputs")) {
          return {
            run: (...args: unknown[]) => {
              upsertStage1(args);
              return {};
            },
            get: () => undefined,
            all: () => [],
          };
        }

        if (sql.includes("SELECT * FROM pending_sessions WHERE session_id")) {
          return {
            run: () => undefined,
            get: (...args: unknown[]) => pendingRows.get(String(args[0])) as PendingSession | undefined,
            all: () => [],
          };
        }

        if (sql.includes("SELECT status, COUNT(*) AS count FROM pending_sessions")) {
          return {
            run: () => undefined,
            get: () => undefined,
            all: () => {
              const map = new Map<string, number>();
              for (const row of pendingRows.values()) {
                map.set(row.status, (map.get(row.status) ?? 0) + 1);
              }
              return Array.from(map.entries()).map(([status, count]) => ({ status, count }));
            },
          };
        }

        if (sql.includes("SELECT COUNT(*) AS count FROM pending_sessions")) {
          return {
            run: () => undefined,
            get: () => ({ count: pendingRows.size }),
            all: () => [],
          };
        }

        if (sql.includes("SELECT COUNT(*) AS count FROM stage1_outputs")) {
          return {
            run: () => undefined,
            get: () => ({ count: stage1Rows.size }),
            all: () => [],
          };
        }

        if (sql.includes("SELECT MAX(generated_at)")) {
          return {
            run: () => undefined,
            get: () => {
              const maxGenerated = Array.from(stage1Rows.values())
                .map((row) => row.generated_at)
                .sort()
                .at(-1);
              return maxGenerated ? { generated_at: maxGenerated } : {};
            },
            all: () => [],
          };
        }

        if (sql.includes("SELECT MAX(updated_at)")) {
          return {
            run: () => undefined,
            get: () => {
              const maxUpdated = Array.from(pendingRows.values())
                .map((row) => row.updated_at)
                .sort()
                .at(-1);
              return maxUpdated ? { updated_at: maxUpdated } : {};
            },
            all: () => [],
          };
        }

        return {
          run: () => undefined,
          get: () => undefined,
          all: () => [],
        };
      },
      transaction<T>(fn: () => T) { return fn; },
      close() {},
    },
    execStatements,
    get userVersion() { return userVersion; },
    getPendingRows: () => Array.from(pendingRows.values()),
    getStage1Rows: () => Array.from(stage1Rows.values()),
  };
}

const baseMeta: EnqueueSessionInput = {
  session_id: "session-1",
  session_file: "/abs/session-1.jsonl",
  cwd: "/workspace",
  git_root: "/workspace",
  project_hash: "abc123",
  parent_session_id: null,
  parent_session_file: null,
  user_turn_count: 5,
  ended_at: "2026-07-02T10:00:00.000Z",
};

describe("consolidation store + enqueue", () => {
  it("migrates schema and sets schema version", () => {
    const mock = createMockDb();
    const store = openConsolidationStore(":memory:", mock.db);
    expect(store).not.toBeNull();
    store?.close();
    expect(mock.execStatements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS pending_sessions"))).toBe(true);
    expect(mock.execStatements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS stage1_outputs"))).toBe(true);
    expect(mock.userVersion).toBe(1);
  });

  it("blocks enqueue by gate conditions", () => {
    const mock = createMockDb();
    const disabled = enqueueSession(":memory:", baseMeta, { enabled: false, db: mock.db });
    const missingFile = enqueueSession(
      ":memory:",
      { ...baseMeta, session_id: "session-2", session_file: "" },
      { db: mock.db },
    );
    const fileNotFound = enqueueSession(
      ":memory:",
      { ...baseMeta, session_id: "session-4", session_file: "/definitely/missing.jsonl" },
      { db: mock.db },
    );
    const lowTurns = enqueueSession(
      ":memory:",
      { ...baseMeta, session_id: "session-3", user_turn_count: 1 },
      { minUserTurns: 3, db: mock.db, checkFileExists: false },
    );

    expect(disabled).toMatchObject({ enqueued: false, action: "skipped", reason: "consolidation_disabled" });
    expect(missingFile).toMatchObject({ enqueued: false, action: "skipped", reason: "missing_session_file" });
    expect(fileNotFound).toMatchObject({ enqueued: false, action: "skipped", reason: "session_file_not_found" });
    expect(lowTurns).toMatchObject({ enqueued: false, action: "skipped", reason: "insufficient_user_turns" });

    const status = getConsolidationStatus(":memory:", { db: mock.db });
    expect(status).toMatchObject({
      pending: 0,
      done: 0,
      processing: 0,
      failed: 0,
      skipped: 0,
      stage1Count: 0,
    });
  });

  it("is idempotent for duplicate enqueue and does not overwrite done/skipped by default", () => {
    const mock = createMockDb();
    const first = enqueueSession(":memory:", baseMeta, {
      db: mock.db,
      status: "done",
      checkFileExists: false,
    });
    const dup = enqueueSession(":memory:", { ...baseMeta, user_turn_count: 8 }, {
      db: mock.db,
      checkFileExists: false,
    });
    const forceDup = enqueueSession(":memory:", { ...baseMeta, user_turn_count: 8 }, {
      db: mock.db,
      force: true,
      checkFileExists: false,
    });

    expect(first.enqueued).toBe(true);
    expect(first.status).toBe("done");
    expect(dup.enqueued).toBe(false);
    expect(dup.reason).toBe("already_finalized");
    expect(forceDup.enqueued).toBe(true);
    expect(forceDup.status).toBe("pending");

    const store = openConsolidationStore(":memory:", mock.db)!;
    expect(store.countPendingSessions()).toBe(1);
    const row = store.getPendingSession(baseMeta.session_id);
    expect(row?.status).toBe("pending");
    expect(row?.user_turn_count).toBe(8);
    store.close();
  });

  it("aggregates consolidation status across sessions and stage1 outputs", () => {
    const mock = createMockDb();
    const store = openConsolidationStore(":memory:", mock.db)!;
    store.upsertPendingSession({
      session_id: "s1",
      session_file: "/abs/s1.jsonl",
      cwd: "/workspace",
      git_root: "/workspace",
      project_hash: "g1",
      parent_session_id: null,
      parent_session_file: null,
      user_turn_count: 4,
      ended_at: "2026-07-02T10:00:00.000Z",
      status: "pending",
      error_message: null,
      created_at: "2026-07-02T10:00:00.000Z",
      updated_at: "2026-07-02T10:00:00.000Z",
    });
    store.upsertPendingSession({
      session_id: "s2",
      session_file: "/abs/s2.jsonl",
      cwd: "/workspace",
      git_root: "/workspace",
      project_hash: "g2",
      parent_session_id: null,
      parent_session_file: null,
      user_turn_count: 3,
      ended_at: "2026-07-02T10:10:00.000Z",
      status: "done",
      error_message: null,
      created_at: "2026-07-02T10:10:00.000Z",
      updated_at: "2026-07-02T10:10:00.000Z",
    });
    store.upsertPendingSession({
      session_id: "s3",
      session_file: "/abs/s3.jsonl",
      cwd: "/workspace",
      git_root: "/workspace",
      project_hash: "g3",
      parent_session_id: null,
      parent_session_file: null,
      user_turn_count: 7,
      ended_at: "2026-07-02T10:20:00.000Z",
      status: "failed",
      error_message: "x",
      created_at: "2026-07-02T10:20:00.000Z",
      updated_at: "2026-07-02T10:25:00.000Z",
    });

    store.upsertStage1Output({
      session_id: "s1",
      session_file: "/abs/s1.jsonl",
      source_mtime_ms: 1_000,
      generated_at: "2026-07-02T11:00:00.000Z",
      raw_memory: "raw-1",
      rollout_summary: "sum-1",
      scope: "scope",
      status: "done",
      selected_for_phase2: true,
      usage_count: 0,
      last_usage: null,
      error_message: null,
    });
    store.upsertStage1Output({
      session_id: "s2",
      session_file: "/abs/s2.jsonl",
      source_mtime_ms: 2_000,
      generated_at: "2026-07-02T11:20:00.000Z",
      raw_memory: "raw-2",
      rollout_summary: "sum-2",
      scope: "scope",
      status: "pending",
      selected_for_phase2: false,
      usage_count: 2,
      last_usage: "2026-07-02T11:30:00.000Z",
      error_message: null,
    });
    store.close();

    const status = getConsolidationStatus(":memory:", { db: mock.db });
    expect(status).toMatchObject({
      pending: 1,
      processing: 0,
      done: 1,
      skipped: 0,
      failed: 1,
      stage1Count: 2,
      lastGeneratedAt: "2026-07-02T11:20:00.000Z",
      lastUpdatedAt: "2026-07-02T10:25:00.000Z",
    });
    expect(mock.getPendingRows()).toHaveLength(3);
    expect(mock.getStage1Rows()).toHaveLength(2);
  });

  it("returns empty status for empty store", () => {
    const status = getConsolidationStatus(":memory:");
    expect(status).toMatchObject({
      pending: 0,
      processing: 0,
      done: 0,
      skipped: 0,
      failed: 0,
      stage1Count: 0,
      lastGeneratedAt: null,
      lastUpdatedAt: null,
    });
  });
});
