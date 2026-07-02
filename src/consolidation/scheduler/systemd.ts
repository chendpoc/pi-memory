import os from "node:os";
import path from "node:path";

import type { ScheduleOptions } from "./types.js";

export const SYSTEMD_UNIT_NAME = "dev.pi.memory-consolidate";
export const SYSTEMD_SERVICE_FILE = `${SYSTEMD_UNIT_NAME}.service`;
export const SYSTEMD_TIMER_FILE = `${SYSTEMD_UNIT_NAME}.timer`;

function commandArgs(opts: ScheduleOptions): string[] {
  if (opts.commandPath) {
    return [opts.commandPath, "consolidate"];
  }
  if (opts.npxPath) {
    return [opts.npxPath, "pi-memory", "consolidate"];
  }
  return ["pi-memory", "consolidate"];
}

function pad2(value: number, max: number): string {
  return String(Math.max(0, Math.min(max, Math.trunc(value)))).padStart(2, "0");
}

function buildExecStart(opts: ScheduleOptions): string {
  return commandArgs(opts).join(" ");
}

export function systemdServicePath(): string {
  return path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
    SYSTEMD_SERVICE_FILE,
  );
}

export function systemdTimerPath(): string {
  return path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
    SYSTEMD_TIMER_FILE,
  );
}

export function buildSystemdService(opts: ScheduleOptions): string {
  return [
    `[Unit]`,
    `Description=Pi Memory Consolidation`,
    ``,
    `[Service]`,
    `Type=oneshot`,
    `ExecStart=${buildExecStart(opts)}`,
    `StandardOutput=append:${opts.logPath}`,
    `StandardError=append:${opts.logPath}`,
    ``,
  ].join("\n");
}

export function buildSystemdTimer(opts: ScheduleOptions): string {
  const minute = pad2(opts.minute, 59);
  const hour = pad2(opts.hour, 23);
  return [
    `[Unit]`,
    `Description=Runs Pi memory consolidation on a daily schedule`,
    ``,
    `[Timer]`,
    `Persistent=true`,
    `OnCalendar=*-*-* ${hour}:${minute}:00`,
    `Unit=${SYSTEMD_UNIT_NAME}.service`,
    ``,
    `[Install]`,
    `WantedBy=timers.target`,
    ``,
  ].join("\n");
}
