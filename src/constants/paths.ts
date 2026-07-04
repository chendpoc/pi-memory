/** Pi user config root directory name under $HOME. */
export const PI_CONFIG_DIR = ".pi";

export const PI_AGENT_SUBDIR = "agent";
export const PI_ENV_FILE = ".env";
export const PI_LOGS_SUBDIR = "logs";

/** Sidecar IPC + index files (under agent dir). */
export const SIDECAR_SOCKET_FILE = "memory.sock";
export const SIDECAR_DB_FILE = "memory.vec.sqlite";
export const SIDECAR_PID_SUFFIX = ".pid";
export const SIDECAR_SPAWN_LOCK_FILE = "sidecar.spawn.lock";

/** Consolidate scheduler log basenames (under ~/.pi/logs). */
export const CONSOLIDATE_LOG_FILE = "consolidate.log";
export const CONSOLIDATE_ERR_LOG_FILE = "consolidate.err.log";

/** OS scheduler identifiers. */
export const LAUNCHD_LABEL = "com.pi.memory.consolidate";
export const SCHTASKS_TASK_NAME = "PiMemoryConsolidate";

export const SCHEDULER_TEMPLATE_FILES = {
  launchd: "com.pi.memory.consolidate.plist.example",
  crontab: "crontab.example",
  windowsCmd: "consolidate.cmd.example",
  windowsSchtasks: "schtasks.example.txt",
} as const;
