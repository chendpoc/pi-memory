import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFallbackQuery } from "../src/fallback/index.js";
import { memoryMdSnippet } from "../src/fallback/memoryMd.js";
import { sessionKeywordSearch } from "../src/fallback/sessionSearch.js";
import { openConsolidationStore } from "../src/consolidation/stage1/store.js";
import { appendToMemoryMd, createMemoryAppendTool } from "../src/tools/memoryAppend.js";
import { MemoryRecallTool } from "../src/tools/memoryRecall.js";
import type { MemoryQuerier, ServiceStatus } from "../src/types.js";

describe("sessionKeywordSearch", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds keyword hits in Pi-style session JSON", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-sess-"));
    await fs.writeFile(
      path.join(tmpDir, "abc123.json"),
      JSON.stringify({
        id: "abc123",
        title: "Deploy chat",
        created_at: "2026-06-01T10:00:00Z",
        messages: [
          { role: "user", content: "How do I deploy Nexus?" },
          { role: "assistant", content: "Use kubectl apply." },
        ],
      }),
      "utf8",
    );

    const hits = await sessionKeywordSearch(tmpDir, "deploy Nexus", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.session_id).toBe("abc123");
    expect(hits[0]?.role).toBe("user");
    expect(hits[0]?.snippet.toLowerCase()).toContain("deploy");
  });

  it("returns empty for missing directory", async () => {
    const hits = await sessionKeywordSearch("/nonexistent/pi/sessions", "foo", 5);
    expect(hits).toEqual([]);
  });
});

describe("memoryMdSnippet", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns matching lines capped at 4KB", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-mem-"));
    const memPath = path.join(tmpDir, "MEMORY.md");
    await fs.writeFile(
      memPath,
      "- Alice prefers tea\n- Bob likes coffee\n",
      "utf8",
    );
    const snip = await memoryMdSnippet([memPath], "Alice");
    expect(snip).toContain("Alice prefers tea");
  });
});

describe("createFallbackQuery integration", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("wires session + MEMORY.md into memory_recall fallback envelope", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-fb-"));
    const sessionsDir = path.join(tmpDir, "sessions");
    const memPath = path.join(tmpDir, "MEMORY.md");
    await fs.mkdir(sessionsDir);
    await fs.writeFile(
      path.join(sessionsDir, "s1.json"),
      JSON.stringify({
        id: "s1",
        title: "Notes",
        messages: [{ role: "user", content: "Project Phoenix deadline" }],
      }),
      "utf8",
    );
    await fs.writeFile(memPath, "- Phoenix owner is Dana\n", "utf8");

    const fallback = createFallbackQuery({
      sessionsDir,
      memoryMdPaths: [memPath],
    });
    const q: MemoryQuerier = {
      status: () => "unavailable" as ServiceStatus,
      async query() {
        return { env: null, errorClass: "unavailable" };
      },
    };
    const tool = new MemoryRecallTool(q, fallback);
    const r = await tool.run(
      JSON.stringify({ anchor_mentions: ["Phoenix"], mode: "direct_relation" }),
    );
    const body = JSON.parse(r.content) as {
      source: string;
      evidence_quality: string;
      candidates: { scope?: string; evidence: string }[];
    };
    expect(body.source).toBe("fallback");
    expect(body.evidence_quality).toBe("text_search");
    expect(body.candidates.some((c) => c.scope === "session_search")).toBe(true);
    expect(body.candidates.some((c) => c.scope === "memory_md")).toBe(true);
  });
});

describe("appendToMemoryMd", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("appends content with trailing newline", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-append-"));
    const memPath = path.join(tmpDir, "MEMORY.md");
    await appendToMemoryMd(memPath, "- new fact");
    const text = await fs.readFile(memPath, "utf8");
    expect(text).toBe("- new fact\n");
  });

  it("queues memory_append content into stage1 when configured", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-mem-append-stage1-"));
    const dbPath = path.join(tmpDir, "memories.sqlite");
    const tool = createMemoryAppendTool(path.join(tmpDir, "MEMORY.md"), {
      dbPath,
      scope: "global",
      now: "2026-07-02T00:00:00.000Z",
    });

    const result = await tool.run(JSON.stringify({ content: "- remember UTF-8" }));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("queued memory");

    const store = openConsolidationStore(dbPath)!;
    expect(store.listUnselectedStage1(10)[0]!.raw_memory).toBe("- remember UTF-8");
    store.close();
  });
});
