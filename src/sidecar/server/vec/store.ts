import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Embedder } from "../../../adapters/embed/types.js";
import type { IndexDocument, MemoryEntry } from "../../protocol.js";
import { CANDIDATE_POOL_MULTIPLIER, DEFAULT_TOP_K } from "./constants.js";
import { getEmbedder } from "./embedder.js";
import { cosineSimilarity, distanceToRelevance, mmrSelect, type ScoredCandidate } from "./mmr.js";

const require = createRequire(import.meta.url);

type ChunkRow = {
  chunk_id: string;
  content: string;
  source: string;
  timestamp: string;
  embedding: Buffer;
};

export type StoredEmbeddingMeta = {
  model: string;
  provider: string;
  dim: number;
};

export type ReindexOutcome = {
  indexed: number;
  indexGeneration: number;
};

function embeddingToBlob(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

function blobToEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

export class VecStore {
  private db: import("better-sqlite3").Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_chunks (
        chunk_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
    `);
  }

  getStoredEmbeddingMeta(): StoredEmbeddingMeta | null {
    const read = (key: string): string | undefined =>
      this.db.prepare("SELECT value FROM meta WHERE key = ?").pluck().get(key) as string | undefined;

    const model = read("embedding_model");
    const provider = read("embedding_provider");
    const dimRaw = read("embedding_dim");
    if (!model || !provider || !dimRaw) return null;

    const dim = Number.parseInt(dimRaw, 10);
    if (!Number.isFinite(dim)) return null;
    return { model, provider, dim };
  }

  embeddingMetaMatches(embedder: Embedder): boolean {
    const stored = this.getStoredEmbeddingMeta();
    if (!stored) return true;
    return (
      stored.model === embedder.model &&
      stored.provider === embedder.provider &&
      stored.dim === embedder.dim
    );
  }

  getIndexGeneration(): number {
    const raw = this.db.prepare("SELECT value FROM meta WHERE key = 'index_generation'").pluck().get();
    return Number(raw ?? "0");
  }

  private clearChunksIfEmbeddingMismatch(embedder: Embedder): void {
    if (this.embeddingMetaMatches(embedder)) return;
    this.db.prepare("DELETE FROM memory_chunks").run();
  }

  private bumpIndexGeneration(): number {
    const generation = this.getIndexGeneration() + 1;
    this.db
      .prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("index_generation", String(generation));
    return generation;
  }

  private writeEmbeddingMeta(embedder: Embedder): void {
    const upsert = this.db.prepare(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    upsert.run("embedding_model", embedder.model);
    upsert.run("embedding_provider", embedder.provider);
    upsert.run("embedding_dim", String(embedder.dim));
  }

  async reindex(documents: IndexDocument[]): Promise<ReindexOutcome> {
    const embedder = getEmbedder();
    this.clearChunksIfEmbeddingMismatch(embedder);

    if (documents.length === 0) {
      const indexGeneration = this.getIndexGeneration();
      this.writeEmbeddingMeta(embedder);
      return { indexed: 0, indexGeneration };
    }

    const embeddings = await embedder.embedBatch(documents.map((doc) => doc.content));

    const sync = this.db.transaction((docs: IndexDocument[], vectors: Float32Array[]) => {
      const incomingIds = new Set(docs.map((doc) => doc.id));
      const existing = this.db.prepare("SELECT chunk_id FROM memory_chunks").all() as Array<{ chunk_id: string }>;

      const deleteChunk = this.db.prepare("DELETE FROM memory_chunks WHERE chunk_id = ?");
      for (const row of existing) {
        if (!incomingIds.has(row.chunk_id)) {
          deleteChunk.run(row.chunk_id);
        }
      }

      const upsert = this.db.prepare(`
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

      const indexGeneration = this.bumpIndexGeneration();
      this.writeEmbeddingMeta(embedder);
      return { indexed: docs.length, indexGeneration };
    });

    return sync(documents, embeddings);
  }

  async query(queryText: string, topK = DEFAULT_TOP_K): Promise<MemoryEntry[]> {
    const embedder = getEmbedder();
    this.clearChunksIfEmbeddingMismatch(embedder);

    const queryEmbedding = await embedder.embed(queryText);
    const poolSize = topK * CANDIDATE_POOL_MULTIPLIER;

    const rows = this.db
      .prepare("SELECT chunk_id, content, source, timestamp, embedding FROM memory_chunks")
      .all() as ChunkRow[];

    if (rows.length === 0) return [];

    const candidates: ScoredCandidate[] = [];
    for (const row of rows) {
      const embedding = blobToEmbedding(row.embedding);
      if (embedding.length !== queryEmbedding.length) continue;
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      candidates.push({
        chunkId: row.chunk_id,
        content: row.content,
        source: row.source,
        timestamp: row.timestamp,
        distance: 1 - similarity,
        embedding,
      });
    }

    candidates.sort((a, b) => a.distance - b.distance);
    const pool = candidates.slice(0, poolSize);
    const selected = mmrSelect(queryEmbedding, pool, topK);

    return selected.map((item) => ({
      content: item.content,
      source: item.source,
      timestamp: item.timestamp,
      relevance: distanceToRelevance(item.distance),
    }));
  }

  close(): void {
    this.db.close();
  }
}

const stores = new Map<string, VecStore>();

export function getVecStore(dbPath: string): VecStore {
  let store = stores.get(dbPath);
  if (!store) {
    store = new VecStore(dbPath);
    stores.set(dbPath, store);
  }
  return store;
}

/** @internal test hook */
export function resetVecStoreForTests(): void {
  for (const store of stores.values()) store.close();
  stores.clear();
}
