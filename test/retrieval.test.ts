import { afterEach, describe, expect, it, vi } from "vitest";

import { readRetrievalConfig } from "../src/config/retrieval.js";

describe("readRetrievalConfig", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllEnvs();
  });

  it("uses episodic-memory defaults", () => {
    delete process.env.PI_MEMORY_TOP_K;
    delete process.env.PI_MEMORY_MMR_LAMBDA;
    delete process.env.PI_MEMORY_MIN_RELEVANCE;

    expect(readRetrievalConfig()).toEqual({
      topK: 3,
      mmrLambda: 0.8,
      minRelevance: 0.4,
      candidatePoolMultiplier: 3,
    });
  });

  it("reads overrides from env", () => {
    vi.stubEnv("PI_MEMORY_TOP_K", "5");
    vi.stubEnv("PI_MEMORY_MMR_LAMBDA", "0.65");
    vi.stubEnv("PI_MEMORY_MIN_RELEVANCE", "0.55");

    expect(readRetrievalConfig()).toEqual({
      topK: 5,
      mmrLambda: 0.65,
      minRelevance: 0.55,
      candidatePoolMultiplier: 3,
    });
  });

  it("clamps invalid values", () => {
    vi.stubEnv("PI_MEMORY_TOP_K", "999");
    vi.stubEnv("PI_MEMORY_MMR_LAMBDA", "2");
    vi.stubEnv("PI_MEMORY_MIN_RELEVANCE", "-1");

    expect(readRetrievalConfig()).toMatchObject({
      topK: 20,
      mmrLambda: 1,
      minRelevance: 0,
    });
  });
});
