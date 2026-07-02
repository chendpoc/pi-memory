import type { LLMClient } from "../trainer/llmExtractor.js";
import type { SessionSearchHit } from "./sessionSearch.js";
import { cacheKeyForRerank, rerankCache } from "../cache/memoryCaches.js";

export interface RerankOptions {
  client: LLMClient;
  maxCandidates?: number;
  maxTokens?: number;
}

export interface RankedResult {
  index: number;
  score: number;
  summary: string;
}

const DEFAULT_MAX_CANDIDATES = 10;

function buildRerankPrompt(query: string, hits: SessionSearchHit[]): string {
  const numbered = hits
    .map((h, i) => `#${i}: [${h.session_title || "untitled"}] ${h.snippet}`)
    .join("\n");

  return `You are a relevance judge. Given a user query and numbered search results from past sessions, rate each result 0-10 for relevance to the query and write a one-sentence summary of the relevant content.

Query: ${query}

Results:
${numbered}

Respond with ONLY a JSON array (no markdown fences, no explanation):
[{ "index": 0, "score": 8, "summary": "..." }, ...]`;
}

interface RawRankedItem {
  index?: unknown;
  score?: unknown;
  summary?: unknown;
}

function parseRerankResponse(raw: string, hitCount: number): RankedResult[] | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const results: RankedResult[] = [];
  for (const item of parsed as RawRankedItem[]) {
    const index = typeof item.index === "number" ? item.index : -1;
    const score = typeof item.score === "number" ? item.score : 0;
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (index < 0 || index >= hitCount || !summary) continue;
    results.push({ index, score: Math.max(0, Math.min(10, score)), summary });
  }

  if (results.length === 0) return null;

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Rerank FTS5 search hits using an LLM. Returns scored + summarized results
 * sorted by relevance. On any LLM failure, returns null (caller should use
 * original hits as fallback).
 */
export async function rerankWithLLM(
  query: string,
  hits: SessionSearchHit[],
  opts: RerankOptions,
): Promise<RankedResult[] | null> {
  if (hits.length === 0) return null;

  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const truncated = hits.slice(0, maxCandidates);

  const cacheKey = cacheKeyForRerank(query, truncated);
  const cached = rerankCache.get(cacheKey);
  if (cached) return cached;

  const prompt = buildRerankPrompt(query, truncated);

  try {
    const response = await opts.client.complete(prompt);
    const results = parseRerankResponse(response, truncated.length);
    if (results) rerankCache.set(cacheKey, results);
    return results;
  } catch {
    return null;
  }
}
