export type SchedulePlatform = "darwin" | "linux";

export interface ScheduleOptions {
  hour: number;
  minute: number;
  logPath: string;
  commandPath?: string;
  npxPath?: string;
  dryRun?: boolean;
  remove?: boolean;
  status?: boolean;
}

export type ScheduleAction = "write" | "remove" | "status";

export interface ScheduledFile {
  path: string;
  exists: boolean;
  content?: string;
}

export interface SetupScheduleResult {
  platform: SchedulePlatform;
  action: ScheduleAction;
  files: ScheduledFile[];
  dryRun: boolean;
}
