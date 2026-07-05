import type { CliLog } from "./log.js";
import { syncMaintenanceScheduler } from "../scheduler/sync.js";

export async function runSchedulerSyncCommand(agentDir: string, log: CliLog): Promise<number> {
  const result = await syncMaintenanceScheduler({ agentDir });

  if (result.status === "skipped") {
    log.warn(`scheduler sync skipped (${result.reason})`);
    return 0;
  }

  if (result.status === "failed") {
    log.error(`scheduler sync failed: ${result.message}`);
    return 1;
  }

  if (result.removedLegacy.length > 0) {
    log.line("removed legacy", result.removedLegacy.join(", "));
  }

  if (result.changed) {
    log.success(`launchd job installed (${result.label})`);
  } else if (result.bootstrapped) {
    log.success(`launchd job loaded (${result.label})`);
  } else {
    log.info(`launchd job unchanged (${result.label})`);
  }

  log.line("plist", result.plistPath);
  return 0;
}
