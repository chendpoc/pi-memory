import { DEFAULT_HASH_EMBED_DIM } from "../../constants/env.js";
import { readPiMemoryEnv, resolveEmbedDim } from "../../config/env.js";
import { createHashEmbedder } from "./hash.js";
import { createOllamaEmbedder } from "./ollama.js";
import { createOpenAiEmbedder } from "./openai.js";
import type { Embedder } from "./types.js";

let cachedEmbedder: Embedder | undefined;

export function createEmbedder(env = readPiMemoryEnv()): Embedder {
  switch (env.embedder) {
    case "openai": {
      if (!env.openaiApiKey) {
        throw new Error("PI_MEMORY_EMBEDDER=openai requires PI_MEMORY_OPENAI_API_KEY or OPENAI_API_KEY");
      }
      const dim = resolveEmbedDim(env.openaiEmbedModel, env.embedDimOverride);
      return createOpenAiEmbedder({
        apiKey: env.openaiApiKey,
        model: env.openaiEmbedModel,
        dim,
        timeoutMs: env.httpTimeoutMs,
      });
    }
    case "ollama": {
      const dim = resolveEmbedDim(env.ollamaEmbedModel, env.embedDimOverride);
      return createOllamaEmbedder({
        baseUrl: env.ollamaBaseUrl,
        model: env.ollamaEmbedModel,
        dim,
        timeoutMs: env.httpTimeoutMs,
      });
    }
    default: {
      const dim = env.embedDimOverride ?? DEFAULT_HASH_EMBED_DIM;
      return createHashEmbedder(dim);
    }
  }
}

export function getEmbedder(): Embedder {
  cachedEmbedder ??= createEmbedder();
  return cachedEmbedder;
}

/** @internal test hook */
export function resetEmbedderForTests(): void {
  cachedEmbedder = undefined;
}

export type { Embedder } from "./types.js";
