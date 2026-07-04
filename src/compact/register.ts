import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { LlmClient } from "../adapters/llm/types.js";
import { isSubagentSession } from "../preflight/session.js";
import type { MemoryStore } from "../store/memoryStore.js";
import { runDualPurposeCompactionSummary } from "./runSummary.js";

export type CompactHandlerDeps = {
  getMemoryStore(): MemoryStore | null;
  getLlmClient(): LlmClient | null;
  onCompactionIngested?(): Promise<void>;
};

export function registerCompactHandlers(pi: ExtensionAPI, deps: CompactHandlerDeps): void {
  pi.on("session_before_compact", async (event, ctx) => {
    const llm = deps.getLlmClient();
    if (!llm) return;

    const { preparation, signal } = event;
    const workingUi = ctx.hasUI
      ? {
          show: () => ctx.ui.setWorkingMessage("Summarizing for memory…"),
          clear: () => ctx.ui.setWorkingMessage(),
        }
      : null;

    try {
      workingUi?.show();
      const summary = await runDualPurposeCompactionSummary(preparation, llm, signal);
      if (!summary) return;

      return {
        compaction: {
          summary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
        },
      };
    } catch {
      return;
    } finally {
      workingUi?.clear();
    }
  });

  pi.on("session_compact", (event, ctx) => {
    const store = deps.getMemoryStore();
    if (!store) return;

    store.appendFromCompaction({
      compactionId: event.compactionEntry.id,
      summary: event.compactionEntry.summary,
      subagent: isSubagentSession(ctx),
      onComplete: () => deps.onCompactionIngested?.(),
    });
  });
}
