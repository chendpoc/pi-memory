import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildLaunchdPlist,
  launchdPlistPath,
} from "../../src/consolidation/scheduler/launchd.js";
import {
  buildSystemdService,
  buildSystemdTimer,
  systemdServicePath,
  systemdTimerPath,
} from "../../src/consolidation/scheduler/systemd.js";
import { setupSchedule } from "../../src/consolidation/scheduler/setupSchedule.js";
import type { ScheduleOptions } from "../../src/consolidation/scheduler/types.js";

describe("consolidation scheduler file generation", () => {
  let home: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "pi-memory-home-"));
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
  });

  afterEach(async () => {
    homedirSpy.mockRestore();
    await fs.rm(home, { recursive: true, force: true });
  });

  const base: Omit<ScheduleOptions, "hour" | "minute" | "logPath"> = {
    dryRun: false,
  };

  it("builds launchd plist content and writes file", async () => {
    const schedule = await setupSchedule(
      { ...base, hour: 3, minute: 30, logPath: "/tmp/consolidation.log", npxPath: "/usr/bin/npx" },
      "darwin",
    );

    expect(schedule.action).toBe("write");
    expect(schedule.files).toHaveLength(1);
    const file = schedule.files[0]!;

    expect(file.path).toBe(launchdPlistPath());
    expect(file.exists).toBe(true);
    expect(file.content).toContain("dev.pi.memory-consolidate");
    expect(file.content).toContain("<key>ProgramArguments</key>");
    expect(file.content).toContain("<string>/usr/bin/npx</string>");
    expect(file.content).toContain("<string>pi-memory</string>");
    expect(file.content).toContain("<string>consolidate</string>");
    expect(file.content).toContain("<integer>3</integer>");
    expect(file.content).toContain("<integer>30</integer>");
    expect(file.content).toContain("<string>/tmp/consolidation.log</string>");
    expect(await fs.readFile(file.path, "utf8")).toBe(file.content);
  });

  it("builds systemd service and timer content and writes files", async () => {
    const schedule = await setupSchedule(
      { ...base, hour: 22, minute: 5, logPath: "/tmp/consolidation.log", commandPath: "/usr/bin/pi-memory" },
      "linux",
    );

    expect(schedule.action).toBe("write");
    expect(schedule.files).toHaveLength(2);
    const servicePath = systemdServicePath();
    const timerPath = systemdTimerPath();
    const serviceFile = schedule.files.find((f) => f.path === servicePath);
    const timerFile = schedule.files.find((f) => f.path === timerPath);
    expect(serviceFile).toBeDefined();
    expect(timerFile).toBeDefined();
    expect(serviceFile!.exists).toBe(true);
    expect(timerFile!.exists).toBe(true);
    expect(serviceFile!.content).toContain(buildSystemdService({ ...base, hour: 22, minute: 5, logPath: "/tmp/consolidation.log", commandPath: "/usr/bin/pi-memory" }));
    expect(serviceFile!.content).toContain("ExecStart=/usr/bin/pi-memory consolidate");
    expect(timerFile!.content).toBe(buildSystemdTimer({ ...base, hour: 22, minute: 5, logPath: "/tmp/consolidation.log", commandPath: "/usr/bin/pi-memory" }));
    expect(timerFile!.content).toContain("Persistent=true");
    expect(timerFile!.content).toContain("OnCalendar=*-*-* 22:05:00");
  });

  it("returns plans on dry run without writing files", async () => {
    const result = await setupSchedule(
      { ...base, hour: 1, minute: 10, logPath: "/tmp/consolidation.log", dryRun: true },
      "darwin",
    );

    expect(result.action).toBe("write");
    expect(result.dryRun).toBe(true);
    expect(result.files[0]!.exists).toBe(false);
    await expect(fs.access(result.files[0]!.path)).rejects.toThrow();
    expect(result.files[0]!.content).toContain(buildLaunchdPlist({ ...base, hour: 1, minute: 10, logPath: "/tmp/consolidation.log", dryRun: true }));
  });

  it("checks status from file existence", async () => {
    await fs.mkdir(path.dirname(launchdPlistPath()), { recursive: true });
    await fs.writeFile(launchdPlistPath(), "existing", "utf8");

    const status = await setupSchedule(
      { ...base, hour: 2, minute: 2, logPath: "/tmp/consolidation.log", status: true },
      "darwin",
    );

    expect(status.action).toBe("status");
    expect(status.files).toHaveLength(1);
    expect(status.files[0]!.path).toBe(launchdPlistPath());
    expect(status.files[0]!.exists).toBe(true);
    expect(status.files[0]!.content).toBeUndefined();
  });

  it("removes files by existence and keeps behavior in dry-run mode", async () => {
    const target = launchdPlistPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "existing", "utf8");
    await fs.mkdir(path.dirname(systemdServicePath()), { recursive: true });
    await fs.writeFile(systemdServicePath(), "svc", "utf8");
    await fs.mkdir(path.dirname(systemdTimerPath()), { recursive: true });
    await fs.writeFile(systemdTimerPath(), "timer", "utf8");

    const removed = await setupSchedule(
      { ...base, hour: 3, minute: 20, logPath: "/tmp/consolidation.log", remove: true },
      "linux",
    );
    expect(removed.action).toBe("remove");
    expect(removed.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: systemdServicePath(), exists: false }),
        expect.objectContaining({ path: systemdTimerPath(), exists: false }),
      ]),
    );

    await fs.writeFile(launchdPlistPath(), "existing", "utf8");
    const dryRunRemoved = await setupSchedule(
      { ...base, hour: 3, minute: 20, logPath: "/tmp/consolidation.log", remove: true, dryRun: true },
      "darwin",
    );
    expect(dryRunRemoved.action).toBe("remove");
    expect(dryRunRemoved.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: launchdPlistPath(), exists: true })]),
    );
    await expect(fs.access(launchdPlistPath())).resolves.toBeUndefined();
  });
});
