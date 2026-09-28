export type MemoryEntry = {
  content: string;
  relevance: number;
  timestamp: string;
  source: string;
};

export type IndexDocument = {
  id: string;
  content: string;
  source: string;
  timestamp: string;
};

export type SidecarRequest =
  | { type: "ping" }
  | { type: "stats" }
  | { type: "query"; request_id: string; query: string }
  | { type: "reindex"; request_id: string; documents?: IndexDocument[] };

export type IndexStats = {
  index_generation: number;
  chunk_count: number;
  embedding_provider?: string;
  embedding_model?: string;
  embedding_dim?: number;
};

export type SidecarResponse =
  | { type: "pong" }
  | { type: "stats_ok" } & IndexStats
  | { type: "result"; request_id: string; results: MemoryEntry[] }
  | {
      type: "reindex_ok";
      request_id: string;
      indexed: number;
      index_generation: number;
      skipped?: "fingerprint_match";
    }
  | { type: "error"; request_id?: string; error: string };

export function isErrorResponse(res: SidecarResponse): res is Extract<SidecarResponse, { type: "error" }> {
  return res.type === "error";
}
