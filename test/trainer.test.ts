import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSessions } from "../src/trainer/sessionLoader.js";
import { extractFacts, RELATION_CATALOG, ALL_RELATIONS } from "../src/trainer/extractFacts.js";
import { resolveEntities } from "../src/trainer/entityResolver.js";
import { buildBundle } from "../src/trainer/bundleBuilder.js";
import { readMarker, writeMarker } from "../src/trainer/marker.js";
import { trainBundle } from "../src/trainer/index.js";
import type { BundleManifest } from "../src/sidecar/bundle.js";
import type { LoadedSession } from "../src/trainer/sessionLoader.js";

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

// ── sessionLoader ──

describe("sessionLoader", () => {
  let tmpDir: string;
  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads sessions from directory", async () => {
    tmpDir = await makeTmpDir("pi-loader-");
    await writeSession(tmpDir, "s1", [
      { role: "user", content: "Hello Alice" },
      { role: "assistant", content: "Hi there" },
    ]);
    await writeSession(tmpDir, "s2", [
      { role: "user", content: "Tell me about React" },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.turns.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0]!.id).toBeTruthy();
  });

  it("skips files modified before marker", async () => {
    tmpDir = await makeTmpDir("pi-loader-marker-");
    await writeSession(tmpDir, "old", [
      { role: "user", content: "old session" },
    ]);

    // Sleep briefly so mtime is after the "old" file
    await new Promise((r) => setTimeout(r, 50));
    const marker = new Date();
    await new Promise((r) => setTimeout(r, 50));

    await writeSession(tmpDir, "new", [
      { role: "user", content: "new session" },
    ]);

    const sessions = await loadSessions({
      sessionsDir: tmpDir,
      modifiedAfter: marker,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe("new");
  });

  it("deduplicates sessions with identical content", async () => {
    tmpDir = await makeTmpDir("pi-loader-dedup-");
    const messages = [
      { role: "user", content: "Hello duplicate" },
      { role: "assistant", content: "Same response" },
    ];
    await writeSession(tmpDir, "s1", messages, { title: "First" });
    await writeSession(tmpDir, "s2", messages, { title: "Second" });
    await writeSession(tmpDir, "s3", [
      { role: "user", content: "Unique content" },
    ], { title: "Third" });

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toContain("s3");
  });

  it("keeps sessions with different content", async () => {
    tmpDir = await makeTmpDir("pi-loader-nodedup-");
    await writeSession(tmpDir, "a", [
      { role: "user", content: "Content A" },
    ]);
    await writeSession(tmpDir, "b", [
      { role: "user", content: "Content B" },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(2);
  });

  it("skips empty messages", async () => {
    tmpDir = await makeTmpDir("pi-loader-empty-");
    await writeSession(tmpDir, "empty", [
      { role: "user", content: "" },
      { role: "user", content: "   " },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(0);
  });

  it("returns empty for missing dir", async () => {
    const sessions = await loadSessions({
      sessionsDir: "/nonexistent/path/sessions",
    });
    expect(sessions).toHaveLength(0);
  });

  it("handles array content blocks", async () => {
    tmpDir = await makeTmpDir("pi-loader-array-");
    await writeSession(tmpDir, "arr", [
      { role: "user", content: [{ text: "block content" }] as unknown as string },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.turns[0]!.content).toBe("block content");
  });

  it("loads linear jsonl sessions", async () => {
    tmpDir = await makeTmpDir("pi-loader-jsonl-linear-");
    await writeJsonlSession(tmpDir, "legacy", [
      { type: "session", id: "jsonl-linear", title: "Linear JSONL", timestamp: "2026-06-01T10:00:00Z" },
      { type: "message", message: { role: "user", content: "JSONL hello" } },
      { type: "message", message: { role: "assistant", content: "Hello back" } },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe("jsonl-linear");
    expect(sessions[0]!.turns).toHaveLength(2);
  });

  it("keeps only active branch messages for forked jsonl", async () => {
    tmpDir = await makeTmpDir("pi-loader-jsonl-branch-");
    await writeJsonlSession(tmpDir, "fork", [
      { type: "session", id: "root", title: "Forked", timestamp: "2026-06-01T10:00:00Z" },
      { type: "message", id: "m1", message: { role: "user", content: "Root turn" } },
      { type: "message", id: "m2", parentId: "m1", message: { role: "assistant", content: "Main branch 1" } },
      { type: "message", id: "m3", parentId: "m1", message: { role: "assistant", content: "Side branch 1" } },
      { type: "message", id: "m4", parentId: "m2", message: { role: "user", content: "Main branch 2" } },
      { type: "message", id: "m5", parentId: "m3", message: { role: "user", content: "Side branch 2" } },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.turns.map((t) => t.content)).toEqual([
      "Root turn",
      "Side branch 1",
      "Side branch 2",
    ]);
    expect(sessions[0]!.parentSessionId).toBeUndefined();
    expect(sessions[0]!.id).toBe("m5");
  });

  it("uses explicit active leaf hint and parses parent session metadata", async () => {
    tmpDir = await makeTmpDir("pi-loader-jsonl-active-");
    await writeJsonlSession(tmpDir, "fork", [
      { type: "session", id: "root", title: "Explicit Active", timestamp: "2026-06-01T10:00:00Z" },
      { type: "message", id: "m1", message: { role: "user", content: "Root turn" } },
      { type: "message", id: "m2", parentId: "m1", message: { role: "assistant", content: "Main branch" }, parentSessionId: "parent-session", parentSessionFile: "parent.jsonl" },
      { type: "message", id: "m3", parentId: "m1", activeSessionId: "m2", message: { role: "assistant", content: "Side branch should ignore" } },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.turns.map((t) => t.content)).toEqual(["Root turn", "Main branch"]);
    expect(sessions[0]!.parentSessionId).toBe("parent-session");
    expect(sessions[0]!.parentSessionFile).toBe("parent.jsonl");
    expect(sessions[0]!.id).toBe("m2");
  });

  it("parses parentSession header path as parent session metadata", async () => {
    tmpDir = await makeTmpDir("pi-loader-jsonl-parent-session-");
    await writeJsonlSession(tmpDir, "child", [
      {
        type: "session",
        id: "child",
        title: "Child",
        timestamp: "2026-06-01T10:00:00Z",
        parentSession: "/tmp/2026-06-01T00-00-00Z_019f-parent.jsonl",
      },
      { type: "message", id: "m1", message: { role: "user", content: "Child turn" } },
    ]);

    const sessions = await loadSessions({ sessionsDir: tmpDir });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.parentSessionId).toBe("019f-parent");
    expect(sessions[0]!.parentSessionFile).toBe("/tmp/2026-06-01T00-00-00Z_019f-parent.jsonl");
  });
});

// ── extractFacts ──

describe("extractFacts", () => {
  function fakeSession(
    messages: Array<{ role: string; content: string }>,
  ): LoadedSession {
    return {
      id: "test-session",
      title: "Test",
      createdAt: "2026-06-01T00:00:00Z",
      filePath: "/tmp/test.json",
      modifiedAt: new Date(),
      turns: messages.map((m, i) => ({
        role: m.role,
        content: m.content,
        turnIndex: i,
      })),
    };
  }

  it("extracts capitalized names as entities", async () => {
    const session = fakeSession([
      { role: "user", content: "I met Alice Johnson yesterday at the office" },
    ]);
    const result = await extractFacts(session);
    const names = result.entities.map((e) => e.name);
    expect(names).toContain("Alice Johnson");
  });

  it("extracts known tools", async () => {
    const session = fakeSession([
      { role: "user", content: "We switched from Django to FastAPI for the backend" },
    ]);
    const result = await extractFacts(session);
    const names = result.entities.map((e) => e.name.toLowerCase());
    expect(names).toContain("django");
    expect(names).toContain("fastapi");
  });

  it("extracts uses relation", async () => {
    const session = fakeSession([
      { role: "user", content: "Acme uses React for their frontend" },
    ]);
    const result = await extractFacts(session);
    expect(result.relations.length).toBeGreaterThanOrEqual(1);
    const usesRel = result.relations.find((r) => r.relation === "uses");
    expect(usesRel).toBeDefined();
    expect(usesRel!.headName).toBe("Acme");
  });

  it("detects events from decision keywords", async () => {
    const session = fakeSession([
      { role: "assistant", content: "We decided to migrate the database to PostgreSQL" },
    ]);
    const result = await extractFacts(session);
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0]!.description).toContain("decided");
  });

  it("filters noise words from entities", async () => {
    const session = fakeSession([
      { role: "user", content: "the quick brown fox" },
    ]);
    const result = await extractFacts(session);
    const names = result.entities.map((e) => e.name.toLowerCase());
    expect(names).not.toContain("the");
    expect(names).not.toContain("it");
  });

  it("relation catalog matches Kocoro", () => {
    expect(RELATION_CATALOG.people_and_social).toContain("employed_at");
    expect(RELATION_CATALOG.technical_and_project).toContain("uses");
    expect(RELATION_CATALOG.ownership_and_company).toContain("created");
    expect(ALL_RELATIONS.length).toBeGreaterThan(50);
  });
});

// ── entityResolver ──

describe("entityResolver", () => {
  it("deduplicates entities by normalized name", () => {
    const entities = [
      {
        name: "Alice Johnson",
        type: "Person" as const,
        mentions: [{ sessionId: "s1", turnIndex: 0, snippet: "met Alice" }],
      },
      {
        name: "alice johnson",
        type: "Unknown" as const,
        mentions: [{ sessionId: "s2", turnIndex: 1, snippet: "Alice said" }],
      },
    ];

    const graph = resolveEntities(entities, []);
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]!.canonicalName).toBe("Alice Johnson");
    expect(graph.entities[0]!.mentions).toHaveLength(2);
    expect(graph.entities[0]!.type).toBe("Person");
  });

  it("assigns stable entity IDs", () => {
    const entities = [
      {
        name: "React",
        type: "Tool" as const,
        mentions: [{ sessionId: "s1", turnIndex: 0, snippet: "uses React" }],
      },
    ];

    const g1 = resolveEntities(entities, []);
    const g2 = resolveEntities(entities, []);
    expect(g1.entities[0]!.id).toBe(g2.entities[0]!.id);
    expect(g1.entities[0]!.id).toMatch(/^ent_[a-f0-9]{12}$/);
  });

  it("resolves relation entity references", () => {
    const entities = [
      { name: "Acme", type: "Company" as const, mentions: [{ sessionId: "s1", turnIndex: 0, snippet: "" }] },
      { name: "React", type: "Tool" as const, mentions: [{ sessionId: "s1", turnIndex: 0, snippet: "" }] },
    ];
    const relations = [
      { headName: "Acme", relation: "uses", tailName: "React", sessionId: "s1", turnIndex: 0, evidence: "Acme uses React" },
    ];

    const graph = resolveEntities(entities, relations);
    expect(graph.relations).toHaveLength(1);
    expect(graph.relations[0]!.headEntityId).toMatch(/^ent_/);
    expect(graph.relations[0]!.tailEntityId).toMatch(/^ent_/);
    expect(graph.relations[0]!.headEntityId).not.toBe(graph.relations[0]!.tailEntityId);
  });

  it("drops relations with unknown entities", () => {
    const entities = [
      { name: "Acme", type: "Company" as const, mentions: [{ sessionId: "s1", turnIndex: 0, snippet: "" }] },
    ];
    const relations = [
      { headName: "Acme", relation: "uses", tailName: "NonExistent", sessionId: "s1", turnIndex: 0, evidence: "" },
    ];

    const graph = resolveEntities(entities, relations);
    expect(graph.relations).toHaveLength(0);
  });
});

// ── bundleBuilder ──

describe("bundleBuilder", () => {
  let tmpDir: string;
  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("produces valid manifest with graph.json", async () => {
    tmpDir = await makeTmpDir("pi-bundle-");

    const graph = {
      entities: [
        {
          id: "ent_abc123def456",
          canonicalName: "React",
          type: "Tool" as const,
          aliases: [],
          mentions: [{ sessionId: "s1", turnIndex: 0, snippet: "uses React" }],
        },
      ],
      relations: [],
    };
    const events = [
      {
        description: "deployed the app",
        sessionId: "s1",
        timestamp: "2026-06-01T00:00:00Z",
        turnIndex: 2,
      },
    ];

    const result = await buildBundle(
      { graph, events },
      { outputDir: tmpDir },
    );

    expect(result.manifest.bundle_version).toBe("0.6.0");
    expect(result.manifest.files).toHaveLength(1);
    expect(result.manifest.files[0]!.path).toBe("graph.json");
    expect(result.manifest.files[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stats.entityCount).toBe(1);
    expect(result.stats.eventCount).toBe(1);

    const manifestRaw = await fs.readFile(
      path.join(result.bundleDir, "manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as BundleManifest;
    expect(manifest.bundle_ts).toBeTruthy();
    expect(manifest.files.length).toBeGreaterThan(0);

    const graphRaw = await fs.readFile(
      path.join(result.bundleDir, "graph.json"),
      "utf8",
    );
    const graphData = JSON.parse(graphRaw) as {
      entities: unknown[];
      edges: unknown[];
      events: unknown[];
    };
    expect(graphData.entities).toHaveLength(1);
    expect(graphData.events).toHaveLength(1);
  });
});

// ── marker ──

describe("marker", () => {
  let tmpDir: string;
  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads null when marker missing", async () => {
    tmpDir = await makeTmpDir("pi-marker-");
    const result = await readMarker(tmpDir);
    expect(result).toBeNull();
  });

  it("round-trips a timestamp", async () => {
    tmpDir = await makeTmpDir("pi-marker-");
    const ts = new Date("2026-06-15T12:30:00.000Z");
    await writeMarker(tmpDir, ts);
    const result = await readMarker(tmpDir);
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2026-06-15T12:30:00.000Z");
  });

  it("handles invalid marker content", async () => {
    tmpDir = await makeTmpDir("pi-marker-bad-");
    await fs.writeFile(path.join(tmpDir, ".train_marker"), "not-a-date\n", "utf8");
    const result = await readMarker(tmpDir);
    expect(result).toBeNull();
  });
});

// ── trainBundle e2e ──

describe("trainBundle", () => {
  let tmpDir: string;
  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("full pipeline: load → extract → resolve → build → install", async () => {
    tmpDir = await makeTmpDir("pi-train-e2e-");
    const sessionsDir = path.join(tmpDir, "sessions");
    const bundleRoot = path.join(tmpDir, "memory");
    await fs.mkdir(sessionsDir, { recursive: true });

    await writeSession(sessionsDir, "s1", [
      { role: "user", content: "Alice Johnson created the Nexus project using React" },
      { role: "assistant", content: "We decided to deploy on Vercel" },
    ], { created_at: "2026-06-01T00:00:00Z" });

    await writeSession(sessionsDir, "s2", [
      { role: "user", content: "Bob Smith works at Acme Corp and collaborates with Alice Johnson" },
    ], { created_at: "2026-06-02T00:00:00Z" });

    const result = await trainBundle({
      sessionsDir,
      bundleRoot,
      full: true,
    });

    expect(result.sessionsProcessed).toBe(2);
    expect(result.entityCount).toBeGreaterThan(0);
    expect(result.dryRun).toBe(false);
    expect(result.installResult).toBeDefined();
    expect(result.installResult!.bundle_version).toBe("0.6.0");

    // Verify current symlink works
    const currentManifest = await fs.readFile(
      path.join(bundleRoot, "current", "manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(currentManifest) as BundleManifest;
    expect(manifest.bundle_version).toBe("0.6.0");

    // Verify marker was written
    const marker = await readMarker(bundleRoot);
    expect(marker).toBeInstanceOf(Date);
  });

  it("dry-run does not write files", async () => {
    tmpDir = await makeTmpDir("pi-train-dry-");
    const sessionsDir = path.join(tmpDir, "sessions");
    const bundleRoot = path.join(tmpDir, "memory");
    await fs.mkdir(sessionsDir, { recursive: true });

    await writeSession(sessionsDir, "s1", [
      { role: "user", content: "Alice Johnson uses TypeScript" },
    ]);

    const result = await trainBundle({
      sessionsDir,
      bundleRoot,
      full: true,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.sessionsProcessed).toBe(1);
    expect(result.entityCount).toBeGreaterThan(0);
    expect(result.bundleResult).toBeUndefined();

    // No bundle dir should exist
    await expect(fs.access(path.join(bundleRoot, "current"))).rejects.toThrow();
  });

  it("returns zero when no sessions", async () => {
    tmpDir = await makeTmpDir("pi-train-empty-");
    const sessionsDir = path.join(tmpDir, "sessions");
    const bundleRoot = path.join(tmpDir, "memory");
    await fs.mkdir(sessionsDir, { recursive: true });

    const result = await trainBundle({ sessionsDir, bundleRoot, full: true });
    expect(result.sessionsProcessed).toBe(0);
  });

  it("incremental mode skips already-trained sessions", async () => {
    tmpDir = await makeTmpDir("pi-train-incr-");
    const sessionsDir = path.join(tmpDir, "sessions");
    const bundleRoot = path.join(tmpDir, "memory");
    await fs.mkdir(sessionsDir, { recursive: true });

    await writeSession(sessionsDir, "s1", [
      { role: "user", content: "Alice Johnson uses React" },
    ]);

    // First train
    const r1 = await trainBundle({ sessionsDir, bundleRoot, full: true });
    expect(r1.sessionsProcessed).toBe(1);

    // Second train without new sessions — marker skips s1
    const r2 = await trainBundle({ sessionsDir, bundleRoot });
    expect(r2.sessionsProcessed).toBe(0);

    // Add new session and train again
    await new Promise((r) => setTimeout(r, 50));
    await writeSession(sessionsDir, "s2", [
      { role: "user", content: "Bob Smith works on Pulsar" },
    ]);

    const r3 = await trainBundle({ sessionsDir, bundleRoot });
    expect(r3.sessionsProcessed).toBe(1);
  });
});
