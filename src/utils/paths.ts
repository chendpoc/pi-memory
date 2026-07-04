import { homedir } from "node:os";
import { join } from "node:path";

import {
  CONSOLIDATE_ERR_LOG_FILE,
  CONSOLIDATE_LOG_FILE,
  PI_AGENT_SUBDIR,
  PI_CONFIG_DIR,
  PI_ENV_FILE,
  PI_LOGS_SUBDIR,
} from "../constants/paths.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../constants/security.js";
import { isWindows } from "./platform.js";

/** Expand leading `~` or `~/` using the current user's home directory. */
export function expandHomePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function defaultPiConfigDir(): string {
  return join(homedir(), PI_CONFIG_DIR);
}

export function defaultAgentDir(): string {
  return join(defaultPiConfigDir(), PI_AGENT_SUBDIR);
}

export function defaultPiEnvFile(): string {
  return join(defaultPiConfigDir(), PI_ENV_FILE);
}

export function defaultPiLogsDir(): string {
  return join(defaultPiConfigDir(), PI_LOGS_SUBDIR);
}

export function defaultConsolidateLogPath(): string {
  return join(defaultPiLogsDir(), CONSOLIDATE_LOG_FILE);
}

export function defaultConsolidateErrLogPath(): string {
  return join(defaultPiLogsDir(), CONSOLIDATE_ERR_LOG_FILE);
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
