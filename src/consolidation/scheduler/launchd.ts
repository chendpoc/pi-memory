import os from "node:os";
import path from "node:path";

import type { ScheduleOptions } from "./types.js";

export const LAUNCHD_LABEL = "dev.pi.memory-consolidate";
const PLIST_FILE = `${LAUNCHD_LABEL}.plist`;

function commandArgs(opts: ScheduleOptions): string[] {
  if (opts.commandPath) {
    return [opts.commandPath, "consolidate"];
  }
  if (opts.npxPath) {
    return [opts.npxPath, "pi-memory", "consolidate"];
  }
  return ["pi-memory", "consolidate"];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function launchdPlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", PLIST_FILE);
}

export function buildLaunchdPlist(opts: ScheduleOptions): string {
  const args = commandArgs(opts);

  const argumentsXml = args
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${LAUNCHD_LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `${argumentsXml}`,
    `  </array>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${escapeXml(opts.logPath)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${escapeXml(opts.logPath)}</string>`,
    `  <key>StartCalendarInterval</key>`,
    `  <dict>`,
    `    <key>Hour</key>`,
    `    <integer>${opts.hour}</integer>`,
    `    <key>Minute</key>`,
    `    <integer>${opts.minute}</integer>`,
    `  </dict>`,
    `</dict>`,
    `</plist>`,
  ].join("\n");
}
