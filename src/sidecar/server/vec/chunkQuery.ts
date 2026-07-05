import type { MemoryEntry } from "../../protocol.js";
import { readRetrievalConfig } from "../../../config/retrieval.js";
import { blobToEmbedding } from "./embeddingCodec.js";
import { getEmbedder } from "./embedder.js";
import { cosineSimilarity, distanceToRelevance, mmrSelect, type ScoredCandidate } from "./mmr.js";
import { clearChunksIfEmbeddingMismatch } from "./schema.js";

type VecDatabase = import("better-sqlite3").Database;

type ChunkRow = {
  chunk_id: string;
  content: string;
  source: string;
  timestamp: string;
  embedding: Buffer;
};

export async function queryChunks(
  db: VecDatabase,
  queryText: string,
  topK?: number,
): Promise<MemoryEntry[]> {
  const retrieval = readRetrievalConfig();
  const limit = topK ?? retrieval.topK;
  const embedder = getEmbedder();
  clearChunksIfEmbeddingMismatch(db, embedder);

  const queryEmbedding = await embedder.embed(queryText);

  const rows = db
    .prepare("SELECT chunk_id, content, source, timestamp, embedding FROM memory_chunks")
    .all() as ChunkRow[];

  if (rows.length === 0) return [];

  const candidates: ScoredCandidate[] = [];
  for (const row of rows) {
    const embedding = blobToEmbedding(row.embedding);
    if (embedding.length !== queryEmbedding.length) continue;
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    if (similarity < retrieval.minRelevance) continue;
    candidates.push({
      chunkId: row.chunk_id,
      content: row.content,
      source: row.source,
      timestamp: row.timestamp,
      distance: 1 - similarity,
      embedding,
    });
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.distance - b.distance);
  const poolSize = Math.min(limit * retrieval.candidatePoolMultiplier, candidates.length);
  const pool = candidates.slice(0, poolSize);
  const selected = mmrSelect(queryEmbedding, pool, limit, retrieval.mmrLambda);

  return selected.map((item) => ({
    content: item.content,
    source: item.source,
    timestamp: item.timestamp,
    relevance: distanceToRelevance(item.distance),
  }));
}
