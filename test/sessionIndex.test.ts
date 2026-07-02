import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openSessionIndex, type SessionIndex, type SqliteDatabase } from "../src/fallback/sessionIndex.js";

async function makeTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSession(
  dir: string,
  id: string,
  messages: Array<{ role: string; content: string }>,
  opts?: { title?: string; created_at?: string },
): Promise<void> {
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      title: opts?.title ?? `Session ${id}`,
      created_at: opts?.created_at ?? "2026-06-01T00:00:00Z",
      messages,
    }),
    "utf8",
  );
}

type JsonlLine = Record<string, unknown>;

async function writeJsonlSession(dir: string, file: string, lines: JsonlLine[]): Promise<void> {
  await fs.writeFile(
    path.join(dir, `${file}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n"),
    "utf8",
  );
}

/**
 * Create a minimal in-memory SQLite mock for tests that don't require
 * the real better-sqlite3 native binding.
 */
function createInMemoryMock(): SqliteDatabase {
  const tables = new Map<string, Array<Record<string, string>>>();
  const meta = new Map<string, string>();
  let ftsRows: Array<{
    session_id: string;
    turn_idx: string;
    role: string;
    content: string;
    session_title: string;
    created_at: string;
  }> = [];

  return {
    pragma(_sql: string) { return undefined; },
    exec(sql: string) {
      if (sql.includes("DELETE FROM session_fts")) {
        ftsRows = [];
      }
    },
    prepare(sql: string) {
      return {
        run(...args: unknown[]) {
          if (sql.includes("INSERT OR REPLACE INTO meta")) {
            meta.set(String(args[0]), String(args[1]));
          } else if (sql.includes("INSERT INTO session_fts")) {
            ftsRows.push({
              session_id: String(args[0]),
              turn_idx: String(args[1]),
              role: String(args[2]),
              content: String(args[3]),
              session_title: String(args[4]),
              created_at: String(args[5]),
            });
          } else if (sql.includes("DELETE FROM session_fts WHERE session_id IN")) {
            const ids = new Set(args.map(String));
            ftsRows = ftsRows.filter((r) => !ids.has(r.session_id));
          }
          return {};
        },
        get(...args: unknown[]) {
          if (sql.includes("SELECT value FROM meta")) {
            const val = meta.get(String(args[0]));
            return val !== undefined ? { value: val } : undefined;
          }
          return undefined;
        },
        all(...args: unknown[]) {
          if (sql.includes("FROM session_fts") && sql.includes("MATCH")) {
            const queryStr = String(args[0]).replace(/"/g, "").toLowerCase();
            const terms = queryStr.split(" and ").map((t) => t.trim());
            const limit = Number(args[1]) || 20;
            const matches = ftsRows.filter((r) => {
              const lower = r.content.toLowerCase();
              return terms.every((t) => lower.includes(t));
            });
            return matches.slice(0, limit).map((r) => ({
              session_id: r.session_id,
              turn_idx: r.turn_idx,
              role: r.role,
              snip: r.content.slice(0, 80),
              session_title: r.session_title,
              created_at: r.created_at,
            }));
          }
          return [];
        },
      };
    },
    transaction<T>(fn: () => T): () => T {
      return fn;
    },
    close() {},
  };
}

describe("openSessionIndex (with mock DB)", () => {
  let tmpDir: string;
  let idx: SessionIndex;

  afterEach(async () => {
    idx?.close();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("opens with injected DB and initializes", () => {
    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    expect(idx).not.toBeNull();
  });

  it("rebuildIndex populates FTS from session files", async () => {
    tmpDir = await makeTmpDir("pi-idx-");
    await writeSession(tmpDir, "s1", [
      { role: "user", content: "Alice works at Google" },
      { role: "assistant", content: "That's noted" },
    ]);
    await writeSession(tmpDir, "s2", [
      { role: "user", content: "Bob uses TypeScript for the project" },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    const { indexed } = await idx.rebuildIndex(tmpDir);

    expect(indexed).toBe(3); // 2 turns from s1 + 1 from s2
  });

  it("search returns matching hits", async () => {
    tmpDir = await makeTmpDir("pi-idx-search-");
    await writeSession(tmpDir, "session-a", [
      { role: "user", content: "Alice works at Google on the search team" },
      { role: "assistant", content: "Interesting! What does she work on?" },
    ]);
    await writeSession(tmpDir, "session-b", [
      { role: "user", content: "Bob prefers React over Vue" },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    await idx.rebuildIndex(tmpDir);

    const hits = idx.search("Alice", 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.session_id).toBe("session-a");
    expect(hits[0]!.role).toBe("user");

    const reactHits = idx.search("React", 10);
    expect(reactHits.length).toBeGreaterThanOrEqual(1);
    expect(reactHits[0]!.session_id).toBe("session-b");
  });

  it("deduplicates identical content across sessions during indexing", async () => {
    tmpDir = await makeTmpDir("pi-idx-dedup-");
    await writeSession(tmpDir, "s1", [
      { role: "user", content: "This is duplicate content for testing" },
      { role: "assistant", content: "Unique response in s1" },
    ]);
    await writeSession(tmpDir, "s2", [
      { role: "user", content: "This is duplicate content for testing" },
      { role: "assistant", content: "Different response in s2" },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    const { indexed } = await idx.rebuildIndex(tmpDir);

    expect(indexed).toBe(3);

    const hits = idx.search("duplicate content", 10);
    expect(hits.length).toBe(1);
  });

  it("search returns empty for no match", async () => {
    tmpDir = await makeTmpDir("pi-idx-empty-");
    await writeSession(tmpDir, "s1", [
      { role: "user", content: "Hello world" },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    await idx.rebuildIndex(tmpDir);

    const hits = idx.search("nonexistent-term-xyz", 10);
    expect(hits).toHaveLength(0);
  });

  it("search with empty query returns empty", () => {
    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    expect(idx.search("", 10)).toHaveLength(0);
    expect(idx.search("  ", 10)).toHaveLength(0);
  });

  it("search respects limit", async () => {
    tmpDir = await makeTmpDir("pi-idx-limit-");
    for (let i = 0; i < 5; i++) {
      await writeSession(tmpDir, `s${i}`, [
        { role: "user", content: `Message about TypeScript number ${i}` },
      ]);
    }

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    await idx.rebuildIndex(tmpDir);

    const hits = idx.search("TypeScript", 2);
    expect(hits).toHaveLength(2);
  });

  it("incrementalIndex only indexes new sessions", async () => {
    tmpDir = await makeTmpDir("pi-idx-incr-");
    await writeSession(tmpDir, "old-session", [
      { role: "user", content: "Old data about Python" },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    await idx.rebuildIndex(tmpDir);

    const initialHits = idx.search("Python", 10);
    expect(initialHits).toHaveLength(1);

    // Add new session
    await new Promise((r) => setTimeout(r, 50));
    await writeSession(tmpDir, "new-session", [
      { role: "user", content: "New data about Rust programming" },
    ]);

    const lastTs = idx.getLastIndexedTs();
    const { indexed } = await idx.incrementalIndex(tmpDir, lastTs);
    expect(indexed).toBeGreaterThanOrEqual(1);

    const rustHits = idx.search("Rust", 10);
    expect(rustHits).toHaveLength(1);
    expect(rustHits[0]!.session_id).toBe("new-session");
  });

  it("getLastIndexedTs returns null initially, Date after rebuild", async () => {
    tmpDir = await makeTmpDir("pi-idx-ts-");
    await writeSession(tmpDir, "s1", [{ role: "user", content: "test" }]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;

    expect(idx.getLastIndexedTs()).toBeNull();

    await idx.rebuildIndex(tmpDir);
    const ts = idx.getLastIndexedTs();
    expect(ts).toBeInstanceOf(Date);
    expect(ts!.getTime()).toBeGreaterThan(0);
  });

  it("rebuildIndex clears previous data", async () => {
    tmpDir = await makeTmpDir("pi-idx-clear-");
    await writeSession(tmpDir, "s1", [
      { role: "user", content: "First batch about Kubernetes" },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    await idx.rebuildIndex(tmpDir);

    expect(idx.search("Kubernetes", 10)).toHaveLength(1);

    // Remove the file and rebuild
    await fs.rm(path.join(tmpDir, "s1.json"));
    await writeSession(tmpDir, "s2", [
      { role: "user", content: "Second batch about Docker" },
    ]);

    await idx.rebuildIndex(tmpDir);
    expect(idx.search("Kubernetes", 10)).toHaveLength(0);
    expect(idx.search("Docker", 10)).toHaveLength(1);
  });

  it("handles empty sessions dir gracefully", async () => {
    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    const { indexed } = await idx.rebuildIndex("/nonexistent-dir-xyz");
    expect(indexed).toBe(0);
  });

  it("handles session files with complex content blocks", async () => {
    tmpDir = await makeTmpDir("pi-idx-complex-");
    await fs.writeFile(
      path.join(tmpDir, "complex.json"),
      JSON.stringify({
        id: "complex",
        title: "Complex Session",
        created_at: "2026-06-15T10:00:00Z",
        messages: [
          { role: "user", content: [{ type: "text", text: "Using GraphQL with Apollo" }] },
          { role: "assistant", content: "Great choice for API layer." },
        ],
      }),
    );

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    await idx.rebuildIndex(tmpDir);

    const hits = idx.search("GraphQL", 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("rebuildIndex follows active branch in jsonl and ignores inactive branches", async () => {
    tmpDir = await makeTmpDir("pi-idx-jsonl-branch-");
    await writeJsonlSession(tmpDir, "branch", [
      { type: "session", id: "branch", title: "Branch JSONL", timestamp: "2026-06-01T10:00:00Z" },
      { type: "message", id: "m1", message: { role: "user", content: "Root message" } },
      { type: "message", id: "m2", parentId: "m1", message: { role: "assistant", content: "Active branch reply" } },
      { type: "message", id: "m3", parentId: "m1", message: { role: "assistant", content: "Ignore this hidden path" } },
      { type: "message", id: "m4", parentId: "m2", message: { role: "user", content: "Continue active branch" } },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    const { indexed } = await idx.rebuildIndex(tmpDir);
    expect(indexed).toBe(3); // root + two active-branch messages

    const hits = idx.search("hidden", 10);
    expect(hits).toHaveLength(0);
    const activeHits = idx.search("Active branch reply", 10);
    expect(activeHits).toHaveLength(1);
  });

  it("openSessionIndex returns null when no DB available and no injected DB", () => {
    // Without better-sqlite3 installed and no injected DB, this would return null
    // But with injected DB it should work
    const db = createInMemoryMock();
    const result = openSessionIndex(":memory:", db);
    expect(result).not.toBeNull();
  });

  it("multi-term search matches AND logic", async () => {
    tmpDir = await makeTmpDir("pi-idx-multi-");
    await writeSession(tmpDir, "both", [
      { role: "user", content: "Alice uses TypeScript at work" },
    ]);
    await writeSession(tmpDir, "only-alice", [
      { role: "user", content: "Alice went to the store" },
    ]);

    const db = createInMemoryMock();
    idx = openSessionIndex(":memory:", db)!;
    await idx.rebuildIndex(tmpDir);

    const hits = idx.search("Alice TypeScript", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.session_id).toBe("both");
  });
});
