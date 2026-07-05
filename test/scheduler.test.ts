import { describe, expect, it, vi } from "vitest";

import { LAUNCHD_LABEL } from "../src/constants/paths.js";
import {
  buildLaunchdMaintenancePlist,
  buildLaunchdMaintenanceShellCommand,
  shellSingleQuote,
} from "../src/scheduler/launchdPlist.js";
import {
  canSyncLaunchdInProcess,
  isSchedulerSyncDisabled,
  syncMaintenanceScheduler,
} from "../src/scheduler/sync.js";

vi.mock("../src/scheduler/launchd.js", () => ({
  syncLaunchdMaintenanceJob: vi.fn(),
  isLaunchAgentLoaded: vi.fn(),
}));

import { syncLaunchdMaintenanceJob } from "../src/scheduler/launchd.js";

describe("launchd plist", () => {
  const input = {
    label: LAUNCHD_LABEL,
    nodePath: "/usr/local/bin/node",
    cliPath: "/opt/pi-memory/dist/cli.js",
    envFile: "/Users/me/.pi/agent/pi-memory.env",
    agentDir: "/Users/me/.pi/pi-memory-data",
    logsDir: "/Users/me/.pi/pi-memory-data/logs",
    stdoutLog: "/Users/me/.pi/pi-memory-data/logs/maintenance.log",
    stderrLog: "/Users/me/.pi/pi-memory-data/logs/maintenance.err.log",
  };

  it("quotes shell paths safely", () => {
    expect(shellSingleQuote("it's fine")).toBe(`'it'\"'\"'s fine'`);
  });

  it("builds maintenance shell command", () => {
    const command = buildLaunchdMaintenanceShellCommand(input);
    expect(command).toContain("mkdir -p '/Users/me/.pi/pi-memory-data/logs'");
    expect(command).toContain("maintenance --cron --verbose");
    expect(command).toContain("/Users/me/.pi/pi-memory-data/logs/maintenance.log");
  });

  it("embeds label, schedule, and env in plist", () => {
    const plist = buildLaunchdMaintenancePlist(input);
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain("<integer>3</integer>");
    expect(plist).toContain("/Users/me/.pi/pi-memory-data");
    expect(plist).toContain("PI_MEMORY_AGENT_DIR");
  });
});

describe("scheduler sync guard", () => {
  it("respects PI_MEMORY_SKIP_SCHEDULER_SYNC", () => {
    expect(isSchedulerSyncDisabled({ PI_MEMORY_SKIP_SCHEDULER_SYNC: "1" })).toBe(true);
    expect(isSchedulerSyncDisabled({})).toBe(false);
  });

  it("never throws when launchd sync fails", async () => {
    vi.mocked(syncLaunchdMaintenanceJob).mockRejectedValueOnce(
      new Error("launchctl bootstrap failed: gui session unavailable"),
    );

    const result = await syncMaintenanceScheduler({ agentDir: "/tmp/agent" });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.message).toContain("launchctl bootstrap failed");
    }
  });

  it("surfaces bootstrapped retry when plist is unchanged", async () => {
    vi.mocked(syncLaunchdMaintenanceJob).mockResolvedValueOnce({
      label: LAUNCHD_LABEL,
      plistPath: "/Users/me/Library/LaunchAgents/com.pi.memory.maintenance.plist",
      changed: false,
      bootstrapped: true,
      removedLegacy: [],
    });

    const result = await syncMaintenanceScheduler({ agentDir: "/tmp/agent" });
    expect(result.status).toBe("synced");
    if (result.status === "synced") {
      expect(result.bootstrapped).toBe(true);
      expect(result.changed).toBe(false);
    }
  });

  it("skips on unsupported platform", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });

    const result = await syncMaintenanceScheduler();
    expect(result.status).toBe("skipped");
    expect(result.status === "skipped" && result.reason).toBe("unsupported-platform");

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("requires uid and home before attempting launchd", () => {
    expect(canSyncLaunchdInProcess({ PI_MEMORY_SKIP_SCHEDULER_SYNC: "1" }).ok).toBe(false);
  });
});
