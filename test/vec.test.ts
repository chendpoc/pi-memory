import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mmrSelect } from "../src/sidecar/server/vec/mmr.js";
import { blobToEmbedding, embeddingToBlob } from "../src/sidecar/server/vec/embeddingCodec.js";
import { resetEmbedderForTests } from "../src/sidecar/server/vec/embedder.js";
import { getVecStore, resetVecStoreForTests } from "../src/sidecar/server/vec/store.js";

describe("embeddingCodec", () => {
  it("round-trips float32 embeddings", () => {
    const original = new Float32Array([1, 2, 3.5]);
    const blob = embeddingToBlob(original);
    const restored = blobToEmbedding(blob);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});

describe("mmrSelect", () => {
  it("prefers diverse results over near-duplicates", () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      {
        chunkId: "a",
        content: "a",
        source: "s",
        timestamp: "t",
        distance: 0.1,
        embedding: new Float32Array([0.99, 0.1, 0]),
      },
      {
        chunkId: "b",
        content: "b",
        source: "s",
        timestamp: "t",
        distance: 0.2,
        embedding: new Float32Array([0.98, 0.15, 0]),
      },
      {
        chunkId: "c",
        content: "c",
        source: "s",
        timestamp: "t",
        distance: 0.25,
        embedding: new Float32Array([0, 1, 0]),
      },
    ];

    const selected = mmrSelect(query, candidates, 2, 0.7);
    expect(selected).toHaveLength(2);
    expect(selected[0]?.chunkId).toBe("a");
  });
});

describe("VecStore", () => {
  let tmpDir: string;
  let dbPath: string;

  afterEach(() => {
    resetVecStoreForTests();
    resetEmbedderForTests();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reindexes documents and returns matches on query", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-vec-"));
    dbPath = join(tmpDir, "memory.db");
    const store = getVecStore(dbPath);

    const outcome = await store.reindex([
      {
        id: "pref-1",
        content: "User prefers TypeScript strict mode",
        source: "MEMORY.md",
        timestamp: "2026-07-04T00:00:00.000Z",
      },
      {
        id: "todo-1",
        content: "Ship sidecar vector search MVP",
        source: "MEMORY.md",
        timestamp: "2026-07-04T01:00:00.000Z",
      },
    ]);

    expect(outcome.indexed).toBe(2);
    expect(outcome.indexGeneration).toBe(1);

    const results = await store.query("User prefers TypeScript strict mode");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toContain("TypeScript strict mode");
    expect(results[0]?.relevance).toBeGreaterThan(0.4);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns no results when nothing passes the relevance threshold", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-vec-threshold-"));
    dbPath = join(tmpDir, "memory.db");
    const store = getVecStore(dbPath);

    await store.reindex([
      {
        id: "pref-1",
        content: "User prefers TypeScript strict mode",
        source: "MEMORY.md",
        timestamp: "2026-07-04T00:00:00.000Z",
      },
    ]);

    const results = await store.query("quantum entanglement lunar eclipse");
    expect(results).toEqual([]);
  });

  it("clears chunks when stored embedding meta mismatches", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-vec-meta-"));
    dbPath = join(tmpDir, "memory.vec.sqlite");
    const store = getVecStore(dbPath);

    await store.reindex([
      {
        id: "a",
        content: "alpha fact",
        source: "MEMORY.md",
        timestamp: "2026-07-04T00:00:00.000Z",
      },
    ]);

    const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
    db.prepare("UPDATE meta SET value = ? WHERE key = 'embedding_model'").run("stale-model");

    const outcome = await store.reindex([
      {
        id: "b",
        content: "beta fact",
        source: "MEMORY.md",
        timestamp: "2026-07-04T01:00:00.000Z",
      },
    ]);

    expect(outcome.indexed).toBe(1);
    const rows = db.prepare("SELECT chunk_id FROM memory_chunks").all() as Array<{ chunk_id: string }>;
    expect(rows.map((row) => row.chunk_id)).toEqual(["b"]);
  });
});
