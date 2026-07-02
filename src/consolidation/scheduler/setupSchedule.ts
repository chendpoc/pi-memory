import fs from "node:fs/promises";
import path from "node:path";

import { buildLaunchdPlist, launchdPlistPath } from "./launchd.js";
import {
  buildSystemdService,
  buildSystemdTimer,
  systemdServicePath,
  systemdTimerPath,
} from "./systemd.js";
import {
  type SetupScheduleResult,
  type ScheduledFile,
  type ScheduleAction,
  type ScheduleOptions,
  type SchedulePlatform,
} from "./types.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeIfNeeded(
  filePath: string,
  content: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await ensureDir(filePath);
  await fs.writeFile(filePath, content, "utf8");
}

async function removeFileIfExists(filePath: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // Ignore cleanup failures for idempotency.
  }
}

function setupPlan(
  platform: SchedulePlatform,
  opts: ScheduleOptions,
): Array<{ path: string; content: string }> {
  if (platform === "darwin") {
    return [{ path: launchdPlistPath(), content: buildLaunchdPlist(opts) }];
  }
  return [
    { path: systemdServicePath(), content: buildSystemdService(opts) },
    { path: systemdTimerPath(), content: buildSystemdTimer(opts) },
  ];
}

function resolveAction(opts: ScheduleOptions): ScheduleAction {
  if (opts.status) return "status";
  if (opts.remove) return "remove";
  return "write";
}

export async function setupSchedule(
  opts: ScheduleOptions,
  platform: SchedulePlatform,
): Promise<SetupScheduleResult> {
  const dryRun = Boolean(opts.dryRun);
  const action = resolveAction(opts);
  const filesToProcess = setupPlan(platform, opts);

  const files: ScheduledFile[] = [];

  if (action === "status") {
    for (const file of filesToProcess) {
      files.push({ path: file.path, exists: await exists(file.path) });
    }
    return { platform, action, files, dryRun };
  }

  if (action === "remove") {
    for (const file of filesToProcess) {
      await removeFileIfExists(file.path, dryRun);
    }
    for (const file of filesToProcess) {
      files.push({ path: file.path, exists: await exists(file.path) });
    }
    return { platform, action, files, dryRun };
  }

  for (const file of filesToProcess) {
    await writeIfNeeded(file.path, file.content, dryRun);
    files.push({
      path: file.path,
      exists: await exists(file.path),
      content: file.content,
    });
  }
  return { platform, action, files, dryRun };
}
