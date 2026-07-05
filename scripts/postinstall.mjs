#!/usr/bin/env node
/**
 * Prefer compiled `pi-memory init` when dist exists; otherwise pre-build JS fallback.
 * Scheduler sync is best-effort: failures must not fail npm install.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(packageRoot, "dist", "cli.js");

function runBestEffort(args) {
  try {
    spawnSync(process.execPath, args, { cwd: packageRoot, stdio: "ignore" });
  } catch {
    // ignore — workspace init / launchd sync must not block install
  }
}

if (existsSync(cli)) {
  runBestEffort([cli, "init"]);
  runBestEffort([cli, "scheduler", "sync"]);
} else {
  await import("./init-memory-workspace.mjs");
}
