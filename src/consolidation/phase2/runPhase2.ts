import fs from "node:fs/promises";
import path from "node:path";

import type { ConsolidationStore } from "../stage1/store.js";
import type { Stage1Output } from "../types.js";

export interface Phase2Options {
  memoryMdPath: string;
  bundleRoot: string;
  topN: number;
  dryRun?: boolean;
  maxLines?: number;
  maxBytes?: number;
  maxUnusedDays?: number;
}

export interface Phase2Report {
  stage1Selected: number;
  appended: number;
  skippedDedup: number;
  backupsCreated: number;
  topicsUpdated: number;
  migratedProjectLines: number;
  prunedLines: number;
  dryRun: boolean;
  targets: string[];
}

async function readFileOptional(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function stripScopeComment(line: string): string {
  return line.replace(/<!--\s*scope:[^>]+-->/g, "").trim();
}

function normalizedLine(line: string): string {
  return stripScopeComment(line).replace(/\s+/g, " ").toLowerCase();
}

function targetForRow(row: Stage1Output, opts: Phase2Options): string {
  if (row.scope.startsWith("project:")) {
    const hash = row.scope.slice("project:".length);
    return path.join(opts.bundleRoot, "projects", hash, "MEMORY.md");
  }
  return opts.memoryMdPath;
}

function targetForScope(scope: string, opts: Phase2Options): string {
  if (scope.startsWith("project:")) {
    const hash = scope.slice("project:".length);
    return path.join(opts.bundleRoot, "projects", hash, "MEMORY.md");
  }
  return opts.memoryMdPath;
}

function rowsToMemoryLines(row: Stage1Output): string[] {
  const body = row.raw_memory.trim() || row.rollout_summary.trim();
  if (!body) return [];
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bullet = line.startsWith("- ") ? line : `- ${line}`;
      return `${bullet} <!-- scope:${row.scope} -->`;
    });
}

async function backupMemoryFile(filePath: string): Promise<boolean> {
  const existing = await readFileOptional(filePath);
  if (!existing) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.copyFile(filePath, `${filePath}.${stamp}.bak`);
  return true;
}

async function appendDedup(
  filePath: string,
  lines: string[],
  dryRun: boolean,
): Promise<{ appended: number; skipped: number; backup: boolean }> {
  if (lines.length === 0) return { appended: 0, skipped: 0, backup: false };
  const existing = await readFileOptional(filePath);
  const seen = new Set(
    existing
      .split("\n")
      .map(normalizedLine)
      .filter(Boolean),
  );
  const nextLines: string[] = [];
  let skipped = 0;
  for (const line of lines) {
    const key = normalizedLine(line);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    nextLines.push(line);
  }
  if (dryRun || nextLines.length === 0) {
    return { appended: nextLines.length, skipped, backup: false };
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const backup = await backupMemoryFile(filePath);
  const prefix = existing.trim() ? "\n" : "# Memory\n\n";
  await fs.appendFile(filePath, `${prefix}${nextLines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { appended: nextLines.length, skipped, backup };
}

async function migrateProjectScopedLines(
  opts: Phase2Options,
): Promise<{ migrated: number; targets: string[] }> {
  const globalText = await readFileOptional(opts.memoryMdPath);
  if (!globalText.trim()) return { migrated: 0, targets: [] };

  const keep: string[] = [];
  const byTarget = new Map<string, string[]>();
  for (const line of globalText.split("\n")) {
    const scope = line.match(/<!--\s*scope:(project:[a-f0-9]{12})\s*-->/i)?.[1];
    if (!scope) {
      keep.push(line);
      continue;
    }
    const target = targetForScope(scope, opts);
    byTarget.set(target, [...(byTarget.get(target) ?? []), line]);
  }
  const migrated = Array.from(byTarget.values()).reduce((sum, lines) => sum + lines.length, 0);
  if (opts.dryRun || migrated === 0) {
    return { migrated, targets: Array.from(byTarget.keys()) };
  }

  await backupMemoryFile(opts.memoryMdPath);
  await fs.writeFile(opts.memoryMdPath, `${keep.join("\n").trim()}\n`, "utf8");
  for (const [target, lines] of byTarget) {
    await appendDedup(target, lines, false);
  }
  return { migrated, targets: Array.from(byTarget.keys()) };
}

async function pruneLinesFromTargets(
  rows: Stage1Output[],
  opts: Phase2Options,
): Promise<number> {
  if (rows.length === 0) return 0;
  const staleKeys = new Set<string>();
  for (const row of rows) {
    for (const line of rowsToMemoryLines(row)) staleKeys.add(normalizedLine(line));
  }
  if (staleKeys.size === 0) return 0;

  const targets = new Set<string>([
    opts.memoryMdPath,
    ...rows.map((row) => targetForRow(row, opts)),
  ]);
  let pruned = 0;
  for (const target of targets) {
    const existing = await readFileOptional(target);
    if (!existing.trim()) continue;
    const kept: string[] = [];
    let targetPruned = 0;
    for (const line of existing.split("\n")) {
      if (staleKeys.has(normalizedLine(line))) {
        pruned++;
        targetPruned++;
        continue;
      }
      kept.push(line);
    }
    if (!opts.dryRun && targetPruned > 0) {
      await backupMemoryFile(target);
      await fs.writeFile(target, `${kept.join("\n").trim()}\n`, "utf8");
    }
  }
  return pruned;
}

async function syncWorkspace(
  rows: Stage1Output[],
  bundleRoot: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  const workspace = path.join(bundleRoot, "workspace");
  const summaries = path.join(workspace, "rollout_summaries");
  await fs.mkdir(summaries, { recursive: true, mode: 0o700 });
  const raw = rows
    .map((row) => `## ${row.session_id}\n\n${row.raw_memory || row.rollout_summary}`)
    .join("\n\n");
  await fs.writeFile(path.join(workspace, "raw_memories.md"), `${raw}\n`, "utf8");
  for (const row of rows) {
    await fs.writeFile(
      path.join(summaries, `${row.session_id}.md`),
      `${row.rollout_summary || row.raw_memory}\n`,
      "utf8",
    );
  }
}

export async function runPhase2(
  store: ConsolidationStore,
  opts: Phase2Options,
): Promise<Phase2Report> {
  const dryRun = opts.dryRun ?? false;
  const rows = store.listUnselectedStage1(opts.topN);
  const migration = await migrateProjectScopedLines(opts);
  const grouped = new Map<string, string[]>();

  for (const row of rows) {
    const target = targetForRow(row, opts);
    const lines = rowsToMemoryLines(row);
    grouped.set(target, [...(grouped.get(target) ?? []), ...lines]);
  }

  const report: Phase2Report = {
    stage1Selected: rows.length,
    appended: 0,
    skippedDedup: 0,
    backupsCreated: 0,
    topicsUpdated: 0,
    migratedProjectLines: migration.migrated,
    prunedLines: 0,
    dryRun,
    targets: Array.from(new Set([...grouped.keys(), ...migration.targets])),
  };

  for (const [target, lines] of grouped) {
    const result = await appendDedup(target, lines, dryRun);
    report.appended += result.appended;
    report.skippedDedup += result.skipped;
    if (result.backup) report.backupsCreated++;
  }

  await syncWorkspace(rows, opts.bundleRoot, dryRun);
  if (opts.maxUnusedDays && opts.maxUnusedDays > 0) {
    const cutoff = new Date(
      Date.now() - opts.maxUnusedDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    report.prunedLines = await pruneLinesFromTargets(
      store.listStage1OlderThan(cutoff),
      opts,
    );
  }
  if (!dryRun) store.markStage1Selected(rows.map((row) => row.session_id));

  return report;
}
