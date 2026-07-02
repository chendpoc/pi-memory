import { installBundle } from "../bundle/install.js";
import { defaultBundleRoot, defaultSessionsDir } from "../paths.js";

import { loadSessions } from "./sessionLoader.js";
import { extractFactsFromSessions, type ExtractFactsOptions } from "./extractFacts.js";
import { resolveEntities } from "./entityResolver.js";
import { buildBundle, type BuildBundleResult } from "./bundleBuilder.js";
import { readMarker, writeMarker } from "./marker.js";
import { loadExistingBundle } from "./bundleLoader.js";
import { deltaMerge, type DeltaLog } from "./deltaMerge.js";

export interface TrainBundleConfig {
  sessionsDir?: string;
  bundleRoot?: string;
  /** Ignore marker and rebuild from all sessions. */
  full?: boolean;
  /** Show what would be extracted without writing. */
  dryRun?: boolean;
  /** Bundle version to stamp (default "0.6.0"). */
  bundleVersion?: string;
  /** Extraction options (optional LLM extractor). */
  extractOpts?: ExtractFactsOptions;
  /** Skip delta merge — full rebuild even if existing bundle present (default false). */
  noMerge?: boolean;
}

export interface TrainBundleResult {
  sessionsProcessed: number;
  entityCount: number;
  relationCount: number;
  eventCount: number;
  bundleResult?: BuildBundleResult;
  installResult?: {
    bundle_ts: string;
    bundle_version: string;
    installed_dir: string;
    files_copied: number;
  };
  dryRun: boolean;
  /** Delta operation log when merge was performed. */
  delta?: DeltaLog;
}

/**
 * Full training pipeline:
 *   load existing bundle → extract new → delta merge → build → install → update marker.
 *
 * When `noMerge` is true (or no existing bundle), falls back to full rebuild.
 */
export async function trainBundle(
  config: TrainBundleConfig = {},
): Promise<TrainBundleResult> {
  const sessionsDir = config.sessionsDir ?? defaultSessionsDir();
  const bundleRoot = config.bundleRoot ?? defaultBundleRoot();

  let modifiedAfter: Date | null = null;
  if (!config.full) {
    modifiedAfter = await readMarker(bundleRoot);
  }

  const sessions = await loadSessions({ sessionsDir, modifiedAfter });

  if (sessions.length === 0) {
    return {
      sessionsProcessed: 0,
      entityCount: 0,
      relationCount: 0,
      eventCount: 0,
      dryRun: config.dryRun ?? false,
    };
  }

  const extracted = await extractFactsFromSessions(sessions, config.extractOpts);
  const newGraph = resolveEntities(extracted.entities, extracted.relations);

  let finalGraph = newGraph;
  let finalEvents = extracted.events;
  let deltaLog: DeltaLog | undefined;

  if (!config.noMerge) {
    const existingBundle = await loadExistingBundle(bundleRoot);
    if (existingBundle) {
      const merged = deltaMerge(
        existingBundle,
        { graph: newGraph, events: extracted.events },
      );
      finalGraph = merged.graph;
      finalEvents = merged.events;
      deltaLog = merged.delta;
    }
  }

  if (config.dryRun) {
    return {
      sessionsProcessed: sessions.length,
      entityCount: finalGraph.entities.length,
      relationCount: finalGraph.relations.length,
      eventCount: finalEvents.length,
      dryRun: true,
      delta: deltaLog,
    };
  }

  const bundleResult = await buildBundle(
    { graph: finalGraph, events: finalEvents },
    { outputDir: bundleRoot, bundleVersion: config.bundleVersion },
  );

  const installResult = await installBundle({
    bundleRoot,
    sourceDir: bundleResult.bundleDir,
  });

  const latestMtime = sessions.reduce(
    (max, s) => (s.modifiedAt > max ? s.modifiedAt : max),
    sessions[0]!.modifiedAt,
  );
  await writeMarker(bundleRoot, latestMtime);

  return {
    sessionsProcessed: sessions.length,
    entityCount: bundleResult.stats.entityCount,
    relationCount: bundleResult.stats.edgeCount,
    eventCount: bundleResult.stats.eventCount,
    bundleResult,
    installResult,
    dryRun: false,
    delta: deltaLog,
  };
}

export { loadSessionFile, loadSessions } from "./sessionLoader.js";
export type { LoadedSession, SessionTurn, SessionLoaderOptions } from "./sessionLoader.js";
export { extractFacts, extractFactsFromSessions, RELATION_CATALOG, ALL_RELATIONS } from "./extractFacts.js";
export type {
  ExtractedEntity, ExtractedRelation, ExtractedEvent,
  ExtractionResult, EntityType, LLMFactExtractor, ExtractFactsOptions,
} from "./extractFacts.js";
export { resolveEntities } from "./entityResolver.js";
export type { ResolvedEntity, ResolvedRelation, ResolvedGraph } from "./entityResolver.js";
export { buildBundle } from "./bundleBuilder.js";
export type { BundleData, BuildBundleOptions, BuildBundleResult } from "./bundleBuilder.js";
export { readMarker, writeMarker } from "./marker.js";
export { loadExistingBundle } from "./bundleLoader.js";
export type { ExistingBundle } from "./bundleLoader.js";
export { deltaMerge } from "./deltaMerge.js";
export type { DeltaOp, DeltaLogEntry, DeltaLog, MergeResult } from "./deltaMerge.js";
