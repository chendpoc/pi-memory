import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "../src/store/index.js";
import { DEFAULT_MAX_LINES } from "../src/constants/memory.js";
import { countLines } from "../src/store/markdown/format.js";
import { defaultMemoryTemplate } from "../src/store/markdown/template.js";

describe("MemoryStore", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initializes template and appends user entries", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
    const store = createMemoryStore({ agentDir: tmpDir });

    await store.ensureInitialized();
    const raw = await store.readRaw();
    expect(raw).toMatch(/^# Memory\n/);
    expect(raw).toContain("## Preferences");
    expect(await store.isEmpty()).toBe(true);

    await store.appendUser({
      id: "pref-1",
      section: "Preferences",
      content: "Prefer TypeScript strict mode",
      timestamp: "2026-07-04T00:00:00.000Z",
    });

    const entries = await store.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.userAuthored).toBe(true);
    expect(entries[0]?.content).toContain("TypeScript strict mode");
  });

  it("exports index documents and fallback text", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
    const store = createMemoryStore({ agentDir: tmpDir });
    await store.ensureInitialized();

    await store.append({
      id: "finding-1",
      section: "Findings",
      content: "Sidecar uses better-sqlite3 only",
      timestamp: "2026-07-04T01:00:00.000Z",
    });

    const docs = await store.exportForIndex();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe("finding-1");
    expect(docs[0]?.content).toBe("[Findings] Sidecar uses better-sqlite3 only");

    const fallback = await store.readForFallback();
    expect(fallback).toContain("better-sqlite3");
  });

  it("appendIfAbsent deduplicates by section + content", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
    const store = createMemoryStore({ agentDir: tmpDir });
    await store.ensureInitialized();

    const entry = {
      id: "todo-1",
      section: "Todos" as const,
      content: "Wire Preflight to sidecar query",
      timestamp: "2026-07-04T02:00:00.000Z",
    };

    expect(await store.appendIfAbsent(entry)).toBe(true);
    expect(await store.appendIfAbsent({ ...entry, id: "todo-2" })).toBe(false);
    expect((await store.listEntries()).length).toBe(1);
  });

  it("overflows to auto file when MEMORY.md exceeds line cap", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
    const templateLines = countLines(defaultMemoryTemplate());
    const store = createMemoryStore({ agentDir: tmpDir, maxLines: templateLines + 2 });
    await store.ensureInitialized();

    for (let i = 0; i < 6; i++) {
      await store.append({
        id: `entry-${i}`,
        section: "Findings",
        content: `Finding number ${i}`,
        timestamp: "2026-07-04T03:00:00.000Z",
      });
    }

    const stats = await store.getStats();
    expect(stats.lineCount).toBeLessThanOrEqual(templateLines + 3);
    expect(stats.overflowFileCount).toBeGreaterThan(0);

    const resolved = await store.listEntries();
    expect(resolved.length).toBe(6);
  });

  it("fires onSyncToSidecar after append", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
    const store = createMemoryStore({ agentDir: tmpDir });
    await store.ensureInitialized();

    let syncCount = 0;
    store.onSyncToSidecar(() => {
      syncCount++;
    });

    await store.appendUser({
      id: "pref-sync",
      section: "Preferences",
      content: "Notify sidecar sync listeners",
      timestamp: "2026-07-04T04:00:00.000Z",
    });

    expect(syncCount).toBe(1);
  });
});

describe("MemoryStore constants", () => {
  it("uses 150 lines by default", () => {
    expect(DEFAULT_MAX_LINES).toBe(150);
  });
});
