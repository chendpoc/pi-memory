import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { MemoryStore } from "../store/memoryStore.js";
import { parseRememberArgs } from "./parseRememberArgs.js";

export type RememberCommandDeps = {
  getMemoryStore(): MemoryStore | null;
  onRemembered?(): Promise<void>;
};

export function createRememberCommand(deps: RememberCommandDeps) {
  return async (args: string | string[], ctx: ExtensionCommandContext): Promise<void> => {
    const memoryStore = deps.getMemoryStore();
    if (!memoryStore) {
      ctx.ui.notify("pi-memory: not started", "warning");
      return;
    }

    const parsed = parseRememberArgs(args);
    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "warning");
      return;
    }

    try {
      await memoryStore.ensureInitialized();
      await memoryStore.appendUser({
        id: "",
        section: parsed.section,
        content: parsed.content,
        timestamp: "",
      });
      await deps.onRemembered?.();

      ctx.ui.notify(`Saved to MEMORY.md (${parsed.section})`, "info");
    } catch (error) {
      ctx.ui.notify(
        `Remember failed: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  };
}
