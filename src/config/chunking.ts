import {
  CHUNKING_DISABLED_MAX_CHARS,
  DEFAULT_CHUNK_MAX_CHARS,
  MAX_CHUNK_MAX_CHARS,
  MIN_CHUNK_MAX_CHARS,
} from "../constants/chunking.js";
import { ENV_KEYS } from "../constants/env.js";

export type ChunkingConfig = {
  /** Max chars per chunk body; <=0 keeps one chunk per entry. */
  maxChars: number;
};

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

export function readChunkingConfig(env: NodeJS.ProcessEnv = process.env): ChunkingConfig {
  const raw = parseOptionalInt(env[ENV_KEYS.CHUNK_MAX_CHARS]);
  const maxChars = raw ?? DEFAULT_CHUNK_MAX_CHARS;

  if (maxChars <= CHUNKING_DISABLED_MAX_CHARS) {
    return { maxChars: CHUNKING_DISABLED_MAX_CHARS };
  }

  return {
    maxChars: Math.min(MAX_CHUNK_MAX_CHARS, Math.max(MIN_CHUNK_MAX_CHARS, maxChars)),
  };
}

export {
  CHUNKING_DISABLED_MAX_CHARS,
  DEFAULT_CHUNK_MAX_CHARS,
} from "../constants/chunking.js";
