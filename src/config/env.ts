import type { EmbedderProvider } from "../constants/env.js";
import {
  DEFAULT_EMBEDDER,
  DEFAULT_EMBED_DIM_FALLBACK,
  DEFAULT_HASH_EMBED_DIM,
  DEFAULT_HELPER_MODEL_SPEC,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_EMBED_MODEL,
  DEFAULT_OPENAI_EMBED_MODEL,
  ENV_KEYS,
  FALLBACK_OPENAI_API_KEY_ENV,
  KNOWN_EMBED_DIMS,
} from "../constants/env.js";
import {
  DEFAULT_CONSOLIDATE_DEBOUNCE_MS,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_PREFLIGHT_TIMEOUT_MS,
  DEFAULT_REINDEX_DEBOUNCE_MS,
} from "../constants/timing.js";

export type PiMemoryEnv = {
  embedder: EmbedderProvider;
  openaiApiKey?: string;
  openaiEmbedModel: string;
  ollamaBaseUrl: string;
  ollamaEmbedModel: string;
  ollamaLlmBaseUrl: string;
  ollamaLlmModel?: string;
  helperModel: string;
  helperApiKey?: string;
  openaiCompatBaseUrl?: string;
  openaiCompatModel?: string;
  openaiCompatApiKey?: string;
  embedDimOverride?: number;
  httpTimeoutMs: number;
  preflightTimeoutMs: number;
  reindexDebounceMs: number;
  consolidateDebounceMs: number;
  agentDir?: string;
  envFile?: string;
};

function parseEmbedder(value: string | undefined): EmbedderProvider {
  if (value === "openai" || value === "ollama" || value === "hash") return value;
  return DEFAULT_EMBEDDER;
}

/** Read pi-memory env from process.env (after optional loadEnv). */
export function readPiMemoryEnv(env: NodeJS.ProcessEnv = process.env): PiMemoryEnv {
  const embedDimRaw = env[ENV_KEYS.EMBED_DIM]?.trim();
  const embedDimOverride = embedDimRaw ? Number.parseInt(embedDimRaw, 10) : undefined;

  return {
    embedder: parseEmbedder(env[ENV_KEYS.EMBEDDER]),
    openaiApiKey: env[ENV_KEYS.OPENAI_API_KEY] ?? env[FALLBACK_OPENAI_API_KEY_ENV],
    openaiEmbedModel: env[ENV_KEYS.OPENAI_EMBED_MODEL] ?? DEFAULT_OPENAI_EMBED_MODEL,
    ollamaBaseUrl: env[ENV_KEYS.OLLAMA_BASE_URL] ?? DEFAULT_OLLAMA_BASE_URL,
    ollamaEmbedModel: env[ENV_KEYS.OLLAMA_EMBED_MODEL] ?? DEFAULT_OLLAMA_EMBED_MODEL,
    ollamaLlmBaseUrl:
      env[ENV_KEYS.OLLAMA_LLM_BASE_URL] ?? env[ENV_KEYS.OLLAMA_BASE_URL] ?? DEFAULT_OLLAMA_BASE_URL,
    ollamaLlmModel: env[ENV_KEYS.OLLAMA_LLM_MODEL]?.trim() || undefined,
    helperModel: env[ENV_KEYS.HELPER_MODEL] ?? DEFAULT_HELPER_MODEL_SPEC,
    helperApiKey: env[ENV_KEYS.HELPER_API_KEY]?.trim() || undefined,
    openaiCompatBaseUrl: env[ENV_KEYS.OPENAI_COMPAT_BASE_URL]?.trim() || undefined,
    openaiCompatModel: env[ENV_KEYS.OPENAI_COMPAT_MODEL]?.trim() || undefined,
    openaiCompatApiKey: env[ENV_KEYS.OPENAI_COMPAT_API_KEY]?.trim() || undefined,
    embedDimOverride: Number.isFinite(embedDimOverride) ? embedDimOverride : undefined,
    httpTimeoutMs: Number.parseInt(env[ENV_KEYS.HTTP_TIMEOUT_MS] ?? String(DEFAULT_HTTP_TIMEOUT_MS), 10),
    preflightTimeoutMs: Number.parseInt(
      env[ENV_KEYS.PREFLIGHT_TIMEOUT_MS] ?? String(DEFAULT_PREFLIGHT_TIMEOUT_MS),
      10,
    ),
    reindexDebounceMs: Number.parseInt(
      env[ENV_KEYS.REINDEX_DEBOUNCE_MS] ?? String(DEFAULT_REINDEX_DEBOUNCE_MS),
      10,
    ),
    consolidateDebounceMs: Number.parseInt(
      env[ENV_KEYS.CONSOLIDATE_DEBOUNCE_MS] ?? String(DEFAULT_CONSOLIDATE_DEBOUNCE_MS),
      10,
    ),
    agentDir: env[ENV_KEYS.AGENT_DIR]?.trim() || undefined,
    envFile: env[ENV_KEYS.ENV_FILE],
  };
}

export function resolveEmbedDim(model: string, override?: number): number {
  if (override !== undefined) return override;
  return KNOWN_EMBED_DIMS[model] ?? DEFAULT_EMBED_DIM_FALLBACK;
}

export type { EmbedderProvider } from "../constants/env.js";
export { KNOWN_EMBED_DIMS, DEFAULT_HASH_EMBED_DIM } from "../constants/env.js";
