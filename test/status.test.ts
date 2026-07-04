import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseMemoryStatusArgs } from "../src/commands/parseMemoryStatusArgs.js";
import {
  createMemoryStatusCommand,
  getMemoryStatusWidgetStateForTest,
  resetMemoryStatusWidgetState,
  setMemoryStatusWidgetStateForTest,
} from "../src/commands/status.js";
import { formatMemoryStatusLines, gatherMemoryStatus } from "../src/cli/status.js";
import { createMemoryStore } from "../src/store/index.js";

describe("parseMemoryStatusArgs", () => {
  it("maps hide and refresh subcommands", () => {
    expect(parseMemoryStatusArgs("hide")).toBe("hide");
    expect(parseMemoryStatusArgs("refresh")).toBe("refresh");
    expect(parseMemoryStatusArgs("expand")).toBe("expand");
    expect(parseMemoryStatusArgs("collapse")).toBe("collapse");
    expect(parseMemoryStatusArgs("")).toBe("toggle");
  });
});

describe("gatherMemoryStatus", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports empty memory stats", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-status-"));
    const store = createMemoryStore({ agentDir: tmpDir });
    await store.ensureInitialized();

    const report = await gatherMemoryStatus(tmpDir);
    expect(report.agentDir).toBe(tmpDir);
    expect(report.memory.entryCount).toBeGreaterThanOrEqual(0);
    expect(report.sidecar.running).toBe(false);
    expect(report.vectorIndex.exists).toBe(false);
    expect(report.embedder.provider).toBe("hash");
    expect(report.embedder.model).toBe("hash/dev");
    expect(report.embedder.dim).toBe(768);
  });
});

describe("formatMemoryStatusLines", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns plain-text lines without ansi", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-status-fmt-"));
    const report = await gatherMemoryStatus(tmpDir);
    const lines = formatMemoryStatusLines(report);

    expect(lines.some((line) => line.startsWith("agent dir"))).toBe(true);
    expect(lines.some((line) => line.includes("sidecar"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/\x1b\[/);
  });
});

describe("memory-status command", () => {
  let tmpDir: string;

  afterEach(() => {
    resetMemoryStatusWidgetState();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets collapsible widget factory on first run", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-cmd-status-"));
    const setWidget = vi.fn();
    const setWorkingMessage = vi.fn();
    const notify = vi.fn();

    const handler = createMemoryStatusCommand({ getAgentDir: () => tmpDir });
    const ctx = {
      hasUI: true,
      ui: { setWidget, setWorkingMessage, notify },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    expect(setWorkingMessage).toHaveBeenCalledWith("Checking memory…");
    expect(setWorkingMessage).toHaveBeenCalledWith();
    expect(setWidget).toHaveBeenCalledWith(
      "pi-memory-status",
      expect.any(Function),
      { placement: "aboveEditor" },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("toggles expanded state without refetching", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-cmd-status-"));
    const report = await gatherMemoryStatus(tmpDir);
    setMemoryStatusWidgetStateForTest({ report, expanded: false });

    const setWidget = vi.fn();
    const handler = createMemoryStatusCommand({ getAgentDir: () => tmpDir });
    const ctx = {
      hasUI: true,
      ui: { setWidget, setWorkingMessage: vi.fn(), notify: vi.fn() },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    expect(setWidget).toHaveBeenCalledTimes(1);
    expect(getMemoryStatusWidgetStateForTest()?.expanded).toBe(true);
  });

  it("hides widget on hide subcommand", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-cmd-status-"));
    const report = await gatherMemoryStatus(tmpDir);
    setMemoryStatusWidgetStateForTest({ report, expanded: true });

    const setWidget = vi.fn();
    const handler = createMemoryStatusCommand({ getAgentDir: () => tmpDir });
    const ctx = {
      hasUI: true,
      ui: { setWidget, setWorkingMessage: vi.fn(), notify: vi.fn() },
    } as unknown as ExtensionCommandContext;

    await handler("hide", ctx);

    expect(setWidget).toHaveBeenCalledWith("pi-memory-status", undefined);
    expect(getMemoryStatusWidgetStateForTest()).toBeNull();
  });

  it("notifies plain text when UI is unavailable", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-cmd-status-"));
    const notify = vi.fn();

    const handler = createMemoryStatusCommand({ getAgentDir: () => tmpDir });
    const ctx = {
      hasUI: false,
      ui: { notify },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("pi-memory status"),
      "info",
    );
  });
});
