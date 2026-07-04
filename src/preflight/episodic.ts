import { DEFAULT_PREFLIGHT_TIMEOUT_MS } from "../constants/timing.js";
import type { LlmClient } from "../adapters/llm/types.js";
import type { MemoryStore } from "../store/memoryStore.js";
import { query } from "../sidecar/client.js";
import {
  buildRetrievalQuery,
  extractQueryIntent,
  shouldRunEpisodicPreflight,
} from "./queryIntent.js";
import {
  renderFallbackPrivateMemory,
  renderSidecarPrivateMemory,
} from "./render.js";

export type EpisodicPreflightOptions = {
  socketPath: string;
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw new Error("aborted");
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
  try {
    if (!shouldRunEpisodicPreflight(userInput, options.force)) {
      return null;
    }

    options.onProgress?.("Searching memory...");
    const timeoutMs = options.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS;
    const intent = await extractQueryIntent(userInput, options.llm ?? null, {
      force: options.force,
      signal: options.signal,
    });
    const retrievalQuery = buildRetrievalQuery(intent, userInput);

    let privateContext = "";
    try {
      const result = await withTimeout(
        query(options.socketPath, retrievalQuery),
        timeoutMs,
        options.signal,
      );
      privateContext = renderSidecarPrivateMemory(retrievalQuery, result.results);
    } catch {
      // sidecar unavailable or timed out → fallback
    }

    if (!privateContext.trim()) {
      const fallback = await options.store.readForFallback();
      privateContext = renderFallbackPrivateMemory(fallback);
    }

    if (!privateContext.trim()) return null;
    return { privateContext };
  } catch {
    return null;
  }
}
