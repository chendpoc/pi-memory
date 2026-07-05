import { compact } from "es-toolkit";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import { readPreflightRuntimeConfig } from "../config/preflight.js";
import {
  DEFAULT_INTENT_RETRIES,
  MEMORY_CUE_RE,
  PREFLIGHT_EXTRACT_MIN_LENGTH,
  PREFLIGHT_SKIP_MIN_LENGTH,
} from "../constants/preflight.js";
import type { LlmClient } from "../adapters/llm/types.js";
import { queryIntentCache } from "./intentCache.js";

/** Structured intent from helper LLM — simpler than crafting a search query directly. */
export const QueryIntentSchema = Type.Object(
  {
    raw_query: Type.Optional(Type.String()),
    what: Type.Optional(Type.String()),
    who: Type.Optional(Type.String()),
    where: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type QueryIntent = Static<typeof QueryIntentSchema>;

export function parseQueryIntent(value: unknown): QueryIntent {
  if (!Value.Check(QueryIntentSchema, value)) {
    throw new Error("Invalid QueryIntent");
  }
  return value;
}

const INTENT_PROMPT = `Extract a JSON object for memory retrieval from the user message.
Return ONLY valid JSON with optional keys: raw_query, what, who, where.
Use raw_query when the whole message should be searched verbatim.
User message:
`;

export function shouldRunEpisodicPreflight(query: string, forceEpisodic = false): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (forceEpisodic) return true;
  if (trimmed.startsWith("/")) return false;
  if (trimmed.length < PREFLIGHT_SKIP_MIN_LENGTH && !MEMORY_CUE_RE.test(trimmed)) return false;
  return MEMORY_CUE_RE.test(trimmed) || trimmed.length >= PREFLIGHT_EXTRACT_MIN_LENGTH;
}

export function shouldExtractIntent(query: string, forceIntent = false): boolean {
  if (forceIntent) return true;
  if (query.trim().length >= PREFLIGHT_EXTRACT_MIN_LENGTH) return true;
  return MEMORY_CUE_RE.test(query);
}

/** Pure function: concatenate intent fields into a sidecar query string. */
export function buildRetrievalQuery(intent: QueryIntent, userInput: string): string {
  if (intent.raw_query?.trim()) return intent.raw_query.trim();

  const parts = compact([intent.what, intent.who, intent.where].map((part) => part?.trim()));

  if (parts.length > 0) return parts.join(" ");
  return userInput.trim();
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("No JSON object in LLM response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

export type ExtractQueryIntentOptions = {
  forceIntent?: boolean;
  signal?: AbortSignal;
  sessionId?: string;
  intentCache?: boolean;
  intentRetries?: number;
};

export type ExtractQueryIntentResult = {
  intent: QueryIntent;
  skipped: boolean;
  cacheHit: boolean;
};

export async function extractQueryIntent(
  userInput: string,
  llm: LlmClient | null,
  options: ExtractQueryIntentOptions = {},
): Promise<ExtractQueryIntentResult> {
  const fallback: QueryIntent = { raw_query: userInput.trim() };
  const runtime = readPreflightRuntimeConfig();
  const useCache = options.intentCache ?? runtime.intentCache;

  if (useCache && options.sessionId) {
    const cached = queryIntentCache.get(options.sessionId, userInput);
    if (cached) {
      return { intent: cached, skipped: false, cacheHit: true };
    }
  }

  if (!llm || !shouldExtractIntent(userInput, options.forceIntent)) {
    return { intent: fallback, skipped: true, cacheHit: false };
  }

  const retries = options.intentRetries ?? runtime.intentRetries ?? DEFAULT_INTENT_RETRIES;
  const maxAttempts = Math.max(1, retries + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await llm.complete(`${INTENT_PROMPT}${userInput}`, options.signal);
      const intent = parseQueryIntent(extractJsonObject(raw));
      if (useCache && options.sessionId) {
        queryIntentCache.set(options.sessionId, userInput, intent);
      }
      return { intent, skipped: false, cacheHit: false };
    } catch {
      // retry or fallback
    }
  }

  return { intent: fallback, skipped: false, cacheHit: false };
}
