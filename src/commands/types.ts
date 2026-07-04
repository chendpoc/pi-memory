import type { MemoryStore } from "../store/memoryStore.js";

export type RememberCommandDeps = {
  getMemoryStore(): MemoryStore | null;
  onRemembered?(): Promise<void>;
};
