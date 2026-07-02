import fs from "node:fs";

import type {
  ConsolidationStatus,
  JobReport,
  PendingSession,
  ConsolidationStatusReport,
} from "./types.js";
import { openConsolidationStore, type SqliteDatabase } from "./stage1/store.js";

export interface EnqueueSessionInput {
  session_id: string;
  session_file: string;
  cwd: string;
  git_root: string | null;
  project_hash: string | null;
  parent_session_id: string | null;
  parent_session_file: string | null;
  user_turn_count: number;
  ended_at: string;
}

export interface EnqueueOptions {
  enabled?: boolean;
  minUserTurns?: number;
  /** Injected sqlite handle for tests. */
  db?: SqliteDatabase;
  /** Force replacing existing done/skipped sessions. */
  force?: boolean;
  /** Override status for the newly enqueued job (default: pending). */
  status?: ConsolidationStatus;
  /** Optional now source for created_at / updated_at. */
  now?: Date | string;
  /** Test seam: production defaults to checking session file existence. */
  checkFileExists?: boolean;
}

function toIso(value: Date | string | undefined): string {
  const dt = value ? new Date(value) : new Date();
  return dt.toISOString();
}

function isMissingFile(file: string): boolean {
  return typeof file !== "string" || !file.trim();
}

function isAllowedStatus(status: string): status is ConsolidationStatus {
  return status === "pending" || status === "processing" || status === "done" || status === "skipped" ||
    status === "failed";
}

export function enqueueSession(
  dbPath: string,
  meta: EnqueueSessionInput,
  opts: EnqueueOptions = {},
): JobReport {
  const enabled = opts.enabled !== false;
  const minUserTurns = opts.minUserTurns ?? 3;
  const now = toIso(opts.now);

  if (!enabled) {
    return {
      session_id: meta.session_id,
      enqueued: false,
      action: "skipped",
      status: "skipped",
      reason: "consolidation_disabled",
      now,
    };
  }

  if (isMissingFile(meta.session_file)) {
    return {
      session_id: meta.session_id,
      enqueued: false,
      action: "skipped",
      status: "skipped",
      reason: "missing_session_file",
      now,
    };
  }

  if (opts.checkFileExists !== false && !fs.existsSync(meta.session_file)) {
    return {
      session_id: meta.session_id,
      enqueued: false,
      action: "skipped",
      status: "skipped",
      reason: "session_file_not_found",
      now,
    };
  }

  if (meta.user_turn_count < minUserTurns) {
    return {
      session_id: meta.session_id,
      enqueued: false,
      action: "skipped",
      status: "skipped",
      reason: "insufficient_user_turns",
      now,
    };
  }

  const store = openConsolidationStore(dbPath, opts.db);
  if (!store) {
    return {
      session_id: meta.session_id,
      enqueued: false,
      action: "skipped",
      status: "skipped",
      reason: "missing_sqlite",
      now,
    };
  }

  const incomingStatus: ConsolidationStatus = isAllowedStatus(opts.status ?? "") ? opts.status! : "pending";
  const existing = store.getPendingSession(meta.session_id);
  const isFinal = existing?.status === "done" || existing?.status === "skipped";

  if (existing && isFinal && !opts.force) {
    store.close();
    return {
      session_id: meta.session_id,
      enqueued: false,
      action: "skipped",
      status: existing.status,
      reason: "already_finalized",
      now,
    };
  }

  const existingCreatedAt = existing?.created_at ?? now;
  const payload: Omit<PendingSession, "created_at" | "updated_at"> & {
    created_at: string;
    updated_at: string;
  } = {
    session_id: meta.session_id,
    session_file: meta.session_file,
    cwd: meta.cwd,
    git_root: meta.git_root,
    project_hash: meta.project_hash,
    parent_session_id: meta.parent_session_id,
    parent_session_file: meta.parent_session_file,
    user_turn_count: meta.user_turn_count,
    ended_at: meta.ended_at,
    status: incomingStatus,
    error_message: null,
    created_at: existingCreatedAt,
    updated_at: now,
  };

  try {
    store.upsertPendingSession(payload);
    const action = existing ? "updated" : "created";
    return {
      session_id: meta.session_id,
      enqueued: true,
      action,
      status: incomingStatus,
      now,
    };
  } finally {
    store.close();
  }
}

export interface ConsolidationStatusQueryOptions {
  db?: SqliteDatabase;
}

export function getConsolidationStatus(
  dbPath: string,
  opts: ConsolidationStatusQueryOptions = {},
): ConsolidationStatusReport {
  const store = openConsolidationStore(dbPath, opts.db);
  if (!store) {
    return {
      pending: 0,
      processing: 0,
      done: 0,
      skipped: 0,
      failed: 0,
      stage1Count: 0,
      lastGeneratedAt: null,
      lastUpdatedAt: null,
    };
  }

  try {
    const byStatus = store.getConsolidationStatusCounts();
    return {
      pending: byStatus.pending,
      processing: byStatus.processing,
      done: byStatus.done,
      skipped: byStatus.skipped,
      failed: byStatus.failed,
      stage1Count: store.getStage1Count(),
      lastGeneratedAt: store.getLastGeneratedAt(),
      lastUpdatedAt: store.getLastUpdatedAt(),
    };
  } finally {
    store.close();
  }
}
