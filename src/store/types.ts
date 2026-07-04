import type { IndexDocument } from "../sidecar/protocol.js";
import { MEMORY_SECTIONS, type MemorySection } from "../constants/memory.js";

export { MEMORY_SECTIONS, type MemorySection };

/** Durable note stored in MEMORY.md (+ overflow files). */
export type StoreMemoryEntry = {
  id: string;
  section: MemorySection;
  content: string;
  userAuthored?: boolean;
  timestamp: string;
};

export type ParsedEntry = StoreMemoryEntry & {
  sourceFile: string;
  line: number;
};

export type MemoryStats = {
  lineCount: number;
  overflowFileCount: number;
  entryCount: number;
  lastConsolidatedAt: string | null;
};

export type ResolvedMemory = {
  content: string;
  entries: ParsedEntry[];
};

export type IntegrityReport = {
  ok: boolean;
  issues: string[];
};

export type { LlmClient } from "../adapters/llm/types.js";

export type MemoryStoreOptions = {
  agentDir: string;
  memoryFileName?: string;
  maxLines?: number;
  defaultFallbackMaxChars?: number;
};

export type { IndexDocument };
