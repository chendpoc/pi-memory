import { createHash } from "node:crypto";

import type { Embedder } from "./types.js";
import { normalizeEmbedding } from "./normalize.js";

export function createHashEmbedder(dim: number): Embedder {
  const embedSync = (text: string): Float32Array => {
    const vec = new Float32Array(dim);
    const digest = createHash("sha256").update(text).digest();
    for (let i = 0; i < dim; i++) {
      const byte = digest[i % digest.length]!;
      const sign = digest[(i + 7) % digest.length]! & 1 ? 1 : -1;
      vec[i] = sign * (byte / 255);
    }
    return normalizeEmbedding(vec);
  };

  return {
    provider: "hash",
    model: "hash/dev",
    dim,
    async embed(text) {
      return embedSync(text);
    },
    async embedBatch(texts) {
      return texts.map(embedSync);
    },
  };
}
