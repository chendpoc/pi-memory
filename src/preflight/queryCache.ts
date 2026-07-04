import { LRUCache } from "lru-cache";

import { QUERY_CACHE_MAX_ENTRIES } from "../constants/timing.js";
import type { MemoryEntry } from "../sidecar/protocol.js";

type CacheValue = {
  results: MemoryEntry[];
  indexGeneration: number;
};

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function cacheKey(agentDir: string, query: string): string {
  return `${agentDir}\0${normalizeQuery(query)}`;
}

class SidecarQueryCache {
  private readonly generationByAgent = new Map<string, number>();
  private readonly lru = new LRUCache<string, CacheValue>({ max: QUERY_CACHE_MAX_ENTRIES });

  getGeneration(agentDir: string): number {
    return this.generationByAgent.get(agentDir) ?? 0;
  }

  get(agentDir: string, query: string): MemoryEntry[] | null {
    const hit = this.lru.get(cacheKey(agentDir, query));
    if (!hit) return null;
    if (hit.indexGeneration !== this.getGeneration(agentDir)) return null;
    return hit.results;
  }

  set(agentDir: string, query: string, results: MemoryEntry[]): void {
    this.lru.set(cacheKey(agentDir, query), {
      results,
      indexGeneration: this.getGeneration(agentDir),
    });
  }

  onReindexComplete(agentDir: string, indexGeneration: number): void {
    this.generationByAgent.set(agentDir, indexGeneration);
    for (const key of this.lru.keys()) {
      if (key.startsWith(`${agentDir}\0`)) this.lru.delete(key);
    }
  }

  /** @internal test hook */
  resetForTests(): void {
    this.generationByAgent.clear();
    this.lru.clear();
  }
}

export const sidecarQueryCache = new SidecarQueryCache();

export function resetSidecarQueryCacheForTests(): void {
  sidecarQueryCache.resetForTests();
}
