import { afterEach, describe, expect, it, vi } from "vitest";

import { createCliLog } from "../src/cli/log.js";
import { paint, theme } from "../src/cli/theme.js";
import { debugMemory, isMemoryDebugEnabled } from "../src/utils/debugLog.js";

describe("cli theme", () => {
  afterEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });

  it("disables colors when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    expect(paint((s) => `*${s}*`, "hello")).toBe("hello");
  });

  it("applies colors on TTY stderr", () => {
    const stream = { isTTY: true } as NodeJS.WriteStream;
    expect(theme.success("ok", stream)).toContain("ok");
  });
});

describe("createCliLog", () => {
  it("writes success to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createCliLog({ verbose: true }).success("done");
    expect(spy.mock.calls[0]?.[0]).toContain("done");
    spy.mockRestore();
  });
});

describe("debugMemory", () => {
  it("is disabled by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.PI_MEMORY_DEBUG;
    debugMemory("preflight", "noop");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs JSON fields when PI_MEMORY_DEBUG=1", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.PI_MEMORY_DEBUG = "1";
    debugMemory("preflight", "recall", { cache_hit: true, results: 2 });
    expect(spy.mock.calls[0]?.[0]).toContain("cache_hit");
    expect(isMemoryDebugEnabled()).toBe(true);
    delete process.env.PI_MEMORY_DEBUG;
    spy.mockRestore();
  });
});
