import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dayjs from "dayjs";

import {
  daysSince,
  epochTimestamp,
  formatLocalDate,
  formatTimestamp,
  nowMs,
  parseTime,
  remainingMs,
} from "../src/utils/time.js";

describe("time utils", () => {
  const fixedInstant = new Date("2026-07-04T16:30:00+08:00");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedInstant);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats local timestamps without Z suffix", () => {
    const expected = dayjs(fixedInstant).format("YYYY-MM-DDTHH:mm:ss.SSS");
    expect(formatTimestamp()).toBe(expected);
    expect(formatTimestamp()).not.toContain("Z");
  });

  it("formats local calendar dates", () => {
    expect(formatLocalDate()).toBe(dayjs(fixedInstant).format("YYYY-MM-DD"));
  });

  it("uses epoch for missing entry metadata", () => {
    expect(epochTimestamp()).toBe(dayjs(0).format("YYYY-MM-DDTHH:mm:ss.SSS"));
  });

  it("counts whole local calendar days", () => {
    expect(daysSince("2026-06-27T23:59:59.000")).toBe(7);
    expect(daysSince("2026-07-04T00:00:01.000")).toBe(0);
  });

  it("parses invalid input as epoch", () => {
    expect(parseTime("not-a-date").valueOf()).toBe(0);
  });

  it("tracks remaining ms against nowMs", () => {
    const deadline = nowMs() + 250;
    expect(remainingMs(deadline)).toBe(250);
    vi.advanceTimersByTime(100);
    expect(remainingMs(deadline)).toBe(150);
  });
});
