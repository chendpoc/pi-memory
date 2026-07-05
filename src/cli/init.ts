import { initializeMemoryWorkspace } from "../store/initWorkspace.js";
import { syncMaintenanceScheduler } from "../scheduler/sync.js";

import type { CliLog } from "./log.js";

export async function runInitCommand(agentDir: string, log: CliLog): Promise<number> {
  const result = await initializeMemoryWorkspace(agentDir);

  log.line("agent dir", result.agentDir);
  log.line("memory file", result.memoryFile);

  if (result.skipped) {
    log.warn("MEMORY.md already exists (left unchanged)");
  } else {
    log.success("Created MEMORY.md from pi-memory template");
  }

  const scheduler = await syncMaintenanceScheduler({ agentDir: result.agentDir });
  if (scheduler.status === "synced") {
    if (scheduler.changed) {
      log.success(`launchd job installed (${scheduler.label})`);
    } else if (scheduler.bootstrapped) {
      log.success(`launchd job loaded (${scheduler.label})`);
    }
    if (scheduler.removedLegacy.length > 0) {
      log.line("removed legacy", scheduler.removedLegacy.join(", "));
    }
  } else if (scheduler.status === "failed") {
    log.warn(`scheduler sync failed (${scheduler.message})`);
  }

  return 0;
}
