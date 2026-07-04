import { postJson } from "../http.js";
import { assertEmbeddingDim, normalizeEmbedding } from "./normalize.js";
import type { Embedder } from "./types.js";

type OllamaEmbedResponse = {
  model: string;
  embeddings: number[][];
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function createOllamaEmbedder(opts: {
  baseUrl: string;
  model: string;
  dim: number;
  timeoutMs: number;
}): Embedder {
  const url = joinUrl(opts.baseUrl, "/api/embed");

  const embedRemote = async (texts: string[]): Promise<Float32Array[]> => {
    const json = await postJson<OllamaEmbedResponse>(
      url,
      { model: opts.model, input: texts.length === 1 ? texts[0] : texts },
      { timeoutMs: opts.timeoutMs },
    );

    return json.embeddings.map((row, index) => {
      const embedding = normalizeEmbedding(new Float32Array(row));
      assertEmbeddingDim(embedding, opts.dim, `Ollama ${opts.model} row ${index}`);
      return embedding;
    });
  };

  return {
    provider: "ollama",
    model: opts.model,
    dim: opts.dim,
    async embed(text) {
      const [embedding] = await embedRemote([text]);
      return embedding!;
    },
    async embedBatch(texts) {
      if (texts.length === 0) return [];
      return embedRemote(texts);
    },
  };
}
