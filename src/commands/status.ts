import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { formatMemoryStatusLines, gatherMemoryStatus } from "../cli/status.js";

export type MemoryStatusCommandDeps = {
  getAgentDir(): string | null;
};

export function createMemoryStatusCommand(deps: MemoryStatusCommandDeps) {
  return async (_args: string | string[], ctx: ExtensionCommandContext): Promise<void> => {
    const agentDir = deps.getAgentDir() ?? getAgentDir();

    if (ctx.hasUI) {
      ctx.ui.setWorkingMessage("Checking memory…");
    }

    try {
      const report = await gatherMemoryStatus(agentDir);
      const lines = ["pi-memory status", ...formatMemoryStatusLines(report)];

      if (ctx.hasUI) {
        ctx.ui.setWidget("pi-memory-status", lines, { placement: "aboveEditor" });
      } else {
        ctx.ui.notify(lines.join("\n"), "info");
      }
    } catch (error) {
      ctx.ui.notify(
        `Memory status failed: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    } finally {
      if (ctx.hasUI) {
        ctx.ui.setWorkingMessage();
      }
    }
  };
}
