import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { SIDECAR_SPAWN_LOCK_FILE } from "../constants/paths.js";
import { SIDECAR_SPAWN_LOCK_STALE_MS } from "../constants/timing.js";
import { joinPath, pathDirname, pathExists } from "../utils/fs.js";
import { nowMs } from "../utils/time.js";

function spawnLockPath(socketPath: string): string {
  return joinPath(pathDirname(socketPath), SIDECAR_SPAWN_LOCK_FILE);
}

export function acquireSpawnLock(socketPath: string): boolean {
  const lockPath = spawnLockPath(socketPath);
  for (let i = 0; i < 5; i++) {
    try {
      writeFileSync(lockPath, `${process.pid}\n${nowMs()}\n`, { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (isLockStale(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {}
        continue;
      }
      return false;
    }
  }
  return false;
}

function isLockStale(lockPath: string): boolean {
  if (!pathExists(lockPath)) return false;
  try {
    const [pidLine = "", tsLine = "0"] = readFileSync(lockPath, "utf8").trim().split("\n");
    const pid = Number.parseInt(pidLine, 10);
    const ts = Number.parseInt(tsLine, 10);
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
    }
    return !Number.isFinite(ts) || nowMs() - ts > SIDECAR_SPAWN_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

export function releaseSpawnLock(socketPath: string): void {
  try {
    unlinkSync(spawnLockPath(socketPath));
  } catch {}
}
