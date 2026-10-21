import { createHash } from "node:crypto";

import type { IndexDocument } from "../../protocol.js";
import type { Embedder } from "../../../adapters/embed/types.js";
import { getLastReindexFingerprint, setLastReindexFingerprint } from "./schema.js";

/**
 * Content fingerprint of a document set: sha256 over sorted (id, content) pairs
 * plus the embedder identity. Any change to ids, contents, or the embedder
 * (model/provider/dim) produces a different fingerprint, so a match means the
 * stored chunks + embeddings already reflect exactly this input.
 */
export function computeDocumentsFingerprint(documents: IndexDocument[], embedder: Embedder): string {
  const hash = createHash("sha256");
  const sorted = [...documents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const doc of sorted) {
    hash.update(doc.id);
    hash.update("\u0000");
    hash.update(doc.content);
    hash.update("\u0000");
  }
  hash.update(`${embedder.provider}\u0000${embedder.model}\u0000${String(embedder.dim)}`);
  return hash.digest("hex");
}

export { getLastReindexFingerprint, setLastReindexFingerprint };
