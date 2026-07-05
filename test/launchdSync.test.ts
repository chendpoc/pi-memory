import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LAUNCHD_LABEL } from "../src/constants/paths.js";

let mockHome = "";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHome,
  };
});

const execaMock = vi.fn();

vi.mock("execa", () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

import { buildLaunchdMaintenancePlist } from "../src/scheduler/launchdPlist.js";
import { isLaunchAgentLoaded, syncLaunchdMaintenanceJob } from "../src/scheduler/launchd.js";

describe("syncLaunchdMaintenanceJob", () => {
  let tempHome: string;
  let plistPath: string;

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

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "pi-memory-home-"));
    mockHome = tempHome;
    plistPath = join(tempHome, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    mkdirSync(join(tempHome, "Library", "LaunchAgents"), { recursive: true });
  });

  afterEach(() => {
    execaMock.mockReset();
    rmSync(tempHome, { recursive: true, force: true });
    mockHome = "";
  });

  it("bootstraps again when plist is unchanged but job is not loaded", async () => {
    writeFileSync(plistPath, buildLaunchdMaintenancePlist(input), "utf8");

    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "launchctl" && args[0] === "print") {
        return { exitCode: 1, stdout: "", stderr: "Could not find service" };
      }
      if (cmd === "launchctl" && args[0] === "bootstrap") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const result = await syncLaunchdMaintenanceJob(input);

    expect(result.changed).toBe(false);
    expect(result.bootstrapped).toBe(true);
    expect(execaMock).toHaveBeenCalledWith(
      "launchctl",
      ["bootstrap", expect.stringMatching(/^gui\/\d+$/), plistPath],
    );
    expect(readFileSync(plistPath, "utf8")).toBe(buildLaunchdMaintenancePlist(input));
  });

  it("skips bootstrap when plist is unchanged and job is loaded", async () => {
    writeFileSync(plistPath, buildLaunchdMaintenancePlist(input), "utf8");

    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "launchctl" && args[0] === "print") {
        return { exitCode: 0, stdout: "state = not running", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const result = await syncLaunchdMaintenanceJob(input);

    expect(result.changed).toBe(false);
    expect(result.bootstrapped).toBe(false);
    expect(execaMock.mock.calls.some(([cmd, args]) => cmd === "launchctl" && args[0] === "bootstrap")).toBe(
      false,
    );
    expect(existsSync(plistPath)).toBe(true);
  });
});

describe("isLaunchAgentLoaded", () => {
  afterEach(() => {
    execaMock.mockReset();
  });

  it("returns true when launchctl print succeeds", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    await expect(isLaunchAgentLoaded(LAUNCHD_LABEL)).resolves.toBe(true);
  });
});
