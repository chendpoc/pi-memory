import { CONSOLIDATE_CRON_HOUR, CONSOLIDATE_CRON_MINUTE } from "../constants/timing.js";

export type LaunchdMaintenancePlistInput = {
  label: string;
  nodePath: string;
  cliPath: string;
  envFile: string;
  agentDir: string;
  stdoutLog: string;
  stderrLog: string;
  logsDir: string;
};

/** Escape a string for safe inclusion inside single-quoted sh(1) arguments. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildLaunchdMaintenanceShellCommand(input: LaunchdMaintenancePlistInput): string {
  const mkdir = `mkdir -p ${shellSingleQuote(input.logsDir)}`;
  const exec = [
    "exec",
    shellSingleQuote(input.nodePath),
    shellSingleQuote(input.cliPath),
    "maintenance",
    "--cron",
    "--verbose",
  ].join(" ");
  const redirect = `>> ${shellSingleQuote(input.stdoutLog)} 2>> ${shellSingleQuote(input.stderrLog)}`;
  return `${mkdir} && ${exec} ${redirect}`;
}

export function buildLaunchdMaintenancePlist(input: LaunchdMaintenancePlistInput): string {
  const shellCommand = buildLaunchdMaintenanceShellCommand(input);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(input.label)}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${escapeXml(shellCommand)}</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${CONSOLIDATE_CRON_HOUR}</integer>
    <key>Minute</key>
    <integer>${CONSOLIDATE_CRON_MINUTE}</integer>
  </dict>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PI_MEMORY_ENV_FILE</key>
    <string>${escapeXml(input.envFile)}</string>
    <key>PI_MEMORY_AGENT_DIR</key>
    <string>${escapeXml(input.agentDir)}</string>
  </dict>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
