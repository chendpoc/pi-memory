import type { EmbedderProvider } from "../../config/env.js";

export type Embedder = {
  provider: EmbedderProvider;
  model: string;
  dim: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
};
