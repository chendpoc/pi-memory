import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runPhase2 } from "../../src/consolidation/phase2/runPhase2.js";
import { drainQueue } from "../../src/consolidation/stage1/drainQueue.js";
import { openConsolidationStore } from "../../src/consolidation/stage1/store.js";

async function makeTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeJsonl(filePath: string, text: string): Promise<void> {
  await fs.writeFile(
    filePath,
    [
      JSON.stringify({ type: "session", id: path.basename(filePath, ".jsonl"), timestamp: "2026-07-02T00:00:00Z" }),
      JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: text } }),
      JSON.stringify({ type: "message", id: "m2", parentId: "m1", message: { role: "assistant", content: "ok" } }),
    ].join("\n"),
    "utf8",
  );
}

describe("consolidation flow", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("drains parent before clone child and skips child with no delta", async () => {
    tmpDir = await makeTmpDir("pi-consolidation-flow-");
    const parent = path.join(tmpDir, "parent.jsonl");
    const child = path.join(tmpDir, "child.jsonl");
    await writeJsonl(parent, "remember default language is Chinese");
    await writeJsonl(child, "remember default language is Chinese");

    const store = openConsolidationStore(":memory:")!;
    const now = "2026-07-02T01:00:00.000Z";
    store.upsertPendingSession({
      session_id: "child",
      session_file: child,
      cwd: tmpDir,
      git_root: tmpDir,
      project_hash: "aaaaaaaaaaaa",
      parent_session_id: "parent",
      parent_session_file: parent,
      user_turn_count: 3,
      ended_at: now,
      status: "pending",
      error_message: null,
      created_at: now,
      updated_at: now,
    });
    store.upsertPendingSession({
      session_id: "parent",
      session_file: parent,
      cwd: tmpDir,
      git_root: tmpDir,
      project_hash: "aaaaaaaaaaaa",
      parent_session_id: null,
      parent_session_file: null,
      user_turn_count: 3,
      ended_at: now,
      status: "pending",
      error_message: null,
      created_at: now,
      updated_at: now,
    });

    const report = await drainQueue(store, { now });
    expect(report.sessionsProcessed).toBe(1);
    expect(report.sessionsSkipped).toBe(1);
    expect(store.getPendingSession("parent")?.status).toBe("done");
    expect(store.getPendingSession("child")?.status).toBe("skipped");
    expect(store.getStage1Output("parent")?.raw_memory).toContain("remember default language");
    expect(store.getStage1Output("child")).toBeNull();
    store.close();
  });

  it("phase2 writes project-scoped memory to project directory and marks rows selected", async () => {
    tmpDir = await makeTmpDir("pi-phase2-project-");
    const store = openConsolidationStore(":memory:")!;
    store.upsertStage1Output({
      session_id: "s1",
      session_file: path.join(tmpDir, "s1.jsonl"),
      source_mtime_ms: 1,
      generated_at: "2026-07-02T02:00:00.000Z",
      raw_memory: "- Prefer concise Chinese replies",
      rollout_summary: "summary",
      scope: "project:aaaaaaaaaaaa",
      status: "done",
      selected_for_phase2: false,
      usage_count: 0,
      last_usage: "2026-07-02T02:00:00.000Z",
      error_message: null,
    });

    const report = await runPhase2(store, {
      memoryMdPath: path.join(tmpDir, "MEMORY.md"),
      bundleRoot: tmpDir,
      topN: 10,
    });

    const projectMemory = path.join(tmpDir, "projects", "aaaaaaaaaaaa", "MEMORY.md");
    expect(report.appended).toBe(1);
    await expect(fs.readFile(projectMemory, "utf8")).resolves.toContain("Prefer concise Chinese replies");
    expect(store.getStage1Output("s1")?.selected_for_phase2).toBe(true);
    store.close();
  });
});
