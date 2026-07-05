import { debounce } from "es-toolkit";

import { DEFAULT_REINDEX_DEBOUNCE_MS } from "../constants/timing.js";

import { sidecarQueryCache } from "../preflight/queryCache.js";
import { ensureSidecarRunning, type SidecarOpts } from "./sidecarManager.js";
import { reindex } from "./client.js";
import type { IndexDocument } from "./protocol.js";

export type ReindexScheduler = {
  schedule(): void;
  runNow(): Promise<void>;
};

export function createReindexScheduler(opts: {
  sidecar: SidecarOpts;
  agentDir: string;
  getDocuments: () => Promise<IndexDocument[]>;
  debounceMs?: number;
}): ReindexScheduler {
  let running = false;
  let pending = false;

  const runNow = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }

    running = true;
    try {
      await ensureSidecarRunning(opts.sidecar);
      const documents = await opts.getDocuments();
      const result = await reindex(opts.sidecar.socketPath, documents);
      sidecarQueryCache.onReindexComplete(opts.agentDir, result.index_generation);
    } catch {
      // fail-silent; preflight falls back to MEMORY.md
    } finally {
      running = false;
      if (pending) {
        pending = false;
        await runNow();
      }
    }
  };

  const schedule = debounce(() => {
    void runNow();
  }, opts.debounceMs ?? DEFAULT_REINDEX_DEBOUNCE_MS);

  return { schedule, runNow };
}
