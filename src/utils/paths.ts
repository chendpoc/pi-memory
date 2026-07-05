import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CONSOLIDATE_ERR_LOG_FILE,
  CONSOLIDATE_LOG_FILE,
  PI_MEMORY_DATA_SUBDIR,
  PI_MEMORY_ENV_FILE_NAME,
  PI_LOGS_SUBDIR,
} from "../constants/paths.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../constants/security.js";
import { isWindows } from "./platform.js";

export { CONFIG_DIR_NAME, getAgentDir };

/** Expand leading `~` or `~/` using the current user's home directory. */
export function expandHomePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/** Pi user config root (~/.pi). Uses Pi's CONFIG_DIR_NAME. */
export function defaultPiConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

/** Memory data root: ~/.pi/pi-memory-data */
export function defaultMemoryAgentDir(): string {
  return join(defaultPiConfigDir(), PI_MEMORY_DATA_SUBDIR);
}

/** pi-memory config: ~/.pi/agent/pi-memory.env */
export function defaultPiMemoryEnvFile(): string {
  return join(getAgentDir(), PI_MEMORY_ENV_FILE_NAME);
}

/** Maintenance logs live under the memory agent dir (`<agentDir>/logs`). */
export function resolvePiLogsDir(agentDir: string): string {
  return join(agentDir, PI_LOGS_SUBDIR);
}

export function defaultPiLogsDir(): string {
  return resolvePiLogsDir(defaultMemoryAgentDir());
}

export function resolveConsolidateLogPath(agentDir: string): string {
  return join(resolvePiLogsDir(agentDir), CONSOLIDATE_LOG_FILE);
}

export function defaultConsolidateLogPath(): string {
  return resolveConsolidateLogPath(defaultMemoryAgentDir());
}

export function resolveConsolidateErrLogPath(agentDir: string): string {
  return join(resolvePiLogsDir(agentDir), CONSOLIDATE_ERR_LOG_FILE);
}

export function defaultConsolidateErrLogPath(): string {
  return resolveConsolidateErrLogPath(defaultMemoryAgentDir());
}

/** Directory mode for agent / socket parent dirs (Unix only; ignored on Windows). */
export function secureDirMode(): number | undefined {
  return isWindows() ? undefined : SECURE_DIR_MODE;
}

/** File mode for socket files (Unix only; ignored on Windows). */
export function secureFileMode(): number | undefined {
  return isWindows() ? undefined : SECURE_FILE_MODE;
}

export function mkdirOptions(): { recursive: true; mode?: number } {
  const mode = secureDirMode();
  return mode === undefined ? { recursive: true } : { recursive: true, mode };
}
