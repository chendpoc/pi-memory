import {
  LAUNCHD_LABEL,
  SCHEDULER_TEMPLATE_FILES,
  SCHTASKS_TASK_NAME,
} from "../constants/paths.js";
import {
  defaultMemoryAgentDir,
  defaultPiMemoryEnvFile,
  resolveConsolidateErrLogPath,
  resolveConsolidateLogPath,
  resolvePiLogsDir,
} from "./paths.js";
import { getPlatform, isMacOS, isWindows, type PiMemoryPlatform } from "./platform.js";

export type ConsolidateSchedulerKind = "launchd" | "crontab" | "schtasks";

/** Recommended OS scheduler for daily consolidate on this platform. */
export function getConsolidateSchedulerKind(platform: PiMemoryPlatform = getPlatform()): ConsolidateSchedulerKind {
  if (platform === "darwin") return "launchd";
  if (platform === "win32") return "schtasks";
  return "crontab";
}

export type ConsolidateSchedulerPaths = {
  agentDir: string;
  envFile: string;
  logsDir: string;
  stdoutLog: string;
  stderrLog: string;
};

export function defaultConsolidateSchedulerPaths(agentDir = defaultMemoryAgentDir()): ConsolidateSchedulerPaths {
  return {
    agentDir,
    envFile: defaultPiMemoryEnvFile(),
    logsDir: resolvePiLogsDir(agentDir),
    stdoutLog: resolveConsolidateLogPath(agentDir),
    stderrLog: resolveConsolidateErrLogPath(agentDir),
  };
}

export type ConsolidateCliInvocation = {
  nodePath: string;
  cliPath: string;
  cron: boolean;
  verbose: boolean;
  agentDir?: string;
};

/** argv for `pi-memory maintenance` (OS scheduler / wrapper scripts). */
export function buildMaintenanceCliArgs(
  opts: Pick<ConsolidateCliInvocation, "cron" | "verbose" | "agentDir">,
): string[] {
  const args = ["maintenance"];
  if (opts.cron) args.push("--cron");
  if (opts.verbose) args.push("--verbose");
  if (opts.agentDir) args.push("--agent-dir", opts.agentDir);
  return args;
}

/** @deprecated Prefer buildMaintenanceCliArgs for OS schedulers. */
export function buildConsolidateCliArgs(opts: Pick<ConsolidateCliInvocation, "cron" | "verbose" | "agentDir">): string[] {
  return buildMaintenanceCliArgs(opts);
}

/** Single-line shell command (macOS / Linux crontab). */
export function formatMaintenanceCronLine(opts: ConsolidateCliInvocation & ConsolidateSchedulerPaths): string {
  const args = buildMaintenanceCliArgs(opts).join(" ");
  return [
    `PI_MEMORY_ENV_FILE=${opts.envFile}`,
    `PI_MEMORY_AGENT_DIR=${opts.agentDir}`,
    opts.nodePath,
    opts.cliPath,
    args,
    `>> ${opts.stdoutLog} 2>&1`,
  ].join(" ");
}

/** @deprecated Prefer formatMaintenanceCronLine. */
export function formatConsolidateCronLine(opts: ConsolidateCliInvocation & ConsolidateSchedulerPaths): string {
  return formatMaintenanceCronLine(opts);
}

export type ConsolidateTemplateName =
  (typeof SCHEDULER_TEMPLATE_FILES)[keyof typeof SCHEDULER_TEMPLATE_FILES];

/** Template file basename shipped under templates/ for this platform. */
export function getConsolidateTemplateNames(platform: PiMemoryPlatform = getPlatform()): ConsolidateTemplateName[] {
  if (platform === "darwin") {
    return [SCHEDULER_TEMPLATE_FILES.launchd, SCHEDULER_TEMPLATE_FILES.crontab];
  }
  if (platform === "win32") {
    return [SCHEDULER_TEMPLATE_FILES.windowsCmd, SCHEDULER_TEMPLATE_FILES.windowsSchtasks];
  }
  return [SCHEDULER_TEMPLATE_FILES.crontab];
}

export { LAUNCHD_LABEL, SCHEDULER_TEMPLATE_FILES, SCHTASKS_TASK_NAME, isMacOS, isWindows };
