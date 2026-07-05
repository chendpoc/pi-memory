import type { LlmClient } from "../adapters/llm/types.js";
import { syncSidecarIndex } from "../sidecar/syncIndex.js";
import type { ConsolidateStoreAccess } from "../store/consolidatePort.js";
import { mergeMemoryEntries } from "./mergeMemoryEntries.js";

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
  store: ConsolidateStoreAccess;
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

  if (opts.store.isConsolidating()) {
    return { status: "skipped", reason: "already_consolidating" };
  }

  if (!opts.force && !(await opts.store.shouldConsolidate(undefined, opts.cronFired))) {
    return { status: "skipped", reason: "conditions_not_met" };
  }

  const before = await opts.store.getStats();

  try {
    await mergeMemoryEntries(opts.store, llm);

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
