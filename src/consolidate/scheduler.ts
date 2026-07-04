import debounce from "lodash/debounce.js";

import { DEFAULT_CONSOLIDATE_CHECK_INTERVAL_MS, DEFAULT_CONSOLIDATE_DEBOUNCE_MS } from "../constants/timing.js";

import type { LlmClient } from "../adapters/llm/types.js";
import type { MemoryStore } from "../store/memoryStore.js";
import { runConsolidateJob } from "./runJob.js";

export type ConsolidateScheduler = {
  schedule(): void;
  runNow(opts?: { cronFired?: boolean }): Promise<void>;
};

export function createConsolidateScheduler(opts: {
  getStore(): MemoryStore | null;
  getAgentDir(): string | null;
  getLlm(): LlmClient | null;
  debounceMs?: number;
  onComplete?(): void | Promise<void>;
}): ConsolidateScheduler {
  const runNow = async (runOpts: { cronFired?: boolean } = {}): Promise<void> => {
    const store = opts.getStore();
    const agentDir = opts.getAgentDir();
    if (!store || !agentDir) return;

    const result = await runConsolidateJob({
      store,
      agentDir,
      llm: opts.getLlm(),
      cronFired: runOpts.cronFired ?? false,
      reindex: true,
    });

    if (result.status === "consolidated") {
      await opts.onComplete?.();
    }
  };

  const schedule = debounce(() => {
    void runNow();
  }, opts.debounceMs ?? DEFAULT_CONSOLIDATE_DEBOUNCE_MS);

  return { schedule, runNow };
}

/** Periodic check for the 7-day (and other time-based) consolidate conditions. */
export function startConsolidateInterval(
  tick: () => void,
  intervalMs = DEFAULT_CONSOLIDATE_CHECK_INTERVAL_MS,
): () => void {
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
