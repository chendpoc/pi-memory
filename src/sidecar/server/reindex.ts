import type { IndexDocument, SidecarResponse } from "../protocol.js";
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
  const outcome = await store.reindex(documents);
  return {
    type: "reindex_ok",
    request_id: requestId,
    indexed: outcome.indexed,
    index_generation: outcome.indexGeneration,
  };
}
