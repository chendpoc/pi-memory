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
  | { status: "consolidated" }
  | { status: "failed"; error: Error };

export async function runConsolidateJob(
  opts: RunConsolidateJobOptions,
): Promise<RunConsolidateJobResult> {
  const llm = opts.llm ?? NOOP_LLM;

  if (!opts.force && !(await opts.store.shouldConsolidate(new Date(), opts.cronFired ?? false))) {
    return { status: "skipped", reason: "conditions_not_met" };
  }

  try {
    await opts.store.consolidate(llm);

    if (opts.reindex !== false) {
      await syncSidecarIndex(opts.agentDir, opts.store);
    }

    return { status: "consolidated" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function syncSidecarIndex(agentDir: string, store: MemoryStore): Promise<void> {
  const sidecar = resolveSidecarPaths(agentDir);
  await ensureSidecarRunning(sidecar);
  const result = await reindex(sidecar.socketPath, await store.exportForIndex());
  sidecarQueryCache.onReindexComplete(agentDir, result.index_generation);
}
