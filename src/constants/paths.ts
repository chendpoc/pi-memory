/** Default memory data root under ~/.pi/ (MEMORY.md, sidecar, vector DB). */
export const PI_MEMORY_DATA_SUBDIR = "pi-memory-data";
/** pi-memory config file under ~/.pi/agent/ (not a generic dotenv at ~/.pi root). */
export const PI_MEMORY_ENV_FILE_NAME = "pi-memory.env";
export const PI_LOGS_SUBDIR = "logs";

/** Sidecar IPC + index files (under agent dir). */
export const SIDECAR_SOCKET_FILE = "memory.sock";
export const SIDECAR_DB_FILE = "memory.vec.sqlite";
export const SIDECAR_PID_SUFFIX = ".pid";
export const SIDECAR_SPAWN_LOCK_FILE = "sidecar.spawn.lock";

/** Consolidate / maintenance scheduler log basenames (under `<agentDir>/logs`). */
export const CONSOLIDATE_LOG_FILE = "maintenance.log";
export const CONSOLIDATE_ERR_LOG_FILE = "maintenance.err.log";

/** OS scheduler identifiers. */
export const LAUNCHD_LABEL = "com.pi.memory.maintenance";
/** Pre-0.3.x / dev labels removed during scheduler sync. */
export const LEGACY_LAUNCHD_LABELS = [
  "dev.pi.memory-consolidate",
  "com.pi.memory.consolidate",
] as const;
export const SCHTASKS_TASK_NAME = "PiMemoryMaintenance";

export const SCHEDULER_TEMPLATE_FILES = {
  launchd: "com.pi.memory.consolidate.plist.example",
  crontab: "crontab.example",
  windowsCmd: "consolidate.cmd.example",
  windowsSchtasks: "schtasks.example.txt",
} as const;
