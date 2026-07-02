import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  memoryIndexSnippet,
  readMemoryIndexCap,
} from "../../src/consolidation/memoryIndex.js";
import { parseScopeComment } from "../../src/consolidation/scope.js";

async function makeTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("memoryIndex", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  });

  it("caps MEMORY.md by lines and bytes", async () => {
    tmpDir = await makeTmpDir("pi-memory-index-");
    const memPath = path.join(tmpDir, "MEMORY.md");
    await fs.writeFile(memPath, "- one\n- two\n- three\n", "utf8");

    expect(readMemoryIndexCap([memPath], { maxLines: 2 })).toBe("- one\n- two");
    expect(readMemoryIndexCap([memPath], { maxBytes: 8 })).toBe("- one");
  });

  it("filters scoped lines when scopes are provided", async () => {
    tmpDir = await makeTmpDir("pi-memory-index-scope-");
    const memPath = path.join(tmpDir, "MEMORY.md");
    await fs.writeFile(
      memPath,
      [
        "- global note <!-- scope:global -->",
        "- matching project <!-- scope:project:aaaaaaaaaaaa -->",
        "- other project <!-- scope:project:bbbbbbbbbbbb -->",
        "- legacy unscoped note",
      ].join("\n"),
      "utf8",
    );

    const cap = readMemoryIndexCap([memPath], {
      scopes: ["global", "project:aaaaaaaaaaaa"],
    });
    expect(cap).toContain("global note");
    expect(cap).toContain("matching project");
    expect(cap).toContain("legacy unscoped note");
    expect(cap).not.toContain("other project");
  });

  it("greps scoped MEMORY.md snippets", async () => {
    tmpDir = await makeTmpDir("pi-memory-index-grep-");
    const memPath = path.join(tmpDir, "MEMORY.md");
    await fs.writeFile(
      memPath,
      [
        "- pi-memory uses Ollama <!-- scope:project:aaaaaaaaaaaa -->",
        "- pi-memory old note <!-- scope:project:bbbbbbbbbbbb -->",
      ].join("\n"),
      "utf8",
    );

    const snip = await memoryIndexSnippet([memPath], "pi-memory", {
      scopes: ["global", "project:aaaaaaaaaaaa"],
    });
    expect(snip).toContain("uses Ollama");
    expect(snip).not.toContain("old note");
  });

  it("parses scope comments", () => {
    expect(parseScopeComment("- note <!-- scope:global -->")).toBe("global");
    expect(parseScopeComment("- note <!-- scope:project:abcdef123456 -->")).toBe(
      "project:abcdef123456",
    );
    expect(parseScopeComment("- note")).toBeNull();
  });
});
