import { readPiMemoryEnv } from "../config/index.js";
import { readPreflightRuntimeConfig } from "../config/preflight.js";
import {
  createConsolidateScheduler,
  startConsolidateInterval,
  type ConsolidateScheduler,
} from "../consolidate/scheduler.js";
import type { LlmClient } from "../adapters/llm/types.js";
import { mergePrivateMemoryBlocks, renderMemoryCapPrivateMemory } from "../preflight/render.js";
import { createReindexScheduler, type ReindexScheduler } from "../sidecar/reindexBridge.js";
import type { SidecarPaths } from "../sidecar/paths.js";
import { ensureSidecarRunning } from "../sidecar/sidecarManager.js";
import { warmSidecar } from "../sidecar/warmup.js";
import type { MemoryStore } from "../store/memoryStore.js";

export type SidecarBootstrapResult = {
  reindexScheduler: ReindexScheduler;
  unsubSyncToSidecar: () => void;
};

export async function bootstrapSidecar(opts: {
  store: MemoryStore;
  sidecarPaths: SidecarPaths;
  reindexScheduler: ReindexScheduler | null;
}): Promise<SidecarBootstrapResult> {
  await ensureSidecarRunning({
    socketPath: opts.sidecarPaths.socketPath,
    dbPath: opts.sidecarPaths.dbPath,
  });

  if (readPreflightRuntimeConfig().warmSidecar) {
    try {
      await warmSidecar(opts.sidecarPaths.socketPath);
    } catch {
      // warm is best-effort
    }
  }

  const reindexScheduler =
    opts.reindexScheduler ??
    createReindexScheduler({
      sidecar: opts.sidecarPaths,
      agentDir: opts.store.agentDir,
      getDocuments: () => opts.store.exportForIndex(),
      debounceMs: readPiMemoryEnv().reindexDebounceMs,
    });

  const unsubSyncToSidecar = opts.store.onSyncToSidecar(() => reindexScheduler.schedule());
  await reindexScheduler.runNow();

  return { reindexScheduler, unsubSyncToSidecar };
}

export type ConsolidateBootstrapResult = {
  consolidateScheduler: ConsolidateScheduler;
  stopConsolidateInterval: () => void;
  unsubConsolidateCheck: () => void;
};

export function bootstrapConsolidate(opts: {
  store: MemoryStore;
  getLlm: () => LlmClient | null;
  onComplete: () => Promise<void>;
  stopExistingInterval: (() => void) | null;
}): ConsolidateBootstrapResult {
  const consolidateScheduler = createConsolidateScheduler({
    getStore: () => opts.store,
    getAgentDir: () => opts.store.agentDir,
    getLlm: opts.getLlm,
    debounceMs: readPiMemoryEnv().consolidateDebounceMs,
    onComplete: opts.onComplete,
  });

  const unsubConsolidateCheck = opts.store.onConsolidateCheck(() => consolidateScheduler.schedule());

  opts.stopExistingInterval?.();
  const stopConsolidateInterval = startConsolidateInterval(() => {
    void consolidateScheduler.runNow();
  });

  void consolidateScheduler.runNow();

  return { consolidateScheduler, stopConsolidateInterval, unsubConsolidateCheck };
}

export async function loadSessionMemoryCap(store: MemoryStore): Promise<string | null> {
  const fallback = await store.readForFallback();
  return renderMemoryCapPrivateMemory(fallback) || null;
}

export { mergePrivateMemoryBlocks };
