import path from "node:path";

import {
  defaultBundleRoot,
  defaultPiHome,
  defaultSessionsDir,
  defaultSocketPath,
  expandPath,
} from "./paths.js";

export type MemoryProvider = "disabled" | "local" | "cloud";

export type ExtractorType = "regex" | "llm";

export interface TrainerConfig {
  /** Which extractor to use (default "regex"). */
  extractor: ExtractorType;
  /** How many turns per LLM call when extractor is "llm" (default 10). */
  llm_batch_size: number;
  /** Auto-train interval: "1h"|"6h"|"12h"|"24h"|null (default null — disabled). */
  auto_interval: string | null;
}

export interface ConsolidationScheduleConfig {
  /** Local hour for the background consolidation job (default 3). */
  hour: number;
  /** Local minute for the background consolidation job (default 0). */
  minute: number;
  /** Structured JSONL log path (default ~/.pi/memory/consolidation.log). */
  log_path: string;
}

export interface ConsolidationConfig {
  /** Whether session_shutdown enqueues sessions for offline consolidation. */
  enabled: boolean;
  /** Minimum non-empty user turns before enqueue (default 3). */
  min_user_turns: number;
  /** MEMORY.md session cap by line count (default 200). */
  memory_index_max_lines: number;
  /** MEMORY.md session cap by UTF-8 bytes (default 25KB). */
  memory_index_max_bytes: number;
  /** Maximum stage1 rows selected per Phase2 run (default 20). */
  phase2_top_n: number;
  /** M4 prune threshold by last usage (default 90 days). */
  max_unused_days: number;
  /** Daily OS scheduler defaults. */
  schedule: ConsolidationScheduleConfig;
}

export interface MemoryConfig {
  provider: MemoryProvider;
  tlmPath: string;
  socketPath: string;
  bundleRoot: string;
  sidecarReadyTimeoutMs: number;
  queryTimeoutMs: number;
  clientRequestTimeoutMs: number;
  sessionsDir: string;
  memoryMdPaths: string[];
  trainer: TrainerConfig;
  consolidation: ConsolidationConfig;
}

export const defaultTrainerConfig: TrainerConfig = {
  extractor: "regex",
  llm_batch_size: 10,
  auto_interval: null,
};

export function defaultConsolidationConfig(
  overrides: Partial<ConsolidationConfig> & {
    schedule?: Partial<ConsolidationScheduleConfig>;
  } = {},
): ConsolidationConfig {
  const defaultSchedule: ConsolidationScheduleConfig = {
    hour: 3,
    minute: 0,
    log_path: path.join(defaultBundleRoot(), "consolidation.log"),
  };
  const { schedule, ...rest } = overrides;
  return {
    enabled: true,
    min_user_turns: 3,
    memory_index_max_lines: 200,
    memory_index_max_bytes: 25_600,
    phase2_top_n: 20,
    max_unused_days: 90,
    schedule: { ...defaultSchedule, ...schedule },
    ...rest,
  };
}

export function defaultMemoryConfig(
  overrides: Partial<MemoryConfig> = {},
): MemoryConfig {
  const {
    trainer: trainerOverrides,
    consolidation: consolidationOverrides,
    ...rest
  } = overrides;
  return {
    provider: "local",
    tlmPath: "tlm",
    socketPath: defaultSocketPath(),
    bundleRoot: defaultBundleRoot(),
    sidecarReadyTimeoutMs: 15_000,
    queryTimeoutMs: 2_000,
    clientRequestTimeoutMs: 5_000,
    sessionsDir: defaultSessionsDir(),
    memoryMdPaths: [path.join(defaultPiHome(), "MEMORY.md")],
    trainer: { ...defaultTrainerConfig, ...trainerOverrides },
    consolidation: defaultConsolidationConfig(consolidationOverrides),
    ...rest,
  };
}

/** Normalize user-supplied paths after JSON/env load. */
export function normalizeMemoryConfig(
  raw: Partial<MemoryConfig> & Record<string, unknown>,
): MemoryConfig {
  const base = defaultMemoryConfig();
  const rawTrainer = (raw.trainer ?? {}) as Partial<TrainerConfig>;
  const rawConsolidation = (raw.consolidation ?? {}) as
    Partial<ConsolidationConfig> & {
      schedule?: Partial<ConsolidationScheduleConfig>;
    };
  const rawSchedule = (rawConsolidation.schedule ?? {}) as
    Partial<ConsolidationScheduleConfig>;
  return {
    provider: (raw.provider as MemoryProvider) ?? base.provider,
    tlmPath: expandPath(String(raw.tlmPath ?? base.tlmPath)),
    socketPath: expandPath(String(raw.socketPath ?? base.socketPath)),
    bundleRoot: expandPath(String(raw.bundleRoot ?? base.bundleRoot)),
    sidecarReadyTimeoutMs: Number(
      raw.sidecarReadyTimeoutMs ?? base.sidecarReadyTimeoutMs,
    ),
    queryTimeoutMs: Number(raw.queryTimeoutMs ?? base.queryTimeoutMs),
    clientRequestTimeoutMs: Number(
      raw.clientRequestTimeoutMs ?? base.clientRequestTimeoutMs,
    ),
    sessionsDir: expandPath(String(raw.sessionsDir ?? base.sessionsDir)),
    memoryMdPaths: Array.isArray(raw.memoryMdPaths)
      ? raw.memoryMdPaths.map((p) => expandPath(String(p)))
      : base.memoryMdPaths,
    trainer: {
      extractor: (rawTrainer.extractor as ExtractorType) ?? base.trainer.extractor,
      llm_batch_size: Number(rawTrainer.llm_batch_size ?? base.trainer.llm_batch_size),
      auto_interval: rawTrainer.auto_interval !== undefined
        ? rawTrainer.auto_interval
        : base.trainer.auto_interval,
    },
    consolidation: {
      enabled: rawConsolidation.enabled ?? base.consolidation.enabled,
      min_user_turns: Number(
        rawConsolidation.min_user_turns ?? base.consolidation.min_user_turns,
      ),
      memory_index_max_lines: Number(
        rawConsolidation.memory_index_max_lines ??
          base.consolidation.memory_index_max_lines,
      ),
      memory_index_max_bytes: Number(
        rawConsolidation.memory_index_max_bytes ??
          base.consolidation.memory_index_max_bytes,
      ),
      phase2_top_n: Number(
        rawConsolidation.phase2_top_n ?? base.consolidation.phase2_top_n,
      ),
      max_unused_days: Number(
        rawConsolidation.max_unused_days ?? base.consolidation.max_unused_days,
      ),
      schedule: {
        hour: Number(rawSchedule.hour ?? base.consolidation.schedule.hour),
        minute: Number(rawSchedule.minute ?? base.consolidation.schedule.minute),
        log_path: expandPath(
          String(rawSchedule.log_path ?? base.consolidation.schedule.log_path),
        ),
      },
    },
  };
}
