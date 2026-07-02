import type { ConsolidationStore } from "./store.js";
import { computeDeltaTurns } from "./deltaExtract.js";
import { extractSessionToStage1 } from "./extractSession.js";
import type { PendingSession } from "../types.js";
import { loadSessionFile, type SessionTurn } from "../../trainer/sessionLoader.js";

export interface DrainQueueOptions {
  limit?: number;
  dryRun?: boolean;
  now?: string;
}

export interface DrainQueueReport {
  sessionsProcessed: number;
  sessionsSkipped: number;
  sessionsFailed: number;
  stage1NewRows: number;
  dryRun: boolean;
  details: Array<{
    session_id: string;
    status: "processed" | "skipped" | "failed";
    reason?: string;
    delta_turns?: number;
  }>;
}

function topoSortPending(sessions: PendingSession[]): PendingSession[] {
  const byId = new Map(sessions.map((session) => [session.session_id, session]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const out: PendingSession[] = [];

  function visit(session: PendingSession): void {
    if (visited.has(session.session_id)) return;
    if (visiting.has(session.session_id)) {
      out.push(session);
      visited.add(session.session_id);
      return;
    }
    visiting.add(session.session_id);
    const parent = session.parent_session_id
      ? byId.get(session.parent_session_id)
      : undefined;
    if (parent) visit(parent);
    visiting.delete(session.session_id);
    visited.add(session.session_id);
    out.push(session);
  }

  for (const session of sessions) visit(session);
  return out;
}

async function loadTurns(filePath: string): Promise<SessionTurn[] | null> {
  const session = await loadSessionFile(filePath);
  return session?.turns ?? null;
}

async function turnsForExtraction(
  pending: PendingSession,
): Promise<{ turns: SessionTurn[]; delta: boolean } | null> {
  const childTurns = await loadTurns(pending.session_file);
  if (!childTurns) return null;
  if (!pending.parent_session_file) {
    return { turns: childTurns, delta: false };
  }
  const parentTurns = await loadTurns(pending.parent_session_file).catch(() => null);
  if (!parentTurns) return { turns: childTurns, delta: false };
  return { turns: computeDeltaTurns(parentTurns, childTurns), delta: true };
}

export async function drainQueue(
  store: ConsolidationStore,
  opts: DrainQueueOptions = {},
): Promise<DrainQueueReport> {
  const dryRun = opts.dryRun ?? false;
  const pending = topoSortPending(store.listPendingSessions(opts.limit ?? 100));
  const report: DrainQueueReport = {
    sessionsProcessed: 0,
    sessionsSkipped: 0,
    sessionsFailed: 0,
    stage1NewRows: 0,
    dryRun,
    details: [],
  };

  for (const session of pending) {
    try {
      const loaded = await turnsForExtraction(session);
      if (!loaded) {
        report.sessionsSkipped++;
        report.details.push({
          session_id: session.session_id,
          status: "skipped",
          reason: "session_unreadable",
        });
        if (!dryRun) store.setPendingSessionStatus(session.session_id, "skipped");
        continue;
      }

      if (loaded.delta && loaded.turns.length === 0) {
        report.sessionsSkipped++;
        report.details.push({
          session_id: session.session_id,
          status: "skipped",
          reason: "clone_no_delta",
          delta_turns: 0,
        });
        if (!dryRun) store.setPendingSessionStatus(session.session_id, "skipped");
        continue;
      }

      const output = await extractSessionToStage1(session, loaded.turns, {
        now: opts.now,
      });
      report.sessionsProcessed++;
      report.stage1NewRows++;
      report.details.push({
        session_id: session.session_id,
        status: "processed",
        delta_turns: loaded.turns.length,
      });
      if (!dryRun) {
        store.upsertStage1Output(output);
        store.setPendingSessionStatus(
          session.session_id,
          output.status === "skipped" ? "skipped" : "done",
        );
      }
    } catch (err) {
      report.sessionsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      report.details.push({
        session_id: session.session_id,
        status: "failed",
        reason: message,
      });
      if (!dryRun) store.setPendingSessionStatus(session.session_id, "failed", message);
    }
  }

  return report;
}
