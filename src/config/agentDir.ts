import { defaultAgentDir, expandHomePath } from "../utils/paths.js";
import { readPiMemoryEnv } from "./env.js";

/** Resolve agent directory from CLI flag or PI_MEMORY_AGENT_DIR (default ~/.pi/agent). */
export function resolveAgentDirFromEnv(explicit?: string, env = process.env): string {
  const fromArg = explicit?.trim();
  if (fromArg) return expandHomePath(fromArg);

  const fromEnv = readPiMemoryEnv(env).agentDir?.trim();
  if (fromEnv) return expandHomePath(fromEnv);

  return defaultAgentDir();
}
