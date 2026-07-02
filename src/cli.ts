#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { createStandaloneLLMClient } from "./adapters/piComplete.js";
import { installBundle } from "./bundle/install.js";
import type { MemoryConfig } from "./config.js";
import { getMemoryIndexStats } from "./consolidation/memoryIndex.js";
import { readRecentConsolidationLogs } from "./consolidation/log.js";
import { getConsolidationStatus } from "./consolidation/enqueue.js";
import {
  defaultConsolidationDbPath,
  runConsolidate,
} from "./consolidation/scheduler/runConsolidate.js";
import { setupSchedule } from "./consolidation/scheduler/setupSchedule.js";
import type { SchedulePlatform } from "./consolidation/scheduler/types.js";
import { loadMemoryConfig } from "./settings.js";
import { openSessionIndex } from "./fallback/sessionIndex.js";
import { SidecarClient } from "./sidecar/client.js";
import { MemoryService } from "./service.js";
import { trainBundle } from "./trainer/index.js";
import { createLLMFactExtractor } from "./trainer/llmExtractor.js";
import { createTrainScheduler } from "./trainer/scheduler.js";
import type { QueryIntent } from "./types.js";

async function tryReloadSidecar(cfg: MemoryConfig): Promise<void> {
  try {
    fs.accessSync(cfg.socketPath, fs.constants.F_OK);
  } catch {
    return;
  }
  const client = new SidecarClient(cfg.socketPath, cfg.clientRequestTimeoutMs);
  try {
    await client.reload();
  } catch {
    /* sidecar not running — install still succeeded */
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") {
    printHelp();
    process.exit(0);
  }

  const cfg = loadMemoryConfig();
  const service = new MemoryService(cfg);

  if (cmd === "health") {
    await service.start();
    const h = await service.health();
    console.log(JSON.stringify({ status: service.getStatus(), health: h }, null, 2));
    await service.stop();
    return;
  }

  if (cmd === "query") {
    const json = rest.join(" ").trim();
    if (!json) {
      console.error('Usage: pi-memory query \'{"anchor_mentions":["Alice"],"mode":"direct_relation"}\'');
      process.exit(1);
    }
    let intent: QueryIntent;
    try {
      intent = JSON.parse(json) as QueryIntent;
    } catch (e) {
      console.error("Invalid JSON intent:", e);
      process.exit(1);
    }
    await service.start();
    const result = await service.query(intent);
    console.log(JSON.stringify(result, null, 2));
    await service.stop();
    return;
  }

  if (cmd === "status") {
    await service.start();
    console.log(JSON.stringify(service.getStatus(), null, 2));
    await service.stop();
    return;
  }

  if (cmd === "memory-status") {
    const dbPath = defaultConsolidationDbPath(cfg);
    const status = getConsolidationStatus(dbPath);
    const memoryIndex = getMemoryIndexStats(cfg.memoryMdPaths, {
      maxLines: cfg.consolidation.memory_index_max_lines,
      maxBytes: cfg.consolidation.memory_index_max_bytes,
    });
    const recentLogs = await readRecentConsolidationLogs(
      cfg.consolidation.schedule.log_path,
      5,
    );
    const schedule = await readScheduleStatus(cfg);
    console.log(JSON.stringify({
      db_path: dbPath,
      queue: status,
      memory_index: memoryIndex,
      schedule,
      recent_logs: recentLogs,
    }, null, 2));
    return;
  }

  if (cmd === "consolidate") {
    const flags = parseConsolidateFlags(rest);
    const result = await runConsolidate({
      config: cfg,
      dryRun: flags.dryRun,
      phase1Only: flags.phase1Only,
      phase2Only: flags.phase2Only,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "setup-schedule") {
    const flags = parseScheduleFlags(rest);
    const platform = resolveSchedulePlatform();
    const result = await setupSchedule({
      hour: flags.hour ?? cfg.consolidation.schedule.hour,
      minute: flags.minute ?? cfg.consolidation.schedule.minute,
      logPath: cfg.consolidation.schedule.log_path,
      dryRun: flags.dryRun,
      remove: flags.remove,
      status: flags.status,
    }, platform);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "install-bundle") {
    const bundlePath = rest[0];
    if (!bundlePath) {
      console.error("Usage: pi-memory install-bundle <path-to-bundle-dir>");
      process.exit(1);
    }
    const result = await installBundle({
      bundleRoot: cfg.bundleRoot,
      sourceDir: bundlePath,
    });
    await tryReloadSidecar(cfg);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "train") {
    const flags = parseTrainFlags(rest);
    let extractOpts;
    if (flags.extractor === "llm") {
      try {
        const client = createStandaloneLLMClient(flags.model);
        extractOpts = {
          llmExtractor: createLLMFactExtractor({
            client,
            batchSize: cfg.trainer.llm_batch_size,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`LLM extractor unavailable (${message}) — falling back to regex.`);
        extractOpts = undefined;
      }
    }

    const result = await trainBundle({
      sessionsDir: flags.sessionsDir ?? cfg.sessionsDir,
      bundleRoot: cfg.bundleRoot,
      full: flags.full,
      dryRun: flags.dryRun,
      noMerge: flags.noMerge,
      extractOpts,
    });
    if (result.sessionsProcessed === 0) {
      console.log("No new sessions to process.");
    } else {
      const output: Record<string, unknown> = {
        sessions_processed: result.sessionsProcessed,
        entities: result.entityCount,
        relations: result.relationCount,
        events: result.eventCount,
        dry_run: result.dryRun,
        bundle_dir: result.bundleResult?.bundleDir ?? null,
        installed: result.installResult?.installed_dir ?? null,
      };
      if (result.delta) {
        output.delta = {
          added: result.delta.added,
          updated: result.delta.updated,
          deleted: result.delta.deleted,
          skipped: result.delta.skipped,
        };
      }
      console.log(JSON.stringify(output, null, 2));
      if (!result.dryRun) {
        await tryReloadSidecar(cfg);
      }
    }

    if (flags.watch) {
      const interval = cfg.trainer.auto_interval ?? "1h";
      console.log(`Watching for new sessions (interval: ${interval})...`);
      createTrainScheduler(
        { interval, trainConfig: { sessionsDir: flags.sessionsDir ?? cfg.sessionsDir, bundleRoot: cfg.bundleRoot } },
        (log) => {
          console.log(JSON.stringify({ type: "scheduled_run", ...log }));
        },
      );
      await new Promise(() => {}); // block forever
    }
    return;
  }

  if (cmd === "index") {
    const sessionsDir = rest.find((a, i) => rest[i - 1] === "--sessions-dir") ?? cfg.sessionsDir;
    const dbPath = path.join(cfg.bundleRoot, "sessions.db");
    const idx = openSessionIndex(dbPath);
    if (!idx) {
      console.error("Failed to open SQLite — is better-sqlite3 installed?");
      process.exit(1);
    }
    console.log(`Rebuilding FTS5 index at ${dbPath}...`);
    const { indexed } = await idx.rebuildIndex(sessionsDir);
    idx.close();
    console.log(JSON.stringify({ indexed, db_path: dbPath }));
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

function parseTrainFlags(args: string[]): {
  sessionsDir?: string;
  full: boolean;
  dryRun: boolean;
  noMerge: boolean;
  extractor: "regex" | "llm";
  watch: boolean;
  model?: string;
} {
  let sessionsDir: string | undefined;
  let full = false;
  let dryRun = false;
  let noMerge = false;
  let extractor: "regex" | "llm" = "regex";
  let watch = false;
  let model: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--full") { full = true; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--no-merge") { noMerge = true; continue; }
    if (arg === "--watch") { watch = true; continue; }
    if (arg === "--model" && i + 1 < args.length) {
      model = args[++i];
      continue;
    }
    if (arg === "--sessions-dir" && i + 1 < args.length) {
      sessionsDir = args[++i];
      continue;
    }
    if (arg === "--extractor" && i + 1 < args.length) {
      const val = args[++i]!;
      if (val === "llm" || val === "regex") extractor = val;
      continue;
    }
  }
  return { sessionsDir, full, dryRun, noMerge, extractor, watch, model };
}

function parseConsolidateFlags(args: string[]): {
  dryRun: boolean;
  phase1Only: boolean;
  phase2Only: boolean;
} {
  return {
    dryRun: args.includes("--dry-run"),
    phase1Only: args.includes("--phase1-only"),
    phase2Only: args.includes("--phase2-only"),
  };
}

function parseScheduleFlags(args: string[]): {
  hour?: number;
  minute?: number;
  dryRun: boolean;
  remove: boolean;
  status: boolean;
} {
  let hour: number | undefined;
  let minute: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--hour" && i + 1 < args.length) {
      hour = Number(args[++i]);
      continue;
    }
    if (arg === "--minute" && i + 1 < args.length) {
      minute = Number(args[++i]);
      continue;
    }
  }
  return {
    hour,
    minute,
    dryRun: args.includes("--dry-run"),
    remove: args.includes("--remove"),
    status: args.includes("--status"),
  };
}

function resolveSchedulePlatform(): SchedulePlatform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  throw new Error(`setup-schedule is not supported on ${process.platform}`);
}

function tryResolveSchedulePlatform(): SchedulePlatform | null {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return null;
}

async function readScheduleStatus(cfg: MemoryConfig) {
  const platform = tryResolveSchedulePlatform();
  if (!platform) {
    return {
      supported: false,
      platform: process.platform,
      files: [],
    };
  }
  const result = await setupSchedule({
    hour: cfg.consolidation.schedule.hour,
    minute: cfg.consolidation.schedule.minute,
    logPath: cfg.consolidation.schedule.log_path,
    status: true,
  }, platform);
  return {
    supported: true,
    platform,
    files: result.files,
  };
}

function printHelp(): void {
  console.log(`pi-memory — local TLM episodic memory (mode B)

Commands:
  health              Start sidecar (if bundle present) and print /health
  status              Print MemoryService status snapshot
  memory-status       Print consolidation queue, MEMORY.md cap, schedule status, and recent job logs
  consolidate         Run offline memory consolidation
    --dry-run         Report planned work without writing MEMORY.md/stage1
    --phase1-only     Drain queue and train graph only
    --phase2-only     Consume existing stage1 rows only
  setup-schedule      Install/update the OS user scheduler
    --hour            Local hour (default from memory.json consolidation.schedule.hour)
    --minute          Local minute (default from memory.json consolidation.schedule.minute)
    --dry-run         Print files that would be written
    --remove          Remove scheduler files
    --status          Report scheduler file existence
  query               POST /query with JSON QueryIntent
  install-bundle      Copy a local bundle dir into ~/.pi/memory/current
  train               Build a bundle from session history (delta merge by default)
    --sessions-dir    Override sessions directory (default from config)
    --full            Ignore marker, rebuild from all sessions
    --dry-run         Show extraction stats without writing bundle
    --no-merge        Skip delta merge, full rebuild (ignore existing bundle)
    --extractor       Extractor type: "regex" (default) or "llm"
    --model           LLM model for --extractor llm (default: deepseek/deepseek-v4-flash)
    --watch           Run once then schedule periodic re-training
  index               Rebuild SQLite FTS5 session search index
    --sessions-dir    Override sessions directory (default from config)

Environment:
  Place bundle at ~/.pi/memory/current/ (symlink to bundles/<ts>/)
  Session fallback searches ~/.pi/sessions/*.json
  Install tlm on PATH or set memory.tlmPath in Pi extension config
  LLM extractor uses provider env vars (e.g. DEEPSEEK_API_KEY for deepseek/deepseek-v4-flash)

Example:
  pi-memory query '{"mode":"direct_relation","anchor_mentions":["Alice"]}'
  pi-memory install-bundle ./my-bundle-2026-06-01T00-00-00Z
  pi-memory train --full
  pi-memory train --extractor llm
  pi-memory train --watch
  pi-memory index
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
