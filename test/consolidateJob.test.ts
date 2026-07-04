import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LlmClient } from "../src/adapters/llm/types.js";
import { runConsolidateJob } from "../src/consolidate/runJob.js";
import { createMemoryStore } from "../src/store/index.js";

const noopLlm: LlmClient = {
  async complete() {
    throw new Error("LLM skipped in test");
  },
};

describe("runConsolidateJob", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips when conditions are not met", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-job-skip-"));
    const store = createMemoryStore({ agentDir: tmpDir });
    await store.ensureInitialized();

    const result = await runConsolidateJob({
      store,
      agentDir: tmpDir,
      llm: noopLlm,
      reindex: false,
    });

    expect(result).toEqual({ status: "skipped", reason: "conditions_not_met" });
  });

  it("consolidates with --force", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-job-force-"));
    const store = createMemoryStore({ agentDir: tmpDir });
    await store.ensureInitialized();

    await store.append({
      id: "a",
      section: "Findings",
      content: "alpha",
      timestamp: "2026-07-04T00:00:00.000Z",
    });

    const result = await runConsolidateJob({
      store,
      agentDir: tmpDir,
      llm: noopLlm,
      force: true,
      reindex: false,
    });

    expect(result.status).toBe("consolidated");
    if (result.status === "consolidated") {
      expect(result.stats.entriesAfter).toBeGreaterThanOrEqual(1);
      expect(result.stats.overflowAfter).toBe(0);
    }
    expect((await store.getStats()).lastConsolidatedAt).toBeTruthy();
  });
});
