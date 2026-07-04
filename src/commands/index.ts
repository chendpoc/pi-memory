import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createRememberCommand } from "./remember.js";
import { createMemoryStatusCommand } from "./status.js";
import type { CommandDeps } from "./types.js";

export type { CommandDeps, MemoryStatusCommandDeps, RememberCommandDeps } from "./types.js";
export { parseRememberArgs } from "./parseRememberArgs.js";

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  pi.registerCommand("remember", {
    description: "Append a user-authored note to MEMORY.md",
    handler: createRememberCommand(deps),
  });

  pi.registerCommand("memory-status", {
    description: "Show MEMORY.md, sidecar, and vector index diagnostics",
    handler: createMemoryStatusCommand(deps),
  });
}
