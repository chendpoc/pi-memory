import { describe, expect, it } from "vitest";

import { CHUNKING_DISABLED_MAX_CHARS } from "../src/constants/chunking.js";
import { buildIndexDocuments, splitTextByMaxChars } from "../src/store/indexChunks.js";
import type { ParsedEntry } from "../src/store/types.js";

function entry(overrides: Partial<ParsedEntry> & Pick<ParsedEntry, "id" | "content">): ParsedEntry {
  return {
    section: "Findings",
    timestamp: "2026-07-04T00:00:00.000Z",
    sourceFile: "/tmp/MEMORY.md",
    line: 1,
    ...overrides,
  };
}

describe("splitTextByMaxChars", () => {
  it("returns a single part when under the limit", () => {
    expect(splitTextByMaxChars("short note", 512)).toEqual(["short note"]);
  });

  it("splits on paragraph boundaries", () => {
    const text = "alpha paragraph.\n\nbeta paragraph that continues.";
    const parts = splitTextByMaxChars(text, 20);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toContain("alpha paragraph");
    expect(parts.join(" ")).toContain("beta paragraph");
  });
});

describe("buildIndexDocuments", () => {
  it("prefixes section and keeps one chunk for short entries", () => {
    const docs = buildIndexDocuments(
      [entry({ id: "f-1", content: "Uses Vitest", section: "Findings" })],
      { maxChars: 512 },
    );

    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe("f-1");
    expect(docs[0]?.content).toBe("[Findings] Uses Vitest");
  });

  it("splits long entries into stable chunk ids", () => {
    const long = "A".repeat(300) + ". " + "B".repeat(300);
    const docs = buildIndexDocuments([entry({ id: "f-long", content: long })], { maxChars: 512 });

    expect(docs.length).toBeGreaterThan(1);
    expect(docs[0]?.id).toBe("f-long#0");
    expect(docs[1]?.id).toBe("f-long#1");
    expect(docs.every((doc) => doc.content.startsWith("[Findings]"))).toBe(true);
  });

  it("can disable splitting while keeping section prefix", () => {
    const long = "C".repeat(900);
    const docs = buildIndexDocuments([entry({ id: "f-2", content: long })], {
      maxChars: CHUNKING_DISABLED_MAX_CHARS,
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe("f-2");
    expect(docs[0]?.content).toBe(`[Findings] ${long}`);
  });
});
