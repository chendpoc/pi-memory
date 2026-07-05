import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initializeMemoryWorkspace } from "../src/store/initWorkspace.js";
import { defaultMemoryTemplate } from "../src/store/markdown/template.js";

describe("initializeMemoryWorkspace", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates MEMORY.md from template when missing", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-init-"));
    const result = await initializeMemoryWorkspace(tmpDir);

    expect(result.created).toBe(true);
    expect(result.skipped).toBe(false);
    expect(readFileSync(result.memoryFile, "utf8")).toBe(defaultMemoryTemplate());
  });

  it("skips when MEMORY.md already has content", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-init-"));
    const first = await initializeMemoryWorkspace(tmpDir);
    const second = await initializeMemoryWorkspace(tmpDir);

    expect(first.created).toBe(true);
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe("already_initialized");
  });
});
