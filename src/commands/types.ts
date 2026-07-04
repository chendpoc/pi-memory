import type { MemoryStore } from "../store/memoryStore.js";

export type RememberCommandDeps = {
  getMemoryStore(): MemoryStore | null;
  onRemembered?(): Promise<void>;
};

export type MemoryStatusCommandDeps = {
  getAgentDir(): string | null;
};

export type CommandDeps = RememberCommandDeps & MemoryStatusCommandDeps;
