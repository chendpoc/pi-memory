import type { IndexDocument } from "../../protocol.js";
import { getEmbedder } from "./embedder.js";
import { embeddingToBlob } from "./embeddingCodec.js";
import {
  bumpIndexGeneration,
  clearChunksIfEmbeddingMismatch,
  getIndexGeneration,
  type ReindexOutcome,
  writeEmbeddingMeta,
} from "./schema.js";

type VecDatabase = import("better-sqlite3").Database;

export async function reindexChunks(
  db: VecDatabase,
  documents: IndexDocument[],
): Promise<ReindexOutcome> {
  const embedder = getEmbedder();
  clearChunksIfEmbeddingMismatch(db, embedder);

  if (documents.length === 0) {
    const indexGeneration = getIndexGeneration(db);
    writeEmbeddingMeta(db, embedder);
    return { indexed: 0, indexGeneration };
  }

  const embeddings = await embedder.embedBatch(documents.map((doc) => doc.content));

  const sync = db.transaction((docs: IndexDocument[], vectors: Float32Array[]) => {
    const incomingIds = new Set(docs.map((doc) => doc.id));
    const existing = db.prepare("SELECT chunk_id FROM memory_chunks").all() as Array<{ chunk_id: string }>;

    const deleteChunk = db.prepare("DELETE FROM memory_chunks WHERE chunk_id = ?");
    for (const row of existing) {
      if (!incomingIds.has(row.chunk_id)) {
        deleteChunk.run(row.chunk_id);
      }
    }

    const upsert = db.prepare(`
      INSERT INTO memory_chunks(chunk_id, content, source, timestamp, embedding)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        content = excluded.content,
        source = excluded.source,
        timestamp = excluded.timestamp,
        embedding = excluded.embedding
    `);

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]!;
      upsert.run(doc.id, doc.content, doc.source, doc.timestamp, embeddingToBlob(vectors[i]!));
    }

    const indexGeneration = bumpIndexGeneration(db);
    writeEmbeddingMeta(db, embedder);
    return { indexed: docs.length, indexGeneration };
  });

  return sync(documents, embeddings);
}
