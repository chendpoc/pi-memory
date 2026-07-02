export type {
  ConsolidationStatus,
  ConsolidationStatusReport,
  JobReport,
  PendingSession,
  Stage1Output,
} from "./types.js";

export {
  getMemoryIndexStats,
  memoryIndexSnippet,
  readMemoryIndexCap,
  type MemoryIndexCapOptions,
  type MemoryIndexStats,
} from "./memoryIndex.js";

export {
  findGitRoot,
  lineMatchesScope,
  parseScopeComment,
  projectHash,
  projectScope,
  scopeForCwd,
  type MemoryScope,
} from "./scope.js";

export {
  appendConsolidationLog,
  readRecentConsolidationLogs,
  type ConsolidationLogEntry,
} from "./log.js";

export { withFileLock } from "./lock.js";

export { enqueueSession, getConsolidationStatus } from "./enqueue.js";
export type {
  ConsolidationStatusQueryOptions,
  EnqueueOptions,
  EnqueueSessionInput,
} from "./enqueue.js";

export { openConsolidationStore } from "./stage1/store.js";
export type { SqliteDatabase, ConsolidationStore } from "./stage1/store.js";

export {
  computeDeltaTurns,
} from "./stage1/deltaExtract.js";

export {
  drainQueue,
  type DrainQueueOptions,
  type DrainQueueReport,
} from "./stage1/drainQueue.js";

export { extractSessionToStage1 } from "./stage1/extractSession.js";

export {
  runPhase2,
  type Phase2Options,
  type Phase2Report,
} from "./phase2/runPhase2.js";

export {
  defaultConsolidationDbPath,
  runConsolidate,
  type ConsolidateOptions,
  type ConsolidateReport,
} from "./scheduler/runConsolidate.js";

export {
  buildLaunchdPlist,
  launchdPlistPath,
} from "./scheduler/launchd.js";

export {
  buildSystemdService,
  buildSystemdTimer,
  systemdServicePath,
  systemdTimerPath,
} from "./scheduler/systemd.js";

export { setupSchedule } from "./scheduler/setupSchedule.js";

export type {
  ScheduleAction,
  ScheduledFile,
  ScheduleOptions,
  SchedulePlatform,
  SetupScheduleResult,
} from "./scheduler/types.js";
