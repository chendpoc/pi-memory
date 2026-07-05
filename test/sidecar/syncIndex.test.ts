import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSidecarQueryCacheForTests, sidecarQueryCache } from "../../src/sidecar/queryCache.js";
import { syncSidecarIndex } from "../../src/sidecar/syncIndex.js";

const mockEnsureSidecarRunning = vi.fn();
const mockReindex = vi.fn();
const mockResolveSidecarPaths = vi.fn();
const mockExportForIndex = vi.fn();

vi.mock("../../src/sidecar/sidecarManager.js", () => ({
  ensureSidecarRunning: (...args: unknown[]) => mockEnsureSidecarRunning(...args),
}));

vi.mock("../../src/sidecar/client.js", () => ({
  reindex: (...args: unknown[]) => mockReindex(...args),
}));

vi.mock("../../src/sidecar/paths.js", () => ({
  resolveSidecarPaths: (...args: unknown[]) => mockResolveSidecarPaths(...args),
}));

describe("syncSidecarIndex", () => {
  beforeEach(() => {
    resetSidecarQueryCacheForTests();
    mockEnsureSidecarRunning.mockReset();
    mockReindex.mockReset();
    mockResolveSidecarPaths.mockReset();
    mockExportForIndex.mockReset();

    mockResolveSidecarPaths.mockReturnValue({ socketPath: "/tmp/sidecar.sock" });
    mockExportForIndex.mockResolvedValue([{ id: "1", content: "fact", section: "Findings" }]);
    mockEnsureSidecarRunning.mockResolvedValue(undefined);
    mockReindex.mockResolvedValue({ index_generation: 7 });
  });

  it("reindexes and bumps query cache generation", async () => {
    sidecarQueryCache.set("/agent", "Vitest", [
      {
        content: "stale",
        relevance: 0.5,
        source: "MEMORY.md",
        timestamp: "2026-07-04T00:00:00.000Z",
      },
    ]);

    const store = { exportForIndex: mockExportForIndex } as never;
    const generation = await syncSidecarIndex("/agent", store);

    expect(generation).toBe(7);
    expect(mockEnsureSidecarRunning).toHaveBeenCalledWith({ socketPath: "/tmp/sidecar.sock" });
    expect(mockReindex).toHaveBeenCalledWith("/tmp/sidecar.sock", [
      { id: "1", content: "fact", section: "Findings" },
    ]);
    expect(sidecarQueryCache.get("/agent", "Vitest")).toBeNull();
    expect(sidecarQueryCache.getGeneration("/agent")).toBe(7);
  });
});
