import { DEFAULT_PREFLIGHT_TIMEOUT_MS, PREFLIGHT_INTENT_BUDGET_MS } from "../constants/timing.js";
import type { LlmClient } from "../adapters/llm/types.js";
import { debugMemory } from "../utils/debugLog.js";
import type { MemoryStore } from "../store/memoryStore.js";
import { query } from "../sidecar/client.js";
import {
  buildRetrievalQuery,
  extractQueryIntent,
  shouldRunEpisodicPreflight,
} from "./queryIntent.js";
import { sidecarQueryCache } from "./queryCache.js";
import {
  renderFallbackPrivateMemory,
  renderSidecarPrivateMemory,
} from "./render.js";

export type EpisodicPreflightOptions = {
  socketPath: string;
  agentDir: string;
  store: MemoryStore;
  llm?: LlmClient | null;
  force?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

export type EpisodicPreflightResult = {
  privateContext: string;
};

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw new Error("aborted");
  }
  if (timeoutMs <= 0) {
    throw new Error("preflight timeout");
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("preflight timeout")), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Fail-silent episodic preflight: QueryIntent (Zod) → buildRetrievalQuery → sidecar.query → fallback.
 */
export async function runEpisodicPreflight(
  userInput: string,
  options: EpisodicPreflightOptions,
): Promise<EpisodicPreflightResult | null> {
  const startedAt = Date.now();

  try {
    if (!shouldRunEpisodicPreflight(userInput, options.force)) {
      debugMemory("preflight", "skipped", { reason: "gate" });
      return null;
    }

    options.onProgress?.("Searching memory...");
    const totalBudget = options.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS;
    const deadline = Date.now() + totalBudget;

    const intentStartedAt = Date.now();
    const intentBudget = Math.min(PREFLIGHT_INTENT_BUDGET_MS, remainingMs(deadline));
    let intent;
    try {
      intent = await withTimeout(
        extractQueryIntent(userInput, options.llm ?? null, {
          force: options.force,
          signal: options.signal,
        }),
        intentBudget,
        options.signal,
      );
    } catch {
      intent = { raw_query: userInput.trim() };
    }
    const intentMs = Date.now() - intentStartedAt;

    const retrievalQuery = buildRetrievalQuery(intent, userInput);
    const cached = sidecarQueryCache.get(options.agentDir, retrievalQuery);

    let privateContext = "";
    let cacheHit = false;
    let sidecarMs = 0;
    let resultCount = 0;
    let usedFallback = false;

    if (cached) {
      cacheHit = true;
      resultCount = cached.length;
      privateContext = renderSidecarPrivateMemory(retrievalQuery, cached);
    } else {
      const sidecarStartedAt = Date.now();
      const queryBudget = remainingMs(deadline);
      try {
        const result = await withTimeout(
          query(options.socketPath, retrievalQuery, queryBudget),
          queryBudget,
          options.signal,
        );
        sidecarMs = Date.now() - sidecarStartedAt;
        resultCount = result.results.length;
        sidecarQueryCache.set(options.agentDir, retrievalQuery, result.results);
        privateContext = renderSidecarPrivateMemory(retrievalQuery, result.results);
      } catch {
        sidecarMs = Date.now() - sidecarStartedAt;
        // sidecar unavailable or timed out → fallback
      }
    }

    if (!privateContext.trim()) {
      usedFallback = true;
      const fallback = await options.store.readForFallback();
      privateContext = renderFallbackPrivateMemory(fallback);
      resultCount = fallback.trim() ? 1 : 0;
    }

    debugMemory("preflight", "recall", {
      intent_ms: intentMs,
      sidecar_ms: sidecarMs,
      total_ms: Date.now() - startedAt,
      cache_hit: cacheHit,
      fallback: usedFallback,
      results: resultCount,
    });

    if (!privateContext.trim()) return null;
    return { privateContext };
  } catch {
    debugMemory("preflight", "failed", { total_ms: Date.now() - startedAt });
    return null;
  }
}
