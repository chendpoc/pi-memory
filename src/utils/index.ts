export {
  getPlatform,
  isMacOS,
  isUnixLike,
  isWindows,
  type PiMemoryPlatform,
} from "./platform.js";

export {
  CONFIG_DIR_NAME,
  defaultConsolidateErrLogPath,
  defaultConsolidateLogPath,
  defaultMemoryAgentDir,
  defaultPiConfigDir,
  defaultPiMemoryEnvFile,
  defaultPiLogsDir,
  expandHomePath,
  getAgentDir,
  mkdirOptions,
  resolveConsolidateErrLogPath,
  resolveConsolidateLogPath,
  resolvePiLogsDir,
  secureDirMode,
  secureFileMode,
} from "./paths.js";

export {
  appendText,
  canRead,
  ensureDir,
  ensureDirSync,
  ensureFile,
  isENOENT,
  joinPath,
  listDir,
  pathBasename,
  pathDirname,
  pathExists,
  readText,
  readTextRequired,
  removeFile,
  writeText,
} from "./fs.js";

export { cleanupSocketFiles, removeSocketFile, secureSocketPath } from "./socket.js";

export { debugMemory, isMemoryDebugEnabled } from "./debugLog.js";

export {
  daysSince,
  epochTimestamp,
  formatLocalDate,
  formatTimestamp,
  now,
  nowMs,
  parseTime,
  remainingMs,
  type TimeInput,
} from "./time.js";

export {
  buildConsolidateCliArgs,
  buildMaintenanceCliArgs,
  defaultConsolidateSchedulerPaths,
  formatConsolidateCronLine,
  formatMaintenanceCronLine,
  getConsolidateSchedulerKind,
  getConsolidateTemplateNames,
  type ConsolidateCliInvocation,
  type ConsolidateSchedulerKind,
  type ConsolidateSchedulerPaths,
  type ConsolidateTemplateName,
} from "./scheduler.js";

export {
  mergeAbortSignals,
  preflightAbortSignal,
  PREFLIGHT_ABORTED_MESSAGE,
  PREFLIGHT_TIMEOUT_MESSAGE,
  throwIfAborted,
} from "./async.js";
export { JsonlFramer, parseJsonlLine, serializeJsonlFrame } from "./jsonl.js";
export { entryDedupeKey, stripPrivateMemory, stripPrivateMemoryFromMessages } from "./memory/index.js";
export { isSubagentSession, readParentSession } from "./session/index.js";
