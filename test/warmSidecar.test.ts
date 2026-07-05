import { beforeEach, describe, expect, it, vi } from "vitest";

import { warmSidecar } from "../src/sidecar/warmup.js";

const mockPing = vi.fn();
const mockFetchIndexStats = vi.fn();
const mockQuery = vi.fn();

vi.mock("../src/sidecar/client.js", () => ({
  ping: (...args: unknown[]) => mockPing(...args),
  fetchIndexStats: (...args: unknown[]) => mockFetchIndexStats(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}));

describe("warmSidecar", () => {
  beforeEach(() => {
    mockPing.mockReset();
    mockFetchIndexStats.mockReset();
    mockQuery.mockReset();
  });

  it("does not throw when sidecar is unreachable", async () => {
    mockPing.mockResolvedValue(false);
    await expect(warmSidecar("/tmp/missing.sock")).resolves.toBeUndefined();
    expect(mockFetchIndexStats).not.toHaveBeenCalled();
  });

  it("opens stats and skips query when index is empty", async () => {
    mockPing.mockResolvedValue(true);
    mockFetchIndexStats.mockResolvedValue({
      stats: { chunk_count: 0, index_generation: 0, embedder_provider: "hash", embedder_model: "hash/dev", embed_dim: 768 },
    });

    await warmSidecar("/tmp/sidecar.sock");

    expect(mockFetchIndexStats).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("runs a smoke query when chunks exist", async () => {
    mockPing.mockResolvedValue(true);
    mockFetchIndexStats.mockResolvedValue({
      stats: { chunk_count: 3, index_generation: 1, embedder_provider: "hash", embedder_model: "hash/dev", embed_dim: 768 },
    });
    mockQuery.mockResolvedValue({ type: "result", request_id: "warm", results: [] });

    await warmSidecar("/tmp/sidecar.sock");

    expect(mockQuery).toHaveBeenCalledWith("/tmp/sidecar.sock", ".", { timeoutMs: 500 });
  });
});
