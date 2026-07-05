import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SCHEDULER_TEMPLATE_FILES } from "../src/constants/index.js";
import {
  buildConsolidateCliArgs,
  buildMaintenanceCliArgs,
  defaultMemoryAgentDir,
  defaultPiConfigDir,
  defaultPiLogsDir,
  expandHomePath,
  getAgentDir,
  getConsolidateSchedulerKind,
  getConsolidateTemplateNames,
  getPlatform,
  isMacOS,
  isUnixLike,
  isWindows,
  joinPath,
  mkdirOptions,
  readText,
  secureDirMode,
  secureFileMode,
} from "../src/utils/index.js";
import { SECURE_DIR_MODE, SECURE_FILE_MODE } from "../src/constants/security.js";

describe("platform", () => {
  it("detects current platform", () => {
    const platform = getPlatform();
    expect(["darwin", "win32", "other"]).toContain(platform);
    expect(isWindows()).toBe(platform === "win32");
    expect(isMacOS()).toBe(platform === "darwin");
    expect(isUnixLike()).toBe(!isWindows());
  });
});

describe("paths", () => {
  it("expands ~ paths", () => {
    expect(expandHomePath("~/agent")).toBe(join(homedir(), "agent"));
    expect(expandHomePath("~")).toBe(homedir());
    expect(expandHomePath("/tmp/agent")).toBe("/tmp/agent");
  });

  it("uses secure modes on Unix only", () => {
    if (isWindows()) {
      expect(secureDirMode()).toBeUndefined();
      expect(secureFileMode()).toBeUndefined();
      expect(mkdirOptions()).toEqual({ recursive: true });
    } else {
      expect(secureDirMode()).toBe(SECURE_DIR_MODE);
      expect(secureFileMode()).toBe(SECURE_FILE_MODE);
      expect(mkdirOptions()).toEqual({ recursive: true, mode: SECURE_DIR_MODE });
    }
  });

  it("defaults pi config under home", () => {
    expect(defaultPiConfigDir()).toMatch(/\.pi$/);
    expect(getAgentDir()).toMatch(/\.pi[\\/]agent$/);
    expect(defaultMemoryAgentDir()).toMatch(/\.pi[\\/]pi-memory-data$/);
    expect(defaultPiLogsDir()).toMatch(/\.pi[\\/]pi-memory-data[\\/]logs$/);
  });
});

describe("fs", () => {
  it("joinPath uses platform separators", () => {
    expect(joinPath("a", "b", "c")).toContain("b");
  });

  it("readText returns empty string for missing files", async () => {
    const content = await readText("/tmp/pi-memory-missing-file-test-404.md");
    expect(content).toBe("");
  });
});

describe("scheduler", () => {
  it("maps platform to scheduler kind", () => {
    expect(getConsolidateSchedulerKind("darwin")).toBe("launchd");
    expect(getConsolidateSchedulerKind("win32")).toBe("schtasks");
    expect(getConsolidateSchedulerKind("other")).toBe("crontab");
  });

  it("lists platform templates", () => {
    expect(getConsolidateTemplateNames("win32")).toEqual([
      SCHEDULER_TEMPLATE_FILES.windowsCmd,
      SCHEDULER_TEMPLATE_FILES.windowsSchtasks,
    ]);
    expect(getConsolidateTemplateNames("darwin")).toContain(SCHEDULER_TEMPLATE_FILES.launchd);
  });

  it("builds maintenance argv", () => {
    expect(buildMaintenanceCliArgs({ cron: true, verbose: true })).toEqual([
      "maintenance",
      "--cron",
      "--verbose",
    ]);
  });
});
