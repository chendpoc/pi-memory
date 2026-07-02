import fs from "node:fs";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  defaultMemoryConfig,
  normalizeMemoryConfig,
  type ExtractorType,
  type MemoryConfig,
  type MemoryProvider,
  type TrainerConfig,
} from "./config.js";
import type { OllamaConfig } from "./adapters/ollamaClient.js";
import type { OpenAICompatConfig } from "./adapters/openaiCompatClient.js";

export interface MemorySettingsFile {
  provider?: MemoryProvider;
  tlmPath?: string;
  socketPath?: string;
  bundleRoot?: string;
  sidecarReadyTimeoutMs?: number;
  queryTimeoutMs?: number;
  clientRequestTimeoutMs?: number;
  sessionsDir?: string;
  memoryMdPaths?: string[];
  /** LLM for intent detection, rerank, and LLM extraction. Overrides default helper model. */
  helperModel?: string;
  /** Ollama local API config for helper / trainer / rerank. */
  ollama?: Partial<OllamaConfig>;
  /** OpenAI-compatible endpoint config (vLLM, SGLang, LM Studio, etc.) */
  vllm?: Partial<OpenAICompatConfig>;
  trainer?: Partial<TrainerConfig>;
}

export interface LoadedMemorySettings {
  config: MemoryConfig;
  helperModel: string | undefined;
  ollama: OllamaConfig | null;
  vllm: OpenAICompatConfig | null;
  configPath: string;
}

/** Default path: ~/.pi/agent/memory.json */
export function defaultMemoryConfigPath(): string {
  return path.join(getAgentDir(), "memory.json");
}

function readMemorySettingsFile(configPath = defaultMemoryConfigPath()): MemorySettingsFile {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as MemorySettingsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Failed to load pi-memory config from ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Load pi-memory config from ~/.pi/agent/memory.json. */
export function loadMemorySettings(
  overrides: Partial<MemoryConfig> = {},
  configPath = defaultMemoryConfigPath(),
): LoadedMemorySettings {
  const fileSettings = readMemorySettingsFile(configPath);
  const { helperModel, ollama, vllm, trainer, ...configFields } = fileSettings;

  const config = normalizeMemoryConfig({
    ...configFields,
    ...(trainer ? { trainer } : {}),
    ...overrides,
  } as Partial<MemoryConfig> & Record<string, unknown>);

  let resolvedOllama: OllamaConfig | null = null;
  if (ollama && ollama.model) {
    resolvedOllama = {
      baseUrl: ollama.baseUrl?.trim() || "http://localhost:11434",
      model: ollama.model.trim(),
    };
  }

  let resolvedVllm: OpenAICompatConfig | null = null;
  if (vllm && vllm.model) {
    resolvedVllm = {
      baseUrl: vllm.baseUrl?.trim() || "http://localhost:8000",
      model: vllm.model.trim(),
      apiKey: vllm.apiKey?.trim() || undefined,
    };
  }

  return {
    config,
    helperModel: helperModel?.trim() || undefined,
    ollama: resolvedOllama,
    vllm: resolvedVllm,
    configPath,
  };
}

/** Convenience alias when only MemoryConfig is needed. */
export function loadMemoryConfig(
  overrides: Partial<MemoryConfig> = {},
  configPath = defaultMemoryConfigPath(),
): MemoryConfig {
  return loadMemorySettings(overrides, configPath).config;
}

export function resolveHelperModelSpec(
  flagValue: string | boolean | undefined,
  settingsHelperModel: string | undefined,
): string | undefined {
  if (typeof flagValue === "string" && flagValue.trim()) {
    return flagValue.trim();
  }
  return settingsHelperModel;
}

/** Write memory settings back to disk (preserves unknown fields). */
export function saveMemorySettings(
  updates: Partial<MemorySettingsFile>,
  configPath = defaultMemoryConfigPath(),
): void {
  let existing: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch { /* start fresh */ }

  const merged = { ...existing, ...updates };
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
}

export { defaultMemoryConfig };
export type { ExtractorType, MemoryProvider, TrainerConfig };
