import fs from "node:fs";
import path from "node:path";

import type {
  ErrorClass,
  MemoryBlock,
  MemoryCandidateGroup,
  QueryCandidate,
  QueryIntent,
  ResponseEnvelope,
} from "../types.js";

interface BundleEntity {
  entity_id: string;
  label: string;
  type: string;
  aliases: string[];
  mention_count: number;
  distinct_session_count: number;
}

interface BundleEdge {
  head_entity_id: string;
  relation: string;
  tail_entity_id: string;
  supporting_event_ids: string[];
  evidence: string;
}

interface BundleEvent {
  event_id: string;
  description: string;
  session_id: string;
  timestamp: string;
}

interface GraphData {
  entities: BundleEntity[];
  edges: BundleEdge[];
  events: BundleEvent[];
}

export class LocalGraphQuerier {
  private entities: BundleEntity[] = [];
  private edges: BundleEdge[] = [];
  private events: BundleEvent[] = [];
  private entityById = new Map<string, BundleEntity>();
  private entityByLabel = new Map<string, BundleEntity>();
  private loaded = false;

  constructor(private readonly bundleRoot: string) {}

  load(): boolean {
    const graphPath = path.join(this.bundleRoot, "current", "graph.json");
    try {
      const raw = fs.readFileSync(graphPath, "utf8");
      const data = JSON.parse(raw) as GraphData;
      this.entities = data.entities ?? [];
      this.edges = data.edges ?? [];
      this.events = data.events ?? [];

      this.entityById.clear();
      this.entityByLabel.clear();
      for (const e of this.entities) {
        this.entityById.set(e.entity_id, e);
        this.entityByLabel.set(e.label.toLowerCase(), e);
        for (const alias of e.aliases) {
          this.entityByLabel.set(alias.toLowerCase(), e);
        }
      }
      this.loaded = true;
      return true;
    } catch {
      return false;
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  private findEntity(mention: string): BundleEntity | null {
    const key = mention.toLowerCase().trim();
    return this.entityByLabel.get(key) ?? null;
  }

  private findEntities(mentions: string[]): BundleEntity[] {
    const found: BundleEntity[] = [];
    for (const m of mentions) {
      const e = this.findEntity(m);
      if (e) found.push(e);
    }
    return found;
  }

  query(intent: QueryIntent): {
    env: ResponseEnvelope | null;
    errorClass: ErrorClass;
  } {
    if (!this.loaded) {
      return { env: null, errorClass: "unavailable" };
    }

    const anchors = this.findEntities(intent.anchor_mentions);
    if (anchors.length === 0) {
      return {
        env: this.makeEnvelope(intent, [], [], "no matching entities found"),
        errorClass: "ok",
      };
    }

    const limit = intent.result_limit && intent.result_limit > 0 ? intent.result_limit : 10;
    const candidates: QueryCandidate[] = [];
    const groups: MemoryCandidateGroup[] = [];

    for (const anchor of anchors) {
      const relatedEdges = this.edges.filter((e) => {
        const matchesHead = e.head_entity_id === anchor.entity_id;
        const matchesTail = e.tail_entity_id === anchor.entity_id;
        if (!matchesHead && !matchesTail) return false;

        if (intent.relation_constraints?.length) {
          return intent.relation_constraints.some((rc) => {
            const clean = rc.replace(/\^-1$/, "").replace(/^\^/, "");
            return e.relation === clean;
          });
        }
        return true;
      });

      for (const edge of relatedEdges) {
        if (candidates.length >= limit) break;
        const isHead = edge.head_entity_id === anchor.entity_id;
        const otherId = isHead ? edge.tail_entity_id : edge.head_entity_id;
        const other = this.entityById.get(otherId);
        if (!other) continue;

        if (intent.candidate_type) {
          if (other.type.toLowerCase() !== intent.candidate_type.toLowerCase()) continue;
        }

        const score = other.mention_count + (other.distinct_session_count * 2);

        candidates.push({
          value: other.label,
          score,
          evidence: edge.evidence.slice(0, 200),
          supporting_event_ids: edge.supporting_event_ids,
          entity_id: other.entity_id,
          scope: `via_${anchor.label}`,
          support_count: other.mention_count,
          distinct_session_count: other.distinct_session_count,
          observed_path: [{
            from_entity_id: anchor.entity_id,
            from_label: anchor.label,
            relation: edge.relation,
            direction: isHead ? "forward" : "inverse",
            to_entity_id: other.entity_id,
            to_label: other.label,
            supporting_event_ids: edge.supporting_event_ids,
          }],
          path_collision_count: 0,
        });

        groups.push({
          value: other.label,
          score,
          evidence: edge.evidence.slice(0, 200),
          support_count: other.mention_count,
          supporting_event_ids: edge.supporting_event_ids,
          entity_ids: [other.entity_id],
          scopes: [`via_${anchor.label}`],
          via_relations: [edge.relation],
          via_anchor_entity_ids: [anchor.entity_id],
          observed_path: [{
            from_entity_id: anchor.entity_id,
            from_label: anchor.label,
            relation: edge.relation,
            direction: isHead ? "forward" : "inverse",
            to_entity_id: other.entity_id,
            to_label: other.label,
            supporting_event_ids: edge.supporting_event_ids,
          }],
          path_collision_count: 0,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    groups.sort((a, b) => b.score - a.score);

    return {
      env: this.makeEnvelope(intent, candidates.slice(0, limit), groups.slice(0, limit)),
      errorClass: "ok",
    };
  }

  private makeEnvelope(
    intent: QueryIntent,
    candidates: QueryCandidate[],
    groups: MemoryCandidateGroup[],
    noDataReason?: string,
  ): ResponseEnvelope {
    const manifestPath = path.join(this.bundleRoot, "current", "manifest.json");
    let bundleVersion: string | undefined;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { bundle_version?: string };
      bundleVersion = m.bundle_version;
    } catch { /* ok */ }

    const memoryBlock: MemoryBlock = {
      groups,
      notes: [],
      ...(noDataReason ? { no_data_reason: noDataReason } : {}),
    };

    return {
      protocol_version: 1,
      bundle_version: bundleVersion,
      request_id: `local-${Date.now()}`,
      candidates,
      memory_block: memoryBlock,
      warnings: [],
      reason: candidates.length > 0 ? "ok" : "no_data",
      latency_ms: 0,
    };
  }
}
