import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createRememberCommand } from "./remember.js";
import type { RememberCommandDeps } from "./types.js";

export type { RememberCommandDeps } from "./types.js";
export { parseRememberArgs } from "./parseRememberArgs.js";

export function registerCommands(pi: ExtensionAPI, deps: RememberCommandDeps): void {
  pi.registerCommand("remember", {
    description: "Append a user-authored note to MEMORY.md",
    handler: createRememberCommand(deps),
  });
}
