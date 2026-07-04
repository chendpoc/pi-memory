import { describe, expect, it } from "vitest";

import type { MemoryEntry } from "../src/sidecar/protocol.js";
import { resetSidecarQueryCacheForTests, sidecarQueryCache } from "../src/preflight/queryCache.js";

const sampleResults: MemoryEntry[] = [
  {
    content: "Use Vitest",
    relevance: 0.9,
    source: "MEMORY.md",
    timestamp: "2026-07-04T00:00:00.000Z",
  },
];

describe("sidecarQueryCache", () => {
  it("returns cached results for the same generation", () => {
    resetSidecarQueryCacheForTests();
    sidecarQueryCache.onReindexComplete("/agent", 3);
    sidecarQueryCache.set("/agent", "Vitest framework", sampleResults);

    expect(sidecarQueryCache.get("/agent", "vitest  framework")).toEqual(sampleResults);
  });

  it("invalidates entries after reindex generation bump", () => {
    resetSidecarQueryCacheForTests();
    sidecarQueryCache.onReindexComplete("/agent", 1);
    sidecarQueryCache.set("/agent", "Vitest", sampleResults);
    sidecarQueryCache.onReindexComplete("/agent", 2);

    expect(sidecarQueryCache.get("/agent", "Vitest")).toBeNull();
  });
});
