import type { Embedder } from "../../../adapters/embed/types.js";

type VecDatabase = import("better-sqlite3").Database;

export type StoredEmbeddingMeta = {
  model: string;
  provider: string;
  dim: number;
};

export type ReindexOutcome = {
  indexed: number;
  indexGeneration: number;
};

export function initVecSchema(db: VecDatabase): void {
  db.exec(`
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

export function getStoredEmbeddingMeta(db: VecDatabase): StoredEmbeddingMeta | null {
  const read = (key: string): string | undefined =>
    db.prepare("SELECT value FROM meta WHERE key = ?").pluck().get(key) as string | undefined;

  const model = read("embedding_model");
  const provider = read("embedding_provider");
  const dimRaw = read("embedding_dim");
  if (!model || !provider || !dimRaw) return null;

  const dim = Number.parseInt(dimRaw, 10);
  if (!Number.isFinite(dim)) return null;
  return { model, provider, dim };
}

export function embeddingMetaMatches(db: VecDatabase, embedder: Embedder): boolean {
  const stored = getStoredEmbeddingMeta(db);
  if (!stored) return true;
  return (
    stored.model === embedder.model &&
    stored.provider === embedder.provider &&
    stored.dim === embedder.dim
  );
}

export function getIndexGeneration(db: VecDatabase): number {
  const raw = db.prepare("SELECT value FROM meta WHERE key = 'index_generation'").pluck().get();
  return Number(raw ?? "0");
}

export function getChunkCount(db: VecDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM memory_chunks").get() as { count: number };
  return row.count;
}

export function clearChunksIfEmbeddingMismatch(db: VecDatabase, embedder: Embedder): void {
  if (embeddingMetaMatches(db, embedder)) return;
  db.prepare("DELETE FROM memory_chunks").run();
}

export function bumpIndexGeneration(db: VecDatabase): number {
  const generation = getIndexGeneration(db) + 1;
  db
    .prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run("index_generation", String(generation));
  return generation;
}

export function writeEmbeddingMeta(db: VecDatabase, embedder: Embedder): void {
  const upsert = db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  upsert.run("embedding_model", embedder.model);
  upsert.run("embedding_provider", embedder.provider);
  upsert.run("embedding_dim", String(embedder.dim));
}
