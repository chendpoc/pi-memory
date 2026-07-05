import { initializeMemoryWorkspace } from "../store/initWorkspace.js";

import type { CliLog } from "./log.js";

export async function runInitCommand(agentDir: string, log: CliLog): Promise<number> {
  const result = await initializeMemoryWorkspace(agentDir);

  log.line("agent dir", result.agentDir);
  log.line("memory file", result.memoryFile);

  if (result.skipped) {
    log.warn("MEMORY.md already exists (left unchanged)");
    return 0;
  }

  log.success("Created MEMORY.md from pi-memory template");
  return 0;
}
