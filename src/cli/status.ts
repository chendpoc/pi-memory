import { readPiMemoryEnv, resolveEmbedDim } from "../config/env.js";
import { DEFAULT_HASH_EMBED_DIM } from "../constants/env.js";
import { createEmbedder } from "../adapters/embed/factory.js";
import { fetchIndexStats, ping } from "../sidecar/client.js";
import type { IndexStats } from "../sidecar/protocol.js";
import { resolveSidecarPaths } from "../sidecar/paths.js";
import { getVecStore } from "../sidecar/server/vec/store.js";
import { createMemoryStore } from "../store/index.js";
import type { MemoryStats } from "../store/types.js";
import { pathExists } from "../utils/fs.js";

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { CliLog } from "./log.js";
import { theme } from "./theme.js";

export type StatusPalette = {
  dim: (text: string) => string;
  ok: (text: string) => string;
  bad: (text: string) => string;
  warn: (text: string) => string;
};

const plainPalette: StatusPalette = {
  dim: (text) => text,
  ok: (text) => text,
  bad: (text) => text,
  warn: (text) => text,
};

export function cliStatusPalette(): StatusPalette {
  return {
    dim: theme.dim,
    ok: theme.ok,
    bad: theme.bad,
    warn: theme.warn,
  };
}

export function piStatusPalette(theme: Theme): StatusPalette {
  return {
    dim: (text) => theme.fg("dim", text),
    ok: (text) => theme.fg("success", text),
    bad: (text) => theme.fg("error", text),
    warn: (text) => theme.fg("warning", text),
  };
}

export type MemoryStatusReport = {
  agentDir: string;
  memory: MemoryStats;
  sidecar: {
    socketPath: string;
    running: boolean;
  };
  vectorIndex: {
    dbPath: string;
    exists: boolean;
    generation?: number;
    chunkCount?: number;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingDim?: number;
    /** Set when the index file exists but could not be read locally. */
    readError?: string;
    /** Stats came from sidecar RPC rather than opening sqlite in-process. */
    fromSidecar?: boolean;
  };
  embedder: {
    provider: string;
    model: string;
    dim: number;
  };
};

function applyLocalVecStats(
  report: MemoryStatusReport,
  dbPath: string,
): void {
  const vec = getVecStore(dbPath);
  report.vectorIndex.generation = vec.getIndexGeneration();
  report.vectorIndex.chunkCount = vec.getChunkCount();
  const meta = vec.getStoredEmbeddingMeta();
  if (meta) {
    report.vectorIndex.embeddingProvider = meta.provider;
    report.vectorIndex.embeddingModel = meta.model;
    report.vectorIndex.embeddingDim = meta.dim;
  }
}

function applySidecarVecStats(report: MemoryStatusReport, stats: IndexStats): void {
  report.vectorIndex.fromSidecar = true;
  report.vectorIndex.generation = stats.index_generation;
  report.vectorIndex.chunkCount = stats.chunk_count;
  if (stats.embedding_provider && stats.embedding_model && stats.embedding_dim !== undefined) {
    report.vectorIndex.embeddingProvider = stats.embedding_provider;
    report.vectorIndex.embeddingModel = stats.embedding_model;
    report.vectorIndex.embeddingDim = stats.embedding_dim;
  }
}

function embedderMatchesIndex(report: MemoryStatusReport): boolean {
  const { embeddingProvider, embeddingModel, embeddingDim } = report.vectorIndex;
  if (!embeddingProvider || !embeddingModel || embeddingDim === undefined) return true;
  return (
    embeddingProvider === report.embedder.provider &&
    embeddingModel === report.embedder.model &&
    embeddingDim === report.embedder.dim
  );
}

function resolveConfiguredEmbedder(env: ReturnType<typeof readPiMemoryEnv>): MemoryStatusReport["embedder"] {
  try {
    const embedder = createEmbedder(env);
    return { provider: embedder.provider, model: embedder.model, dim: embedder.dim };
  } catch {
    const embedModel =
      env.embedder === "openai"
        ? env.openaiEmbedModel
        : env.embedder === "ollama"
          ? env.ollamaEmbedModel
          : "hash/dev";
    const dim =
      env.embedder === "hash"
        ? (env.embedDimOverride ?? DEFAULT_HASH_EMBED_DIM)
        : resolveEmbedDim(embedModel, env.embedDimOverride);
    return { provider: env.embedder, model: embedModel, dim };
  }
}

export async function gatherMemoryStatus(agentDir: string): Promise<MemoryStatusReport> {
  const store = createMemoryStore({ agentDir });
  await store.ensureInitialized();

  const sidecar = resolveSidecarPaths(agentDir);
  const env = readPiMemoryEnv();

  const sidecarRunning = await ping(sidecar.socketPath);

  const report: MemoryStatusReport = {
    agentDir,
    memory: await store.getStats(),
    sidecar: {
      socketPath: sidecar.socketPath,
      running: sidecarRunning,
    },
    vectorIndex: {
      dbPath: sidecar.dbPath,
      exists: pathExists(sidecar.dbPath),
    },
    embedder: resolveConfiguredEmbedder(env),
  };

  if (!report.vectorIndex.exists) return report;

  if (sidecarRunning) {
    const result = await fetchIndexStats(sidecar.socketPath);
    if ("stats" in result) {
      applySidecarVecStats(report, result.stats);
      return report;
    }
    const hint = result.error.includes("unknown frame type")
      ? "restart sidecar (reload Pi session or pi-memory)"
      : result.error;
    report.vectorIndex.readError = hint;
    return report;
  }

  try {
    applyLocalVecStats(report, sidecar.dbPath);
  } catch (error) {
    report.vectorIndex.readError =
      error instanceof Error ? error.message : "unable to open vector index (start sidecar)";
  }

  return report;
}

type MemoryStatusRow = {
  label: string;
  value: () => string;
};

function formatVectorIndexLine(report: MemoryStatusReport): string {
  const { generation, chunkCount, readError } = report.vectorIndex;
  if (readError) {
    return `(unreadable: ${readError})`;
  }
  if (generation === undefined || chunkCount === undefined) {
    return "(unknown — start sidecar or run pi-memory status again)";
  }
  return `gen=${generation} chunks=${chunkCount}`;
}

function formatIndexEmbedderLine(report: MemoryStatusReport, palette: StatusPalette): string {
  const { embeddingProvider, embeddingModel, embeddingDim, chunkCount, readError } = report.vectorIndex;
  if (readError) {
    return palette.dim("(unavailable)");
  }
  if (!embeddingProvider || !embeddingModel || embeddingDim === undefined) {
    if (chunkCount === 0) {
      return palette.dim("(empty — reindex pending)");
    }
    return palette.dim("(no embedding meta — run reindex)");
  }

  const label = `${embeddingProvider}/${embeddingModel} (${embeddingDim}d)`;
  if (embedderMatchesIndex(report)) {
    return label;
  }
  return palette.warn(`${label} ≠ configured`);
}

function memoryStatusRows(report: MemoryStatusReport, palette: StatusPalette = plainPalette): MemoryStatusRow[] {
  const lastConsolidated = report.memory.lastConsolidatedAt ?? "(never)";
  const sidecarState = report.sidecar.running ? "running" : "not reachable";
  const sidecarDetail = `${sidecarState} (${report.sidecar.socketPath})`;

  const rows: MemoryStatusRow[] = [
    { label: "agent dir", value: () => report.agentDir },
    { label: "MEMORY lines", value: () => String(report.memory.lineCount) },
    { label: "entries", value: () => String(report.memory.entryCount) },
    { label: "overflow files", value: () => String(report.memory.overflowFileCount) },
    {
      label: "last consolidate",
      value: () =>
        !report.memory.lastConsolidatedAt ? palette.dim(lastConsolidated) : lastConsolidated,
    },
    {
      label: "sidecar",
      value: () => {
        const state = report.sidecar.running ? palette.ok(sidecarState) : palette.bad(sidecarState);
        return `${state} ${palette.dim(`(${report.sidecar.socketPath})`)}`;
      },
    },
  ];

  if (!report.vectorIndex.exists) {
    rows.push({
      label: "vector index",
      value: () => palette.dim("(missing — write MEMORY or start session)"),
    });
  } else {
    rows.push({
      label: "vector index",
      value: () => {
        const line = formatVectorIndexLine(report);
        if (report.vectorIndex.readError) return palette.bad(line);
        if (report.vectorIndex.generation === undefined || report.vectorIndex.chunkCount === undefined) {
          return palette.dim(line);
        }
        return line;
      },
    });
    rows.push({
      label: "index embedder",
      value: () => formatIndexEmbedderLine(report, palette),
    });
  }

  rows.push({
    label: "configured embedder",
    value: () => `${report.embedder.provider}/${report.embedder.model} (${report.embedder.dim}d)`,
  });

  return rows;
}

export function formatMemoryStatusSummary(
  report: MemoryStatusReport,
  palette: StatusPalette,
  accent: (text: string) => string,
): string {
  const parts = [
    accent("pi-memory"),
    palette.dim(`entries=${report.memory.entryCount}`),
    report.sidecar.running ? palette.ok("sidecar up") : palette.bad("sidecar down"),
  ];

  if (!report.vectorIndex.exists) {
    parts.push(palette.dim("no index"));
  } else {
    const vec = formatVectorIndexLine(report);
    if (report.vectorIndex.readError) {
      parts.push(palette.bad(vec));
    } else if (report.vectorIndex.generation === undefined || report.vectorIndex.chunkCount === undefined) {
      parts.push(palette.dim(vec));
    } else {
      parts.push(vec);
    }
  }

  return parts.join(palette.dim(" · "));
}

export function formatMemoryStatusLines(report: MemoryStatusReport): string[] {
  return memoryStatusRows(report).map(
    ({ label, value }) => `${label.padEnd(16)} ${value()}`,
  );
}

export function formatMemoryStatusTuiLines(
  report: MemoryStatusReport,
  palette: StatusPalette,
  theme: Theme,
): string[] {
  return memoryStatusRows(report, palette).map(
    ({ label, value }) => `${theme.fg("muted", label.padEnd(16))} ${value()}`,
  );
}

export function printMemoryStatus(report: MemoryStatusReport, log: CliLog): void {
  const palette = cliStatusPalette();
  for (const { label, value } of memoryStatusRows(report, palette)) {
    log.line(label, value());
  }
}

export async function runStatusCommand(agentDir: string, log: CliLog): Promise<number> {
  const report = await gatherMemoryStatus(agentDir);
  printMemoryStatus(report, log);
  return 0;
}
