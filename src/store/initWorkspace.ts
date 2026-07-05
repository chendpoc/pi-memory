import { DEFAULT_MEMORY_FILE } from "../constants/memory.js";
import { PI_LOGS_SUBDIR } from "../constants/paths.js";
import { ensureDir, joinPath, readText } from "../utils/fs.js";
import { MarkdownMemoryBackend } from "./backend.js";
import { defaultMemoryTemplate } from "./markdown/template.js";
import { resolveAgentDir } from "./paths.js";

export type InitMemoryWorkspaceResult = {
  agentDir: string;
  memoryFile: string;
  created: boolean;
  skipped: boolean;
  reason?: "already_initialized";
};

/**
 * Ensure the memory data directory exists, `logs/` is present, and MEMORY.md follows the canonical template.
 * Never overwrites a non-empty MEMORY.md.
 */
export async function initializeMemoryWorkspace(agentDir: string): Promise<InitMemoryWorkspaceResult> {
  const resolved = resolveAgentDir(agentDir);
  const memoryFile = joinPath(resolved, DEFAULT_MEMORY_FILE);
  const backend = new MarkdownMemoryBackend(memoryFile);

  await backend.ensureAgentDir();
  await ensureDir(joinPath(resolved, PI_LOGS_SUBDIR));

  const existing = await backend.readText(memoryFile);
  if (existing.trim()) {
    return {
      agentDir: resolved,
      memoryFile,
      created: false,
      skipped: true,
      reason: "already_initialized",
    };
  }

  await backend.writeText(memoryFile, defaultMemoryTemplate());
  return { agentDir: resolved, memoryFile, created: true, skipped: false };
}

/** Read bundled template from templates/MEMORY.md.example (postinstall / docs). */
export async function readMemoryTemplateExample(packageRoot: string): Promise<string> {
  return readText(joinPath(packageRoot, "templates", "MEMORY.md.example"));
}
