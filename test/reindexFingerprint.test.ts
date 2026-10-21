import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resetEmbedderForTests } from "../src/sidecar/server/vec/embedder.js";
import { resetVecStoreForTests } from "../src/sidecar/server/vec/store.js";
import { computeDocumentsFingerprint } from "../src/sidecar/server/vec/fingerprint.js";
import { getEmbedder } from "../src/adapters/embed/factory.js";
import { handleReindex } from "../src/sidecar/server/reindex.js";
import type { IndexDocument } from "../src/sidecar/protocol.js";

const DOC_A: IndexDocument = {
  id: "pref-1",
  content: "User prefers TypeScript strict mode",
  source: "MEMORY.md",
  timestamp: "2026-07-04T00:00:00.000Z",
};

const DOC_B: IndexDocument = {
  id: "todo-1",
  content: "Ship sidecar vector search MVP",
  source: "MEMORY.md",
  timestamp: "2026-07-04T01:00:00.000Z",
};

describe("computeDocumentsFingerprint", () => {
  const embedder = getEmbedder();

  it("is order-insensitive for the same document set", () => {
    const a = computeDocumentsFingerprint([DOC_A, DOC_B], embedder);
    const b = computeDocumentsFingerprint([DOC_B, DOC_A], embedder);
    expect(a).toBe(b);
  });

  it("changes when content changes", () => {
    const base = computeDocumentsFingerprint([DOC_A, DOC_B], embedder);
    const mutated = computeDocumentsFingerprint([{ ...DOC_A, content: "changed" }, DOC_B], embedder);
    expect(mutated).not.toBe(base);
  });

  it("changes when the document set grows or shrinks", () => {
    const base = computeDocumentsFingerprint([DOC_A], embedder);
    const grown = computeDocumentsFingerprint([DOC_A, DOC_B], embedder);
    expect(grown).not.toBe(base);
    expect(computeDocumentsFingerprint([], embedder)).not.toBe(base);
  });
});

describe("handleReindex fingerprint skip", () => {
  let tmpDir: string;
  let dbPath: string;

  afterEach(() => {
    resetVecStoreForTests();
    resetEmbedderForTests();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function freshCtx(): { dbPath: string } {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-reindex-fp-"));
    return { dbPath: join(tmpDir, "memory.db") };
  }

  it("skips re-embedding when the same documents are reindexed", async () => {
    const ctx = freshCtx();

    const first = await handleReindex("r1", ctx, [DOC_A, DOC_B]);
    expect(first.indexed).toBe(2);
    expect(first.skipped).toBeUndefined();

    const second = await handleReindex("r2", ctx, [DOC_A, DOC_B]);
    expect(second.skipped).toBe("fingerprint_match");
    expect(second.indexed).toBe(0);
    expect(second.index_generation).toBe(first.index_generation);

    // Data is still queryable after the skipped round.
    const store = (await import("../src/sidecar/server/vec/store.js")).getVecStore(ctx.dbPath);
    const results = await store.query("TypeScript strict mode");
    expect(results.length).toBeGreaterThan(0);
  });

  it("rebuilds when content changes, then skips again", async () => {
    const ctx = freshCtx();

    await handleReindex("r1", ctx, [DOC_A, DOC_B]);
    const mutated: IndexDocument = { ...DOC_A, content: "User prefers Rust over TypeScript now" };
    const rebuilt = await handleReindex("r2", ctx, [mutated, DOC_B]);
    expect(rebuilt.skipped).toBeUndefined();
    expect(rebuilt.indexed).toBe(2);

    const again = await handleReindex("r3", ctx, [mutated, DOC_B]);
    expect(again.skipped).toBe("fingerprint_match");

    const store = (await import("../src/sidecar/server/vec/store.js")).getVecStore(ctx.dbPath);
    const results = await store.query("Rust over TypeScript");
    expect(results.length).toBeGreaterThan(0);
  });

  it("does not skip for an empty document set (never fingerprints empty)", async () => {
    const ctx = freshCtx();

    await handleReindex("r1", ctx, [DOC_A]);
    // Empty reindex is the explicit "clear/shrink" path and must stay effective.
    const cleared = await handleReindex("r2", ctx, []);
    expect(cleared.skipped).toBeUndefined();

    // And a subsequent non-empty reindex re-embeds (fingerprint was not stored on empty).
    const reembed = await handleReindex("r3", ctx, [DOC_A]);
    expect(reembed.skipped).toBeUndefined();
    expect(reembed.indexed).toBe(1);
  });
});
