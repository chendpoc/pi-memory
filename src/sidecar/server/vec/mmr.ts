import { MMR_LAMBDA } from "../../../constants/retrieval.js";

export type ScoredCandidate = {
  chunkId: string;
  content: string;
  source: string;
  timestamp: string;
  distance: number;
  embedding: Float32Array;
};

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** MMR re-ranking: λ defaults from retrieval config (see constants/retrieval.ts). */
export function mmrSelect(
  queryEmbedding: Float32Array,
  candidates: ScoredCandidate[],
  limit: number,
  lambda = MMR_LAMBDA,
): ScoredCandidate[] {
  if (candidates.length === 0) return [];

  const selected: ScoredCandidate[] = [];
  const remaining = [...candidates];

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const relevance = cosineSimilarity(queryEmbedding, candidate.embedding);
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((s) => cosineSimilarity(candidate.embedding, s.embedding)));
      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]!);
  }

  return selected;
}

export function distanceToRelevance(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}
