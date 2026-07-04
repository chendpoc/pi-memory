import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseJsonlLine } from "../src/ipc/jsonlFramer.js";
import {
  enqueueShutdownMetadata,
  shutdownQueuePath,
  type ShutdownQueueEntry,
} from "../src/shutdown/enqueue.js";

describe("shutdown queue", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends JSONL metadata entries", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-shutdown-"));
    const entry: ShutdownQueueEntry = {
      sessionFile: "/tmp/child.jsonl",
      parentSession: "/tmp/parent.jsonl",
      reason: "quit",
      isSubagent: true,
      enqueuedAt: "2026-07-04T12:00:00.000Z",
    };

    await enqueueShutdownMetadata(tmpDir, entry);
    const raw = await readFile(shutdownQueuePath(tmpDir), "utf8");
    const line = raw.trim().split("\n").at(-1)!;
    expect(parseJsonlLine<ShutdownQueueEntry>(line)).toEqual(entry);
  });
});
