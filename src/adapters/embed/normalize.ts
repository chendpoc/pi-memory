export function normalizeEmbedding(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
  return vec;
}

export function assertEmbeddingDim(embedding: Float32Array, expectedDim: number, label: string): void {
  if (embedding.length !== expectedDim) {
    throw new Error(`${label} dimension mismatch: expected ${expectedDim}, got ${embedding.length}`);
  }
}
