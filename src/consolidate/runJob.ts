import type { LlmClient } from "../adapters/llm/types.js";
import { sidecarQueryCache } from "../preflight/queryCache.js";
import { ensureSidecarRunning } from "../sidecar/sidecarManager.js";
import { reindex } from "../sidecar/client.js";
import { resolveSidecarPaths } from "../sidecar/paths.js";
import type { MemoryStore } from "../store/memoryStore.js";

const NOOP_LLM: LlmClient = {
  async complete() {
    throw new Error("LLM unavailable");
  },
};

export type ConsolidateJobStats = {
  entriesBefore: number;
  entriesAfter: number;
  overflowBefore: number;
  overflowAfter: number;
  indexGeneration?: number;
};

export type RunConsolidateJobOptions = {
  store: MemoryStore;
  agentDir: string;
  llm?: LlmClient | null;
  cronFired?: boolean;
  force?: boolean;
  reindex?: boolean;
};

export type RunConsolidateJobResult =
  | { status: "skipped"; reason: "conditions_not_met" | "already_consolidating" }
  | { status: "consolidated"; stats: ConsolidateJobStats }
  | { status: "failed"; error: Error };

export async function runConsolidateJob(
  opts: RunConsolidateJobOptions,
): Promise<RunConsolidateJobResult> {
  const llm = opts.llm ?? NOOP_LLM;

  if (!opts.force && !(await opts.store.shouldConsolidate(new Date(), opts.cronFired ?? false))) {
    return { status: "skipped", reason: "conditions_not_met" };
  }

  const before = await opts.store.getStats();

  try {
    await opts.store.consolidate(llm);

    let indexGeneration: number | undefined;
    if (opts.reindex !== false) {
      indexGeneration = await syncSidecarIndex(opts.agentDir, opts.store);
    }

    const after = await opts.store.getStats();

    return {
      status: "consolidated",
      stats: {
        entriesBefore: before.entryCount,
        entriesAfter: after.entryCount,
        overflowBefore: before.overflowFileCount,
        overflowAfter: after.overflowFileCount,
        indexGeneration,
      },
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function syncSidecarIndex(agentDir: string, store: MemoryStore): Promise<number> {
  const sidecar = resolveSidecarPaths(agentDir);
  await ensureSidecarRunning(sidecar);
  const result = await reindex(sidecar.socketPath, await store.exportForIndex());
  sidecarQueryCache.onReindexComplete(agentDir, result.index_generation);
  return result.index_generation;
}
