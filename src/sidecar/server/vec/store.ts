import { createRequire } from "node:module";

import type { Embedder } from "../../../adapters/embed/types.js";
import type { IndexDocument, MemoryEntry } from "../../protocol.js";
import { ensureDirSync, pathDirname } from "../../../utils/fs.js";
import { queryChunks } from "./chunkQuery.js";
import { reindexChunks } from "./chunkReindex.js";
import {
  embeddingMetaMatches,
  getChunkCount,
  getIndexGeneration,
  getStoredEmbeddingMeta,
  initVecSchema,
  type ReindexOutcome,
  type StoredEmbeddingMeta,
} from "./schema.js";

export type { ReindexOutcome, StoredEmbeddingMeta };

const require = createRequire(import.meta.url);

export class VecStore {
  private db: import("better-sqlite3").Database;

  constructor(dbPath: string) {
    ensureDirSync(pathDirname(dbPath));
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    this.db = new Database(dbPath);
    initVecSchema(this.db);
  }

  getStoredEmbeddingMeta(): StoredEmbeddingMeta | null {
    return getStoredEmbeddingMeta(this.db);
  }

  embeddingMetaMatches(embedder: Embedder): boolean {
    return embeddingMetaMatches(this.db, embedder);
  }

  getIndexGeneration(): number {
    return getIndexGeneration(this.db);
  }

  getChunkCount(): number {
    return getChunkCount(this.db);
  }

  reindex(documents: IndexDocument[]): Promise<ReindexOutcome> {
    return reindexChunks(this.db, documents);
  }

  query(queryText: string, topK?: number): Promise<MemoryEntry[]> {
    return queryChunks(this.db, queryText, topK);
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
