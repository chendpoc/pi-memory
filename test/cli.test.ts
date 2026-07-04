import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli/parseArgs.js";
import { resolveAgentDirFromEnv } from "../src/config/agentDir.js";

describe("parseCliArgs", () => {
  it("parses consolidate flags", () => {
    expect(parseCliArgs(["consolidate", "--cron", "--force", "--verbose"])).toEqual({
      command: "consolidate",
      options: { cron: true, force: true, verbose: true, agentDir: undefined },
    });
  });

  it("parses status command", () => {
    expect(parseCliArgs(["status", "--verbose"])).toEqual({
      command: "status",
      options: { verbose: true, agentDir: undefined },
    });
  });

  it("parses --agent-dir", () => {
    expect(parseCliArgs(["consolidate", "--agent-dir", "~/.pi/agent"])).toEqual({
      command: "consolidate",
      options: { cron: false, force: false, verbose: false, agentDir: "~/.pi/agent" },
    });
  });

  it("rejects unknown commands", () => {
    expect(parseCliArgs(["nope"])).toEqual({
      command: "help",
      error: "Unknown command: nope",
    });
  });
});

describe("resolveAgentDirFromEnv", () => {
  it("prefers explicit path", () => {
    expect(resolveAgentDirFromEnv("/tmp/agent", {})).toBe("/tmp/agent");
  });

  it("reads PI_MEMORY_AGENT_DIR", () => {
    expect(resolveAgentDirFromEnv(undefined, { PI_MEMORY_AGENT_DIR: "/data/agent" })).toBe("/data/agent");
  });
});
