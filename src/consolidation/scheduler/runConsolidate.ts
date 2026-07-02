import path from "node:path";

import type { MemoryConfig } from "../../config.js";
import { trainBundle } from "../../trainer/index.js";
import { withFileLock } from "../lock.js";
import { appendConsolidationLog } from "../log.js";
import { runPhase2, type Phase2Report } from "../phase2/runPhase2.js";
import { drainQueue, type DrainQueueReport } from "../stage1/drainQueue.js";
import { openConsolidationStore } from "../stage1/store.js";

export interface ConsolidateOptions {
  config: MemoryConfig;
  dbPath?: string;
  dryRun?: boolean;
  phase1Only?: boolean;
  phase2Only?: boolean;
}

export interface ConsolidateReport {
  dryRun: boolean;
  dbPath: string;
  drain?: DrainQueueReport;
  train?: {
    sessionsProcessed: number;
    entityCount: number;
    relationCount: number;
    eventCount: number;
    dryRun: boolean;
  };
  phase2?: Phase2Report;
}

export function defaultConsolidationDbPath(cfg: MemoryConfig): string {
  return path.join(cfg.bundleRoot, "memories.sqlite");
}

export async function runConsolidate(
  opts: ConsolidateOptions,
): Promise<ConsolidateReport> {
  const cfg = opts.config;
  const dbPath = opts.dbPath ?? defaultConsolidationDbPath(cfg);
  const dryRun = opts.dryRun ?? false;
  const lockPath = path.join(cfg.bundleRoot, ".consolidation.lock");
  const logPath = cfg.consolidation.schedule.log_path;

  return withFileLock(lockPath, async () => {
    const store = openConsolidationStore(dbPath);
    if (!store) {
      throw new Error("better-sqlite3 unavailable; cannot open consolidation store");
    }

    try {
      const report: ConsolidateReport = { dryRun, dbPath };

      if (!opts.phase2Only) {
        report.drain = await drainQueue(store, { dryRun });
        await appendConsolidationLog(logPath, {
          phase: "phase1",
          sessions_processed: report.drain.sessionsProcessed,
          sessions_skipped: report.drain.sessionsSkipped,
          sessions_failed: report.drain.sessionsFailed,
          stage1_new_rows: report.drain.stage1NewRows,
          dry_run: dryRun,
        });

        const trainResult = await trainBundle({
          sessionsDir: cfg.sessionsDir,
          bundleRoot: cfg.bundleRoot,
          dryRun,
          full: false,
        });
        report.train = {
          sessionsProcessed: trainResult.sessionsProcessed,
          entityCount: trainResult.entityCount,
          relationCount: trainResult.relationCount,
          eventCount: trainResult.eventCount,
          dryRun: trainResult.dryRun,
        };
        await appendConsolidationLog(logPath, {
          phase: "graph_train",
          sessions_processed: trainResult.sessionsProcessed,
          entities: trainResult.entityCount,
          relations: trainResult.relationCount,
          events: trainResult.eventCount,
          dry_run: dryRun,
        });
      }

      if (!opts.phase1Only) {
        const memoryMdPath = cfg.memoryMdPaths[0] ?? path.join(cfg.bundleRoot, "MEMORY.md");
        report.phase2 = await runPhase2(store, {
          memoryMdPath,
          bundleRoot: cfg.bundleRoot,
          topN: cfg.consolidation.phase2_top_n,
          dryRun,
          maxLines: cfg.consolidation.memory_index_max_lines,
          maxBytes: cfg.consolidation.memory_index_max_bytes,
          maxUnusedDays: cfg.consolidation.max_unused_days,
        });
        await appendConsolidationLog(logPath, {
          phase: "phase2",
          stage1_selected: report.phase2.stage1Selected,
          appended: report.phase2.appended,
          skipped_dedup: report.phase2.skippedDedup,
          backups_created: report.phase2.backupsCreated,
          dry_run: dryRun,
        });
      }

      return report;
    } finally {
      store.close();
    }
  });
}
