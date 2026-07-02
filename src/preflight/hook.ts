import type { RerankOptions } from "../fallback/llmRerank.js";
import type { MemoryConfig } from "../config.js";
import type { FallbackQuery } from "../types.js";
import type { MemoryService } from "../service.js";
import type { QueryIntent } from "../types.js";
import {
  detectMemoryIntents,
  type DetectIntentsOptions,
  type MemoryHelperLLM,
} from "./detectIntents.js";
import { renderFallbackPrivateMemory, renderPrivateMemoryContext, type PreflightQueryResult } from "./render.js";
import { injectPrivateMemoryContext } from "./strip.js";
import {
  deleteNegativeCache,
  isNegativeCached,
  setNegativeCache,
} from "../cache/memoryCaches.js";

export type { MemoryHelperLLM };

export const MEMORY_PREFLIGHT_QUERY_TIMEOUT_MS = 2_000;

export interface MemoryPreflightOptions extends DetectIntentsOptions {
  helper?: MemoryHelperLLM | null;
  /** When true, run helper even if lexical gate would skip. */
  forceHelper?: boolean;
  /** Fallback query for degraded path when sidecar is not ready. */
  fallback?: FallbackQuery | null;
  /** LLM rerank options for fallback search results. */
  rerankOpts?: RerankOptions | null;
  /**
   * Optional progress callback emitted at key stages (intent detection,
   * graph query, FTS search, rerank). Wire to ctx.ui.setWorkingMessage for
   * visible feedback during slow sidecar queries.
   */
  onProgress?: (message: string) => void;
  /**
   * When the graph is ready but returns no usable results, cascade to a
   * semantic fallback: broader FTS recall + single LLM rerank.
   * Requires both `fallback` and `rerankOpts` to be set.
   * Defaults to true — set to false to disable the cascade.
   */
  semanticFallback?: boolean;
}

export interface MemoryPreflightResult {
  /** Full injected user text (scaffold + private memory + payload), or undefined. */
  injectedText?: string;
  /** Raw <private_memory> block when context was returned. */
  privateContext?: string;
}

export interface BeforeTurnInput {
  /** Scaffolded user message text sent to the model (may include date/CWD scaffolding). */
  scaffoldedText: string;
  /** Raw user payload without scaffolding — used for intent detection. */
  userPayload: string;
  /** First message in conversation — enables forceHelper gate. */
  isFirstTurn?: boolean;
  /** Set when preflight injected context (not for persistence). */
  privateContext?: string;
  signal?: AbortSignal;
}

export type BeforeTurnHook = (input: BeforeTurnInput) => Promise<BeforeTurnInput>;

/**
 * Fail-silent implicit episodic preflight: detect intents → batch query → inject
 * <private_memory> into the in-flight user message. Never throws.
 */
export async function runMemoryPreflight(
  query: string,
  service: MemoryService,
  options: MemoryPreflightOptions = {},
): Promise<MemoryPreflightResult | null> {
  if (isNegativeCached(query)) return null;

  try {
    if (service.status() !== "ready") {
      if (!options.fallback) {
        setNegativeCache(query);
        return null;
      }
      options.onProgress?.("Searching session history…");
      const privateContext = await renderFallbackPrivateMemory(query, options.fallback, {
        rerankOpts: options.rerankOpts,
        onProgress: options.onProgress,
      });
      if (!privateContext.trim()) {
        setNegativeCache(query);
        return null;
      }
      deleteNegativeCache(query);
      return { privateContext };
    }

    options.onProgress?.("Detecting memory intents…");
    const intents = await detectMemoryIntents(query, options.helper ?? null, {
      forceHelper: options.forceHelper,
      signal: options.signal,
    });
    if (intents.length === 0) {
      setNegativeCache(query);
      return null;
    }

    if (service.getStatus().mode === "sidecar") {
      options.onProgress?.("Querying memory graph…");
    }

    const timeout = AbortSignal.timeout(MEMORY_PREFLIGHT_QUERY_TIMEOUT_MS);
    const combined = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    const results = await service.queryBatch(intents, combined);
    if (timeout.aborted) {
      setNegativeCache(query);
      return null;
    }

    const renderInput: PreflightQueryResult[] = results.map((r) => ({
      envelope: r.envelope,
      ok: r.errorClass === "ok" && r.envelope != null && !r.envelope.error,
    }));

    const privateContext = renderPrivateMemoryContext(intents, renderInput);
    if (!privateContext.trim()) {
      // Graph was ready but returned no usable results.
      // Cascade to semantic fallback (broader FTS + single LLM rerank) when
      // both a fallback store and a rerank client are available.
      if (
        options.semanticFallback !== false &&
        options.fallback &&
        options.rerankOpts
      ) {
        options.onProgress?.("Searching session history…");
        const semanticCtx = await renderFallbackPrivateMemory(query, options.fallback, {
          rerankOpts: options.rerankOpts,
          onProgress: options.onProgress,
        });
        if (semanticCtx.trim()) {
          deleteNegativeCache(query);
          return { privateContext: semanticCtx };
        }
      }
      setNegativeCache(query);
      return null;
    }

    deleteNegativeCache(query);
    return { privateContext };
  } catch {
    setNegativeCache(query);
    return null;
  }
}

/**
 * Pi beforeTurn hook factory — wire into pi-coding-agent turn lifecycle.
 *
 * ```ts
 * const hook = createBeforeTurnHook(service, config, { helper: mySmallModel });
 * api.onBeforeTurn?.(hook);
 * ```
 *
 * On persist/summary, call `stripPrivateMemory` on user message text so recalled
 * facts are not written to session history.
 */
export function createBeforeTurnHook(
  service: MemoryService,
  config: MemoryConfig,
  options: { helper?: MemoryHelperLLM | null; fallback?: FallbackQuery | null } = {},
): BeforeTurnHook {
  const fallback = options.fallback ?? null;
  return async (input: BeforeTurnInput): Promise<BeforeTurnInput> => {
    const preflight = await runMemoryPreflight(input.userPayload, service, {
      helper: options.helper ?? null,
      forceHelper: input.isFirstTurn ?? false,
      signal: input.signal,
      fallback,
    });
    if (!preflight?.privateContext) return input;

    const injectedText = injectPrivateMemoryContext(
      input.scaffoldedText,
      input.userPayload,
      preflight.privateContext,
    );
    return {
      ...input,
      scaffoldedText: injectedText,
      privateContext: preflight.privateContext,
    };
  };
}

/** @internal exported for tests */
export type { QueryIntent };
