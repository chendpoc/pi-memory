// Agent 侧：connect-or-create、execa 生命周期
import { execa } from "execa";

import { SIDECAR_FORCE_KILL_DELAY_MS, SIDECAR_START_TIMEOUT_MS } from "../constants/timing.js";
import { ensureDirSync, pathDirname } from "../utils/fs.js";
import { ping } from "./client.js";
import { resolveSidecarEntry } from "./paths.js";
import { acquireSpawnLock, releaseSpawnLock } from "./spawnLock.js";
import { canConnect, waitUntilReady } from "./utils.js";

export { resolveSidecarEntry } from "./paths.js";

const START_TIMEOUT_MS = SIDECAR_START_TIMEOUT_MS;

let instance: SidecarManager | undefined;

export type SidecarOpts = {
  entry?: string;
  socketPath: string;
  dbPath: string;
};

/** 上层唯一入口：确保 sidecar 在跑（attach 或 spawn） */
export async function ensureSidecarRunning(opts: SidecarOpts): Promise<void> {
  const resolved = { ...opts, entry: opts.entry ?? resolveSidecarEntry() };
  ensureDirSync(pathDirname(resolved.socketPath));

  if (await canConnect(resolved.socketPath)) return;

  if (!acquireSpawnLock(resolved.socketPath)) {
    await waitUntilReady(() => canConnect(resolved.socketPath), START_TIMEOUT_MS);
    return;
  }

  try {
    if (await canConnect(resolved.socketPath)) return;
    await getInstance().spawn(resolved);
  } finally {
    releaseSpawnLock(resolved.socketPath);
  }
}

export async function stopSidecar(): Promise<void> {
  await getInstance().stop();
}

function getInstance(): SidecarManager {
  instance ??= new SidecarManager();
  return instance;
}

class SidecarManager {
  private child?: ReturnType<typeof execa>;

  async spawn(opts: Required<SidecarOpts>): Promise<void> {
    if (await ping(opts.socketPath)) return;

    this.child = execa(
      process.execPath,
      [opts.entry, "--socket", opts.socketPath, "--db", opts.dbPath],
      {
        stdio: "ignore",
        cleanup: true,
        forceKillAfterDelay: SIDECAR_FORCE_KILL_DELAY_MS,
      },
    );

    this.child.catch(() => {});

    await waitUntilReady(() => ping(opts.socketPath), START_TIMEOUT_MS);
  }

  async stop(): Promise<void> {
    this.child?.kill("SIGTERM");
    await this.child;
    this.child = undefined;
  }
}
