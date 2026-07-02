import { describe, it, expect, beforeEach } from "vitest";
import { rerankWithLLM, type RerankOptions } from "../src/fallback/llmRerank.js";
import type { SessionSearchHit } from "../src/fallback/sessionSearch.js";
import type { LLMClient } from "../src/trainer/llmExtractor.js";
import { rerankCache, invalidateMemoryCaches, cacheKeyForRerank } from "../src/cache/memoryCaches.js";

function makeHit(overrides: Partial<SessionSearchHit> = {}): SessionSearchHit {
  return {
    session_id: "s1",
    session_title: "Test Session",
    role: "user",
    snippet: "some content about TypeScript",
    msg_index: 0,
    created_at: "2026-01-01",
    ...overrides,
  };
}

function mockClient(response: string): LLMClient {
  return { complete: async () => response };
}

beforeEach(() => {
  invalidateMemoryCaches();
});

describe("rerankWithLLM", () => {
  it("returns null for empty hits", async () => {
    const opts: RerankOptions = { client: mockClient("[]") };
    const result = await rerankWithLLM("query", [], opts);
    expect(result).toBeNull();
  });

  it("parses valid LLM response and sorts by score descending", async () => {
    const hits = [
      makeHit({ snippet: "Alice uses TypeScript", session_title: "session A" }),
      makeHit({ snippet: "Bob prefers Python", session_title: "session B" }),
      makeHit({ snippet: "Alice deployed the app", session_title: "session C" }),
    ];

    const llmResponse = JSON.stringify([
      { index: 0, score: 7, summary: "Alice uses TypeScript for development" },
      { index: 1, score: 2, summary: "Bob uses Python instead" },
      { index: 2, score: 9, summary: "Alice deployed the application" },
    ]);

    const opts: RerankOptions = { client: mockClient(llmResponse) };
    const result = await rerankWithLLM("Alice", hits, opts);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result![0]!.index).toBe(2);
    expect(result![0]!.score).toBe(9);
    expect(result![1]!.index).toBe(0);
    expect(result![1]!.score).toBe(7);
    expect(result![2]!.index).toBe(1);
    expect(result![2]!.score).toBe(2);
  });

  it("returns null when LLM returns invalid JSON", async () => {
    const hits = [makeHit()];
    const opts: RerankOptions = { client: mockClient("not valid json") };
    const result = await rerankWithLLM("query", hits, opts);
    expect(result).toBeNull();
  });

  it("returns null when LLM returns empty array", async () => {
    const hits = [makeHit()];
    const opts: RerankOptions = { client: mockClient("[]") };
    const result = await rerankWithLLM("query", hits, opts);
    expect(result).toBeNull();
  });

  it("returns null when LLM throws", async () => {
    const hits = [makeHit()];
    const client: LLMClient = {
      complete: async () => { throw new Error("API error"); },
    };
    const result = await rerankWithLLM("query", hits, { client });
    expect(result).toBeNull();
  });

  it("filters out items with out-of-range index", async () => {
    const hits = [makeHit(), makeHit({ snippet: "second" })];
    const llmResponse = JSON.stringify([
      { index: 0, score: 5, summary: "valid" },
      { index: 99, score: 10, summary: "invalid index" },
    ]);
    const opts: RerankOptions = { client: mockClient(llmResponse) };
    const result = await rerankWithLLM("query", hits, opts);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0]!.index).toBe(0);
  });

  it("clamps scores to 0-10 range", async () => {
    const hits = [makeHit()];
    const llmResponse = JSON.stringify([
      { index: 0, score: 15, summary: "over range" },
    ]);
    const opts: RerankOptions = { client: mockClient(llmResponse) };
    const result = await rerankWithLLM("query", hits, opts);

    expect(result).not.toBeNull();
    expect(result![0]!.score).toBe(10);
  });

  it("strips markdown fences from LLM response", async () => {
    const hits = [makeHit()];
    const llmResponse = '```json\n[{ "index": 0, "score": 8, "summary": "result" }]\n```';
    const opts: RerankOptions = { client: mockClient(llmResponse) };
    const result = await rerankWithLLM("query", hits, opts);

    expect(result).not.toBeNull();
    expect(result![0]!.score).toBe(8);
  });

  it("returns cached result without calling LLM again", async () => {
    const hits = [makeHit()];
    let callCount = 0;
    const client: LLMClient = {
      complete: async () => {
        callCount++;
        return JSON.stringify([{ index: 0, score: 7, summary: "cached" }]);
      },
    };
    const opts: RerankOptions = { client };

    const first = await rerankWithLLM("cache-query", hits, opts);
    const second = await rerankWithLLM("cache-query", hits, opts);

    expect(first).toEqual(second);
    expect(callCount).toBe(1); // LLM called only once
  });

  it("bypasses cache for different hits", async () => {
    const hit1 = makeHit({ session_id: "s1" });
    const hit2 = makeHit({ session_id: "s2" });
    let callCount = 0;
    const client: LLMClient = {
      complete: async () => {
        callCount++;
        return JSON.stringify([{ index: 0, score: 5, summary: "result" }]);
      },
    };
    await rerankWithLLM("q", [hit1], { client });
    await rerankWithLLM("q", [hit2], { client });
    expect(callCount).toBe(2); // Different hits → different cache keys
  });

  it("pre-populating cache prevents LLM call", async () => {
    const hits = [makeHit()];
    const cacheKey = cacheKeyForRerank("pre-pop", hits);
    const preloaded = [{ index: 0, score: 9, summary: "pre-loaded" }];
    rerankCache.set(cacheKey, preloaded);

    let called = false;
    const client: LLMClient = { complete: async () => { called = true; return "[]"; } };

    const result = await rerankWithLLM("pre-pop", hits, { client });
    expect(result).toEqual(preloaded);
    expect(called).toBe(false);
  });

  it("respects maxCandidates option", async () => {
    const hits = Array.from({ length: 20 }, (_, i) =>
      makeHit({ snippet: `hit ${i}`, session_id: `s${i}` }),
    );
    let receivedPrompt = "";
    const client: LLMClient = {
      complete: async (prompt) => {
        receivedPrompt = prompt;
        return JSON.stringify([{ index: 0, score: 5, summary: "first" }]);
      },
    };
    const opts: RerankOptions = { client, maxCandidates: 3 };
    await rerankWithLLM("query", hits, opts);

    const hitCount = (receivedPrompt.match(/#\d+:/g) || []).length;
    expect(hitCount).toBe(3);
  });
});
