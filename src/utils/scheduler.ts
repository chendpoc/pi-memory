import { join } from "node:path";

import {
  LAUNCHD_LABEL,
  SCHEDULER_TEMPLATE_FILES,
  SCHTASKS_TASK_NAME,
} from "../constants/paths.js";
import {
  defaultAgentDir,
  defaultConsolidateErrLogPath,
  defaultConsolidateLogPath,
  defaultPiEnvFile,
  defaultPiLogsDir,
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

export function defaultConsolidateSchedulerPaths(): ConsolidateSchedulerPaths {
  return {
    agentDir: defaultAgentDir(),
    envFile: defaultPiEnvFile(),
    logsDir: defaultPiLogsDir(),
    stdoutLog: defaultConsolidateLogPath(),
    stderrLog: defaultConsolidateErrLogPath(),
  };
}

export type ConsolidateCliInvocation = {
  nodePath: string;
  cliPath: string;
  cron: boolean;
  verbose: boolean;
  agentDir?: string;
};

/** argv for `pi-memory consolidate` (OS scheduler / wrapper scripts). */
export function buildConsolidateCliArgs(opts: Pick<ConsolidateCliInvocation, "cron" | "verbose" | "agentDir">): string[] {
  const args = ["consolidate"];
  if (opts.cron) args.push("--cron");
  if (opts.verbose) args.push("--verbose");
  if (opts.agentDir) args.push("--agent-dir", opts.agentDir);
  return args;
}

/** Single-line shell command (macOS / Linux crontab). */
export function formatConsolidateCronLine(opts: ConsolidateCliInvocation & ConsolidateSchedulerPaths): string {
  const args = buildConsolidateCliArgs(opts).join(" ");
  return [
    `PI_MEMORY_ENV_FILE=${opts.envFile}`,
    `PI_MEMORY_AGENT_DIR=${opts.agentDir}`,
    opts.nodePath,
    opts.cliPath,
    args,
    `>> ${opts.stdoutLog} 2>&1`,
  ].join(" ");
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
