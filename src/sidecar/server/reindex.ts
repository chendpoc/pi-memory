import { createHash } from "node:crypto";

import type { IndexDocument, SidecarResponse } from "../protocol.js";
import { computeDocumentsFingerprint } from "./vec/fingerprint.js";
import { getEmbedder } from "./vec/embedder.js";
import { getVecStore } from "./vec/store.js";

export type ReindexContext = {
  dbPath: string;
};

export async function handleReindex(
  requestId: string,
  ctx: ReindexContext,
  documents: IndexDocument[] = [],
): Promise<Extract<SidecarResponse, { type: "reindex_ok" }>> {
  const store = getVecStore(ctx.dbPath);
  // Skip re-embedding when the document set is unchanged since the last full
  // reindex (same ids + contents + embedder identity). Session startup calls
  // reindex on every attach; re-embedding an unchanged memory file dominated
  // attach latency with remote embedders (e.g. ~7s for 128 chunks via ollama).
  const embedder = getEmbedder();
  const fingerprint = computeDocumentsFingerprint(documents, embedder);
  if (documents.length > 0 && store.getLastReindexFingerprint() === fingerprint) {
    return {
      type: "reindex_ok",
      request_id: requestId,
      indexed: 0,
      index_generation: store.getIndexGeneration(),
      skipped: "fingerprint_match",
    };
  }
  const outcome = await store.reindex(documents);
  store.setLastReindexFingerprint(fingerprint);
  return {
    type: "reindex_ok",
    request_id: requestId,
    indexed: outcome.indexed,
    index_generation: outcome.indexGeneration,
  };
}
