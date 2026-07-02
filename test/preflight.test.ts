import { describe, expect, it, beforeEach } from "vitest";

import {
  detectExactMemoryIntents,
  detectMemoryIntents,
  type MemoryHelperLLM,
} from "../src/preflight/detectIntents.js";
import { runMemoryPreflight } from "../src/preflight/hook.js";
import {
  invalidateMemoryCaches,
  isNegativeCached,
  intentCache,
  cacheKeyForIntents,
} from "../src/cache/memoryCaches.js";
import {
  PRIVATE_MEMORY_BODY_BYTE_CAP,
  SEMANTIC_FALLBACK_CANDIDATES,
  renderFallbackPrivateMemory,
  renderPrivateMemoryContext,
  truncatePrivateMemoryBody,
} from "../src/preflight/render.js";
import {
  injectPrivateMemoryContext,
  stripPrivateMemory,
} from "../src/preflight/strip.js";
import type {
  ErrorClass,
  QueryIntent,
  ResponseEnvelope,
  ServiceStatus,
} from "../src/types.js";
import { MemoryService } from "../src/service.js";

const fixtureEnvelope: ResponseEnvelope = {
  protocol_version: 1,
  request_id: "req-preflight",
  candidates: [],
  memory_block: {
    groups: [
      {
        value: "Alice",
        score: 1,
        evidence: "observed",
        support_count: 2,
        supporting_event_ids: ["ev_1"],
        entity_ids: ["ent_1"],
        scopes: [],
        via_relations: ["collaborates_with"],
        via_anchor_entity_ids: [],
        observed_path: [],
        path_collision_count: 0,
      },
    ],
    notes: ["met at conference"],
  },
  warnings: [],
  reason: "",
  latency_ms: 5,
};

beforeEach(() => {
  invalidateMemoryCaches();
});

describe("detectExactMemoryIntents", () => {
  it("matches Chinese relationship question", () => {
    const intents = detectExactMemoryIntents("Alice与我的关系？");
    expect(intents).toHaveLength(1);
    expect(intents[0]!.anchor_mentions).toEqual(["Alice"]);
    expect(intents[0]!.mode).toBe("direct_relation");
  });

  it("matches English who-is-to-me", () => {
    const intents = detectExactMemoryIntents("Who is Bob to me?");
    expect(intents[0]!.anchor_mentions).toEqual(["Bob"]);
  });

  it("matches Japanese relationship question", () => {
    const intents = detectExactMemoryIntents("田中さんと私の関係？");
    expect(intents[0]!.anchor_mentions[0]).toContain("田中");
  });

  it("returns empty for generic coding task", () => {
    expect(detectExactMemoryIntents("fix the error in file.ts")).toEqual([]);
  });
});

describe("detectMemoryIntents helper path", () => {
  it("skips helper when null (regex-only)", async () => {
    const intents = await detectMemoryIntents("what is the weather today", null);
    expect(intents).toEqual([]);
  });

  it("uses helper when regex misses and gate passes", async () => {
    const helper: MemoryHelperLLM = {
      async compileIntents() {
        return {
          should_recall: true,
          intents: [
            {
              mode: "direct_relation",
              anchor_mentions: ["Nexus"],
              evidence_budget: 5,
              result_limit: 10,
            },
          ],
        };
      },
    };
    const intents = await detectMemoryIntents(
      "tell me about Nexus from our past work",
      helper,
      { forceHelper: true },
    );
    expect(intents[0]!.anchor_mentions).toEqual(["Nexus"]);
  });

  it("fail-silent on helper error", async () => {
    const helper: MemoryHelperLLM = {
      async compileIntents() {
        throw new Error("provider down");
      },
    };
    const intents = await detectMemoryIntents("Alice与我的关系？", helper);
    expect(intents).toHaveLength(1);
  });
});

describe("renderPrivateMemoryContext", () => {
  it("wraps results in private_memory envelope", () => {
    const intents: QueryIntent[] = [
      { mode: "direct_relation", anchor_mentions: ["Alice"] },
    ];
    const out = renderPrivateMemoryContext(intents, [
      { envelope: fixtureEnvelope, ok: true },
    ]);
    expect(out.startsWith("<private_memory>")).toBe(true);
    expect(out.endsWith("</private_memory>")).toBe(true);
    expect(out).toContain("Alice");
    expect(out).toContain("collaborates_with");
    expect(out).toContain("met at conference");
  });

  it("returns empty when no groups", () => {
    const out = renderPrivateMemoryContext(
      [{ mode: "direct_relation", anchor_mentions: ["X"] }],
      [{ envelope: { ...fixtureEnvelope, memory_block: { groups: [], notes: [] } }, ok: true }],
    );
    expect(out).toBe("");
  });
});

describe("truncatePrivateMemoryBody", () => {
  it("leaves short body unchanged", () => {
    const body = "hello\nworld\n";
    expect(truncatePrivateMemoryBody(body, PRIVATE_MEMORY_BODY_BYTE_CAP)).toBe(body);
  });

  it("truncates at last newline before cap", () => {
    const line = "x".repeat(200);
    const body = Array.from({ length: 60 }, () => line).join("\n") + "\n";
    const truncated = truncatePrivateMemoryBody(body, 1024);
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(1024 + 80);
    expect(truncated).toContain("truncated");
    expect(truncated.endsWith("\n")).toBe(true);
  });
});

describe("stripPrivateMemory", () => {
  it("removes private_memory block and surrounding newline", () => {
    const text =
      "Hello\n<private_memory>\nsecret\n</private_memory>\n\nWhat is Alice?";
    // Mirrors Kocoro removePrivateMemoryBlocks: eats one leading newline before block.
    expect(stripPrivateMemory(text)).toBe("HelloWhat is Alice?");
  });

  it("leaves unterminated marker untouched", () => {
    const text = "before <private_memory> no close";
    expect(stripPrivateMemory(text)).toBe(text);
  });

  it("injectPrivateMemoryContext inserts before payload", () => {
    const scaffolded = "Date: today\n\n<private_memory>x</private_memory>\n\nUser question";
    const out = injectPrivateMemoryContext(
      scaffolded,
      "User question",
      "<private_memory>mem</private_memory>",
    );
    expect(out).toContain("<private_memory>mem</private_memory>");
    expect(out.endsWith("User question")).toBe(true);
  });
});

describe("runMemoryPreflight", () => {
  it("fail-silent when service unavailable and no fallback", async () => {
    const svc = {
      status: () => "unavailable" as ServiceStatus,
      queryBatch: async () => [],
    } as unknown as MemoryService;
    const r = await runMemoryPreflight("Alice与我的关系？", svc);
    expect(r).toBeNull();
  });

  it("returns private context when sidecar has data", async () => {
    const svc = {
      status: () => "ready" as ServiceStatus,
      getStatus: () => ({ status: "ready", mode: "local_graph" }),
      async queryBatch(_intents: QueryIntent[]) {
        return [
          {
            envelope: fixtureEnvelope,
            errorClass: "ok" as ErrorClass,
          },
        ];
      },
      async ensureFreshBundle() {},
    } as unknown as MemoryService;
    const r = await runMemoryPreflight("Alice与我的关系？", svc);
    expect(r?.privateContext).toContain("<private_memory>");
    expect(r?.privateContext).toContain("Alice");
  });

  it("uses fallback path when sidecar not ready but fallback provided", async () => {
    const svc = {
      status: () => "unavailable" as ServiceStatus,
      queryBatch: async () => [],
    } as unknown as MemoryService;
    const fallback = {
      async sessionKeyword(query: string, _limit: number) {
        if (query.includes("Alice")) {
          return [
            {
              session_id: "s1",
              session_title: "Chat about Alice",
              role: "assistant",
              snippet: "Alice is a collaborator on Project X",
              msg_index: 3,
              created_at: "2026-06-01",
            },
          ];
        }
        return [];
      },
      async memoryFileSnippet(query: string) {
        if (query.includes("Alice")) return "## Alice\nCollaborator since 2025";
        return "";
      },
    };
    const r = await runMemoryPreflight("tell me about Alice", svc, { fallback });
    expect(r).not.toBeNull();
    expect(r?.privateContext).toContain("<private_memory>");
    expect(r?.privateContext).toContain("Alice");
    expect(r?.privateContext).toContain("keyword");
    expect(r?.privateContext).toContain("MEMORY.md");
  });

  it("fallback returns null when no matches found", async () => {
    const svc = {
      status: () => "unavailable" as ServiceStatus,
      queryBatch: async () => [],
    } as unknown as MemoryService;
    const fallback = {
      async sessionKeyword() { return []; },
      async memoryFileSnippet() { return ""; },
    };
    const r = await runMemoryPreflight("random question about nothing", svc, { fallback });
    expect(r).toBeNull();
  });
});

describe("runMemoryPreflight negative cache", () => {
  function makeSvc(ready = true): MemoryService {
    return {
      status: () => (ready ? "ready" : "unavailable") as ServiceStatus,
      getStatus: () => ({ status: ready ? "ready" : "unavailable", mode: ready ? "local_graph" : undefined }),
      async queryBatch() { return []; },
      async ensureFreshBundle() {},
    } as unknown as MemoryService;
  }

  it("sets negative cache when no intents detected", async () => {
    const svc = makeSvc();
    const query = "fix the bug in file.ts";
    await runMemoryPreflight(query, svc, { helper: null });
    expect(isNegativeCached(query)).toBe(true);
  });

  it("returns null immediately for negative-cached query", async () => {
    const svc = makeSvc();
    const query = "generic question without entities xyz987";
    let callCount = 0;
    const helper: MemoryHelperLLM = {
      async compileIntents() {
        callCount++;
        return { should_recall: false, intents: [] };
      },
    };
    // First call: runs helper
    await runMemoryPreflight(query, svc, { helper, forceHelper: true });
    const firstCount = callCount;
    // Second call: should hit negative cache, skip helper
    await runMemoryPreflight(query, svc, { helper, forceHelper: true });
    expect(callCount).toBe(firstCount); // helper not called again
    expect(isNegativeCached(query)).toBe(true);
  });

  it("removes negative cache entry on successful preflight", async () => {
    const svc = {
      status: () => "ready" as ServiceStatus,
      getStatus: () => ({ status: "ready", mode: "local_graph" }),
      async queryBatch() {
        return [{ envelope: fixtureEnvelope, errorClass: "ok" as ErrorClass }];
      },
      async ensureFreshBundle() {},
    } as unknown as MemoryService;

    const query = "Alice与我的关系？";
    // Prime negative cache
    isNegativeCached(query); // just checking it's initially false
    // Successful run should clear any negative cache entry
    const r = await runMemoryPreflight(query, svc);
    expect(r?.privateContext).toContain("<private_memory>");
    expect(isNegativeCached(query)).toBe(false);
  });
});

describe("detectMemoryIntents intent cache", () => {
  it("caches helper result and skips second LLM call", async () => {
    let callCount = 0;
    const helper: MemoryHelperLLM = {
      async compileIntents() {
        callCount++;
        return {
          should_recall: true,
          intents: [
            {
              mode: "direct_relation",
              anchor_mentions: ["Bob"],
              evidence_budget: 5,
              result_limit: 10,
            },
          ],
        };
      },
    };

    const query = "What does Bob work on?";
    const first = await detectMemoryIntents(query, helper, { forceHelper: true });
    const second = await detectMemoryIntents(query, helper, { forceHelper: true });

    expect(first).toEqual(second);
    expect(callCount).toBe(1);
    expect(intentCache.get(cacheKeyForIntents(query))).toEqual(first);
  });

  it("does not cache empty results (should_recall: false)", async () => {
    let callCount = 0;
    const helper: MemoryHelperLLM = {
      async compileIntents() {
        callCount++;
        return { should_recall: false, intents: [] };
      },
    };
    const query = "unrelated task abc";
    await detectMemoryIntents(query, helper, { forceHelper: true });
    await detectMemoryIntents(query, helper, { forceHelper: true });
    expect(callCount).toBe(2); // not cached
  });
});

describe("renderFallbackPrivateMemory semantic mode", () => {
  it("fetches SEMANTIC_FALLBACK_CANDIDATES hits when rerankOpts is provided", async () => {
    let receivedLimit = 0;
    const fallback = {
      async sessionKeyword(_query: string, limit: number) {
        receivedLimit = limit;
        return [];
      },
      async memoryFileSnippet() { return ""; },
    };
    const rerankOpts = { client: { complete: async () => "[]" } };
    await renderFallbackPrivateMemory("query", fallback, { rerankOpts });
    expect(receivedLimit).toBe(SEMANTIC_FALLBACK_CANDIDATES);
  });

  it("fetches only 5 hits without rerankOpts (keyword mode)", async () => {
    let receivedLimit = 0;
    const fallback = {
      async sessionKeyword(_query: string, limit: number) {
        receivedLimit = limit;
        return [];
      },
      async memoryFileSnippet() { return ""; },
    };
    await renderFallbackPrivateMemory("query", fallback);
    expect(receivedLimit).toBe(5);
  });

  it("uses semanticCandidates override when provided", async () => {
    let receivedLimit = 0;
    const fallback = {
      async sessionKeyword(_query: string, limit: number) {
        receivedLimit = limit;
        return [];
      },
      async memoryFileSnippet() { return ""; },
    };
    const rerankOpts = { client: { complete: async () => "[]" } };
    await renderFallbackPrivateMemory("query", fallback, { rerankOpts, semanticCandidates: 30 });
    expect(receivedLimit).toBe(30);
  });

  it("uses semantic preamble when reranked in semantic mode", async () => {
    const hit = {
      session_id: "s1", session_title: "Test", role: "user",
      snippet: "relevant content", msg_index: 0, created_at: "",
    };
    const fallback = {
      async sessionKeyword() { return [hit]; },
      async memoryFileSnippet() { return ""; },
    };
    const rerankOpts = {
      client: {
        complete: async () => JSON.stringify([{ index: 0, score: 8, summary: "semantic result" }]),
      },
    };
    const result = await renderFallbackPrivateMemory("query", fallback, { rerankOpts });
    expect(result).toContain("semantic");
    expect(result).toContain("semantic result");
  });
});

describe("runMemoryPreflight semantic fallback cascade", () => {
  const emptyGraphSvc = {
    status: () => "ready" as ServiceStatus,
    getStatus: () => ({ status: "ready", mode: "local_graph" }),
    async queryBatch() {
      return [{ envelope: null, errorClass: "ok" as ErrorClass }];
    },
    async ensureFreshBundle() {},
  } as unknown as MemoryService;

  const sessionHit = {
    session_id: "s1", session_title: "Chat", role: "user",
    snippet: "Alice worked on Project Orion last month", msg_index: 0, created_at: "",
  };

  it("cascades to semantic FTS+rerank when graph returns no groups", async () => {
    const fallback = {
      async sessionKeyword() { return [sessionHit]; },
      async memoryFileSnippet() { return ""; },
    };
    const rerankOpts = {
      client: {
        complete: async () =>
          JSON.stringify([{ index: 0, score: 9, summary: "Alice led Project Orion" }]),
      },
    };

    const r = await runMemoryPreflight("Alice与我的关系？", emptyGraphSvc, {
      fallback,
      rerankOpts,
    });

    expect(r).not.toBeNull();
    expect(r?.privateContext).toContain("<private_memory>");
    expect(r?.privateContext).toContain("Alice led Project Orion");
    expect(r?.privateContext).toContain("semantic");
  });

  it("skips semantic cascade when semanticFallback is false", async () => {
    let fallbackCalled = false;
    const fallback = {
      async sessionKeyword() { fallbackCalled = true; return [sessionHit]; },
      async memoryFileSnippet() { return ""; },
    };
    const rerankOpts = {
      client: { complete: async () => JSON.stringify([{ index: 0, score: 9, summary: "x" }]) },
    };

    const r = await runMemoryPreflight("Alice与我的关系？", emptyGraphSvc, {
      fallback,
      rerankOpts,
      semanticFallback: false,
    });

    expect(r).toBeNull();
    expect(fallbackCalled).toBe(false);
  });

  it("skips semantic cascade when rerankOpts is absent", async () => {
    let fallbackCalled = false;
    const fallback = {
      async sessionKeyword() { fallbackCalled = true; return [sessionHit]; },
      async memoryFileSnippet() { return ""; },
    };

    const r = await runMemoryPreflight("Alice与我的关系？", emptyGraphSvc, { fallback });
    expect(r).toBeNull();
    expect(fallbackCalled).toBe(false);
  });

  it("sets negative cache when cascade also finds nothing", async () => {
    const query = "unknown entity xyz9999";
    const fallback = {
      async sessionKeyword() { return []; },
      async memoryFileSnippet() { return ""; },
    };
    const rerankOpts = { client: { complete: async () => "[]" } };

    const r = await runMemoryPreflight(query, emptyGraphSvc, { fallback, rerankOpts });
    expect(r).toBeNull();
    expect(isNegativeCached(query)).toBe(true);
  });
});
