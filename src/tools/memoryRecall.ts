import { createFallbackQuery } from "../fallback/index.js";
import { rerankWithLLM, type RerankOptions, type RankedResult } from "../fallback/llmRerank.js";
import type { SessionSearchHit } from "../fallback/sessionSearch.js";
import type { FallbackQuery, MemoryQuerier, MemoryRecallArgs, QueryIntent, QueryMode, ResponseEnvelope, ToolResult } from "../types.js";

export const MEMORY_RECALL_NAME = "memory_recall";

export const MEMORY_RECALL_DESCRIPTION =
  "Read structured episodic memory from the local TLM sidecar — past sessions consolidated into long-term records.\n" +
  "Modes:\n" +
  "- direct_relation: one-hop predicate (e.g. \"what did X create?\"). Read groups[].via_relations.\n" +
  "- path_query: multi-hop / possessive. relation_constraints is the ordered path; inverse hops use ^-1.\n" +
  "- typed_neighborhood: typed target with exactly one relation. Requires candidate_type.\n\n" +
  "Ground answers in supporting evidence internally; tell the user \"past records\" / \"以前的记录\", not raw event IDs.";

export const MEMORY_RECALL_PROMPT_SNIPPET =
  "Query local episodic memory by entity or relationship";

export const MEMORY_RECALL_PROMPT_GUIDELINES = [
  "Use memory_recall when the user asks about past sessions, people, projects, or decisions stored in long-term memory.",
  "Use memory_recall for relationship questions (e.g. who is X to me) when implicit preflight did not already answer.",
] as const;

export const MEMORY_RECALL_PARAMETERS = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["direct_relation", "path_query", "typed_neighborhood"],
    },
    anchor_mentions: { type: "array", items: { type: "string" } },
    relation_constraints: { type: "array", items: { type: "string" } },
    candidate_type: { type: "string" },
    scope_filter: { type: "array", items: { type: "string" } },
    target_slot: { type: "string", enum: ["head", "tail"] },
    time_window: { type: "string" },
    evidence_budget: { type: "integer" },
    result_limit: { type: "integer" },
  },
  required: ["anchor_mentions"],
} as const;

export class MemoryRecallTool {
  constructor(
    private readonly service: MemoryQuerier,
    private readonly fallback: FallbackQuery | null = null,
    private readonly rerankOpts: RerankOptions | null = null,
  ) {}

  info() {
    return {
      name: MEMORY_RECALL_NAME,
      description: MEMORY_RECALL_DESCRIPTION,
      parameters: MEMORY_RECALL_PARAMETERS,
    };
  }

  async run(argsJson: string, signal?: AbortSignal, onProgress?: (msg: string) => void): Promise<ToolResult> {
    const args = parseArgs(argsJson);
    if ("error" in args) {
      return { content: args.error, isError: true };
    }

    const intent = argsToIntent(args);
    const validation = validateArgs(args);
    if (validation) {
      return { content: validation, isError: true };
    }

    return this.runIntent(intent, signal, onProgress);
  }

  async runIntent(intent: QueryIntent, signal?: AbortSignal, onProgress?: (msg: string) => void): Promise<ToolResult> {
    if (this.service.status() !== "ready") {
      return this.fallbackResult(intent, "service_unavailable", "fallback");
    }

    // Emit a progress message if the sidecar takes longer than 500 ms.
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    if (onProgress) {
      progressTimer = setTimeout(() => {
        onProgress("Querying episodic memory…");
      }, 500);
    }

    let result;
    try {
      result = await this.service.query(intent, signal);
    } finally {
      if (progressTimer != null) clearTimeout(progressTimer);
    }

    if (result.transportError || result.errorClass === "unavailable") {
      return this.fallbackResult(intent, "service_unavailable", "fallback");
    }

    if (result.errorClass === "retryable") {
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      if (onProgress) {
        retryTimer = setTimeout(() => onProgress("Retrying memory query…"), 500);
      }
      let retryResult;
      try {
        await sleep(500, signal);
        retryResult = await this.service.query(intent, signal);
      } finally {
        if (retryTimer != null) clearTimeout(retryTimer);
      }
      if (
        retryResult.transportError ||
        retryResult.errorClass === "unavailable" ||
        retryResult.errorClass === "retryable"
      ) {
        return this.fallbackResult(intent, "retryable_failed", "fallback_after_retry");
      }
      result = retryResult;
    }

    if (result.errorClass === "permanent") {
      return permanentResult(result.env);
    }

    return shapeResult(result.env!);
  }

  private async fallbackResult(
    intent: QueryIntent,
    reason: string,
    source: string,
  ): Promise<ToolResult> {
    const candidates: Record<string, unknown>[] = [];
    const warnings: Record<string, unknown>[] = [];

    if (this.fallback) {
      const query = intent.anchor_mentions.map((s) => s.trim()).filter(Boolean).join(" ");
      const limit = intent.result_limit && intent.result_limit > 0 ? intent.result_limit : 10;
      try {
        const hits = await this.fallback.sessionKeyword(query, limit);

        let reranked: RankedResult[] | null = null;
        if (this.rerankOpts && hits.length > 0) {
          try {
            reranked = await rerankWithLLM(
              query,
              hits as SessionSearchHit[],
              this.rerankOpts,
            );
          } catch {
            /* silent fallback to original order */
          }
        }

        if (reranked) {
          for (const r of reranked) {
            const original = hits[r.index];
            candidates.push({
              value: r.summary,
              score: r.score,
              evidence: "llm_rerank",
              ...(typeof original === "object" && original !== null &&
                "session_id" in (original as Record<string, unknown>)
                ? { scope: "session_search", session_id: (original as Record<string, unknown>).session_id }
                : {}),
            });
          }
        } else {
          for (const h of hits) {
            candidates.push({
              value: typeof h === "string" ? h : JSON.stringify(h),
              evidence: "text_search",
              ...(typeof h === "object" &&
              h !== null &&
              "session_id" in (h as Record<string, unknown>)
                ? { scope: "session_search" }
                : {}),
            });
          }
        }
      } catch (err) {
        warnings.push({
          code: "fallback_session_search_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const snippet = await this.fallback.memoryFileSnippet(query);
        if (snippet) {
          candidates.push({
            value: snippet,
            evidence: "text_search",
            scope: "memory_md",
          });
        }
      } catch {
        /* optional */
      }
    }

    const out = {
      source,
      evidence_quality: "text_search",
      bundle_version: null,
      candidates,
      warnings,
      fallback_reason: reason,
    };
    return { content: JSON.stringify(out) };
  }
}

function parseArgs(argsJson: string): MemoryRecallArgs | { error: string } {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(coerceArgs(argsJson)) as Record<string, unknown>;
  } catch (e) {
    return { error: `invalid input: ${e instanceof Error ? e.message : e}` };
  }
  const anchor = raw.anchor_mentions;
  if (!Array.isArray(anchor) || anchor.length === 0) {
    return { error: "anchor_mentions is required and must be non-empty" };
  }
  return raw as unknown as MemoryRecallArgs;
}

function argsToIntent(a: MemoryRecallArgs): QueryIntent {
  return {
    mode: (a.mode as QueryMode) || "direct_relation",
    anchor_mentions: a.anchor_mentions,
    relation_constraints: a.relation_constraints,
    candidate_type: a.candidate_type,
    scope_filter: a.scope_filter,
    target_slot: (a.target_slot as QueryIntent["target_slot"]) ?? "",
    time_window: a.time_window,
    evidence_budget: a.evidence_budget && a.evidence_budget > 0 ? a.evidence_budget : 5,
    result_limit: a.result_limit && a.result_limit > 0 ? a.result_limit : 10,
  };
}

function validateArgs(a: MemoryRecallArgs): string | null {
  for (const rel of a.relation_constraints ?? []) {
    if (isBroadRelation(rel)) {
      return "memory_recall requires concrete relation_constraints. Broad relations like related_to are not valid for structured lookup.";
    }
  }
  if (a.mode === "typed_neighborhood") {
    if (!a.candidate_type?.trim()) {
      return "typed_neighborhood requires candidate_type.";
    }
    if ((a.relation_constraints?.length ?? 0) !== 1) {
      return "typed_neighborhood requires exactly one relation_constraints value.";
    }
  }
  return null;
}

function isBroadRelation(rel: string): boolean {
  let r = rel.trim().toLowerCase();
  r = r.replace(/^\^/, "").replace(/\^-1$/, "");
  return ["related_to", "relates_to", "associated_with", "about", "mentions", "other"].includes(r);
}

function coerceArgs(argsJson: string): string {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return argsJson;
  }
  let changed = false;
  for (const field of ["anchor_mentions", "relation_constraints", "scope_filter"]) {
    const v = raw[field];
    if (typeof v === "string") {
      try {
        raw[field] = JSON.parse(v);
        changed = true;
      } catch {
        /* keep */
      }
    }
  }
  for (const field of ["result_limit", "evidence_budget"]) {
    const v = raw[field];
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) {
        raw[field] = n;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(raw) : argsJson;
}

function shapeResult(env: ResponseEnvelope): ToolResult {
  let quality = "structured";
  const warnings = envelopeWarnings(env);
  if (env.reason === "degraded") {
    quality = "structured_degraded";
    warnings.unshift({
      code: "bundle_degraded",
      message: "memory bundle degraded — results may be incomplete",
    });
  }
  const cands = env.candidates.map((c) => {
    const m: Record<string, unknown> = {
      value: c.value,
      score: c.score,
      evidence: c.evidence,
      supporting_event_ids: c.supporting_event_ids,
    };
    if (c.scope != null) m.scope = c.scope;
    if (c.support_count != null) m.support_count = c.support_count;
    if (c.distinct_session_count != null) {
      m.distinct_session_count = c.distinct_session_count;
    }
    return m;
  });
  const out = {
    source: "memory_sidecar",
    evidence_quality: quality,
    bundle_version: env.bundle_version ?? null,
    memory_block: env.memory_block ?? null,
    candidates: cands,
    warnings,
    fallback_reason: null,
  };
  return { content: JSON.stringify(out) };
}

function permanentResult(env: ResponseEnvelope | null): ToolResult {
  const out = {
    source: "memory_sidecar",
    evidence_quality: "structured",
    bundle_version: env?.bundle_version ?? null,
    candidates: [],
    warnings: envelopeWarnings(env),
    fallback_reason: null,
  };
  return { content: JSON.stringify(out), isError: true };
}

function envelopeWarnings(env: ResponseEnvelope | null): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (!env) return out;
  for (const w of env.warnings ?? []) {
    out.push({ code: w.code, message: w.message });
  }
  if (env.error) {
    out.push({
      code: env.error.code,
      message: env.error.message,
      sub_code: env.error.details?.sub_code,
    });
  }
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

/** @deprecated Use createFallbackQuery — kept for backward-compatible imports. */
export function createStubFallback(
  memoryMdPaths: string[],
  sessionsDir = "",
): FallbackQuery {
  return createFallbackQuery({ sessionsDir, memoryMdPaths });
}

export { createFallbackQuery };

export function createMemoryRecallTool(
  service: MemoryQuerier,
  fallback: FallbackQuery | null,
  rerankOpts?: RerankOptions | null,
): MemoryRecallTool {
  return new MemoryRecallTool(service, fallback, rerankOpts ?? null);
}
