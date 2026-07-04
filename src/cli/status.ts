import { existsSync } from "node:fs";

import { readPiMemoryEnv, resolveEmbedDim } from "../config/env.js";
import { ping } from "../sidecar/client.js";
import { resolveSidecarPaths } from "../sidecar/paths.js";
import { getVecStore } from "../sidecar/server/vec/store.js";
import { createMemoryStore } from "../store/index.js";
import type { MemoryStats } from "../store/types.js";

import type { CliLog } from "./log.js";
import { theme } from "./theme.js";

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
  };
  embedder: {
    provider: string;
    model: string;
    dim: number;
  };
};

export async function gatherMemoryStatus(agentDir: string): Promise<MemoryStatusReport> {
  const store = createMemoryStore({ agentDir });
  await store.ensureInitialized();

  const sidecar = resolveSidecarPaths(agentDir);
  const env = readPiMemoryEnv();
  const embedModel =
    env.embedder === "openai"
      ? env.openaiEmbedModel
      : env.embedder === "ollama"
        ? env.ollamaEmbedModel
        : "hash";

  const report: MemoryStatusReport = {
    agentDir,
    memory: await store.getStats(),
    sidecar: {
      socketPath: sidecar.socketPath,
      running: await ping(sidecar.socketPath),
    },
    vectorIndex: {
      dbPath: sidecar.dbPath,
      exists: existsSync(sidecar.dbPath),
    },
    embedder: {
      provider: env.embedder,
      model: embedModel,
      dim: resolveEmbedDim(embedModel, env.embedDimOverride),
    },
  };

  if (report.vectorIndex.exists) {
    try {
      const vec = getVecStore(sidecar.dbPath);
      report.vectorIndex.generation = vec.getIndexGeneration();
      report.vectorIndex.chunkCount = vec.getChunkCount();
      const meta = vec.getStoredEmbeddingMeta();
      if (meta) {
        report.vectorIndex.embeddingProvider = meta.provider;
        report.vectorIndex.embeddingModel = meta.model;
        report.vectorIndex.embeddingDim = meta.dim;
      }
    } catch {
      // unreadable index file
    }
  }

  return report;
}

type MemoryStatusRow = {
  label: string;
  value: (themed: boolean) => string;
};

function memoryStatusRows(report: MemoryStatusReport): MemoryStatusRow[] {
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
      value: (themed) =>
        themed && !report.memory.lastConsolidatedAt
          ? theme.dim(lastConsolidated)
          : lastConsolidated,
    },
    {
      label: "sidecar",
      value: (themed) => {
        if (!themed) return sidecarDetail;
        const state = report.sidecar.running ? theme.ok(sidecarState) : theme.bad(sidecarState);
        return `${state} ${theme.dim(`(${report.sidecar.socketPath})`)}`;
      },
    },
  ];

  if (!report.vectorIndex.exists) {
    rows.push({
      label: "vector index",
      value: (themed) => (themed ? theme.dim("(missing)") : "(missing)"),
    });
  } else {
    rows.push({
      label: "vector index",
      value: () =>
        `gen=${report.vectorIndex.generation ?? "?"} chunks=${report.vectorIndex.chunkCount ?? "?"}`,
    });
    const indexed = report.vectorIndex.embeddingProvider
      ? `${report.vectorIndex.embeddingProvider}/${report.vectorIndex.embeddingModel} (${report.vectorIndex.embeddingDim}d)`
      : "(no embedding meta)";
    rows.push({
      label: "index embedder",
      value: (themed) =>
        themed && !report.vectorIndex.embeddingProvider ? theme.dim(indexed) : indexed,
    });
  }

  rows.push({
    label: "configured embedder",
    value: () => `${report.embedder.provider}/${report.embedder.model} (${report.embedder.dim}d)`,
  });

  return rows;
}

export function formatMemoryStatusLines(report: MemoryStatusReport): string[] {
  return memoryStatusRows(report).map(
    ({ label, value }) => `${label.padEnd(16)} ${value(false)}`,
  );
}

export function printMemoryStatus(report: MemoryStatusReport, log: CliLog): void {
  for (const { label, value } of memoryStatusRows(report)) {
    log.line(label, value(true));
  }
}

export async function runStatusCommand(agentDir: string, log: CliLog): Promise<number> {
  const report = await gatherMemoryStatus(agentDir);
  printMemoryStatus(report, log);
  return 0;
}
