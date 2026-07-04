import {
  CANDIDATE_POOL_MULTIPLIER,
  DEFAULT_MIN_RELEVANCE,
  DEFAULT_TOP_K,
  MAX_MMR_LAMBDA,
  MAX_TOP_K,
  MIN_MMR_LAMBDA,
  MIN_TOP_K,
  MMR_LAMBDA,
} from "../constants/retrieval.js";
import { ENV_KEYS } from "../constants/env.js";

export type RetrievalConfig = {
  topK: number;
  mmrLambda: number;
  minRelevance: number;
  candidatePoolMultiplier: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseOptionalFloat(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

/** Vector retrieval tuning (sidecar query path). */
export function readRetrievalConfig(env: NodeJS.ProcessEnv = process.env): RetrievalConfig {
  const topKRaw = parseOptionalInt(env[ENV_KEYS.TOP_K]);
  const mmrRaw = parseOptionalFloat(env[ENV_KEYS.MMR_LAMBDA]);
  const minRelRaw = parseOptionalFloat(env[ENV_KEYS.MIN_RELEVANCE]);

  return {
    topK: clamp(topKRaw ?? DEFAULT_TOP_K, MIN_TOP_K, MAX_TOP_K),
    mmrLambda: clamp(mmrRaw ?? MMR_LAMBDA, MIN_MMR_LAMBDA, MAX_MMR_LAMBDA),
    minRelevance: clamp(minRelRaw ?? DEFAULT_MIN_RELEVANCE, 0, 1),
    candidatePoolMultiplier: CANDIDATE_POOL_MULTIPLIER,
  };
}

export { DEFAULT_MIN_RELEVANCE, DEFAULT_TOP_K, MMR_LAMBDA } from "../constants/retrieval.js";
